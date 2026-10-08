import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PosUser } from '../auth/auth.types';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { isAdminRole } from '../common/roles';
import { DatabaseService } from '../database/database.service';
import { TableRow } from '../database/database.types';
import { CreatePurchaseDto } from './purchase.dto';

type PurchaseListRow = {
  id: number;
  reference_no: string | null;
  date: string | null;
  note: string | null;
  total: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  created_by: number | null;
};

type PurchaseItemRow = {
  id: number;
  product_id: number | null;
  code: string | null;
  product_name: string | null;
  quantity: string | null;
  cost: string | null;
  subtotal: string | null;
};

type PurchaseIdRow = Pick<TableRow<'tec_purchases'>, 'id'>;
type ProductPurchaseRow = Pick<TableRow<'tec_products'>, 'id'>;
type StoreIdRow = Pick<TableRow<'tec_stores'>, 'id'>;
type SupplierIdRow = Pick<TableRow<'tec_suppliers'>, 'id'>;
type StockIdRow = Pick<TableRow<'tec_product_store_qty'>, 'id'>;

const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;

@Injectable()
export class PurchasesService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    tenantId: string,
    from: string | undefined,
    to: string | undefined,
    pagination: PaginationQuery
  ): Promise<Paginated<PurchaseListRow>> {
    if ((from && !to) || (!from && to)) throw new BadRequestException('from and to must be supplied together');
    if (from && to && from > to) throw new BadRequestException('from must be on or before to');

    const values: unknown[] = [tenantId];
    let dateFilter = '';
    if (from && to) {
      values.push(from, to);
      dateFilter = ` AND p.date >= $2::date AND p.date < ($3::date + INTERVAL '1 day')`;
    }
    values.push(pagination.limit, pagination.offset);
    const result = await this.database.query<PurchaseListRow & { total_count: number }>(
      `SELECT p.id, p.reference_no, p.date, p.note, p.total::text AS total,
              p.supplier_id, s.name AS supplier_name, p.created_by,
              COUNT(*) OVER() AS total_count
       FROM public.tec_purchases p
       LEFT JOIN public.tec_suppliers s ON s.id = p.supplier_id AND s.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1 ${dateFilter}
       ORDER BY p.date DESC, p.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async detail(tenantId: string, purchaseId: number) {
    const header = await this.database.query<PurchaseListRow>(
      `SELECT p.id, p.reference_no, p.date, p.note, p.total::text AS total,
              p.supplier_id, s.name AS supplier_name, p.created_by
       FROM public.tec_purchases p
       LEFT JOIN public.tec_suppliers s ON s.id = p.supplier_id AND s.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1 AND p.id = $2
       LIMIT 1`,
      [tenantId, purchaseId]
    );
    const purchase = header.rows[0];
    if (!purchase) throw new NotFoundException('Purchase not found in this tenant');

    const items = await this.database.query<PurchaseItemRow>(
      `SELECT pi.id, pi.product_id, pr.code, pr.name AS product_name,
              pi.quantity::text AS quantity, pi.cost::text AS cost,
              pi.subtotal::text AS subtotal
       FROM public.tec_purchase_items pi
       LEFT JOIN public.tec_products pr ON pr.id = pi.product_id AND pr.tenant_id = pi.tenant_id
       WHERE pi.tenant_id = $1 AND pi.purchase_id = $2
       ORDER BY pi.id`,
      [tenantId, purchaseId]
    );
    return { purchase, items: items.rows };
  }

  async create(tenantId: string, user: PosUser, input: CreatePurchaseDto) {
    const isAdmin = isAdminRole(user.group_name);
    if (!isAdmin && input.store_id && input.store_id !== user.store_id) {
      throw new ForbiddenException('This POS user cannot purchase for another store');
    }
    const storeId = isAdmin ? (input.store_id ?? user.store_id) : user.store_id;
    if (!storeId) throw new BadRequestException('Assign this POS user to a store or select one');

    return this.database.transaction(async (client) => {
      const store = await client.query<StoreIdRow>(
        'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
        [tenantId, storeId]
      );
      if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');

      let supplierId: number | null = null;
      if (input.supplier_id !== undefined) {
        const supplier = await client.query<SupplierIdRow>(
          'SELECT id FROM public.tec_suppliers WHERE tenant_id = $1 AND id = $2 LIMIT 1',
          [tenantId, input.supplier_id]
        );
        if (supplier.rowCount !== 1) throw new NotFoundException('Supplier not found in this tenant');
        supplierId = input.supplier_id;
      }

      const prepared: Array<{
        productId: number;
        quantity: number;
        cost: Decimal;
        subtotal: Decimal;
        salePrice: Decimal | null;
      }> = [];
      let total = new Decimal(0);

      for (const item of input.items) {
        const quantity = new Decimal(item.quantity);
        if (!quantity.isFinite() || !quantity.isInteger() || quantity.lte(0)) {
          throw new BadRequestException('Purchase quantities must be whole units greater than zero');
        }
        const cost = new Decimal(item.cost);
        if (!cost.isFinite() || cost.isNegative()) throw new BadRequestException('Purchase cost is invalid');
        const salePrice = item.sale_price === undefined ? null : new Decimal(item.sale_price);
        if (salePrice !== null && (!salePrice.isFinite() || salePrice.isNegative())) {
          throw new BadRequestException('Sale price is invalid');
        }

        const product = await client.query<ProductPurchaseRow>(
          `SELECT id FROM public.tec_products
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1
           FOR UPDATE`,
          [tenantId, item.product_id]
        );
        if (product.rowCount !== 1) throw new NotFoundException('Product not found in this tenant');

        const subtotal = cost.times(quantity).toDecimalPlaces(2, MONEY_ROUNDING);
        total = total.plus(subtotal);
        prepared.push({ productId: item.product_id, quantity: quantity.toNumber(), cost, subtotal, salePrice });

        const updatedStock = await client.query<StockIdRow>(
          `UPDATE public.tec_product_store_qty
           SET quantity = quantity + $4
           WHERE tenant_id = $1 AND product_id = $2 AND store_id = $3
           RETURNING id`,
          [tenantId, item.product_id, storeId, quantity.toNumber()]
        );
        if (updatedStock.rowCount !== 1) {
          await client.query(
            `INSERT INTO public.tec_product_store_qty (tenant_id, product_id, store_id, quantity)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, item.product_id, storeId, quantity.toNumber()]
          );
        }

        await client.query(
          `UPDATE public.tec_products
           SET cost = $3,
               price = COALESCE($4::numeric, price)
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, item.product_id, cost.toFixed(2), salePrice === null ? null : salePrice.toFixed(2)]
        );
      }

      total = total.toDecimalPlaces(2, MONEY_ROUNDING);
      const reference = input.reference_no?.trim() || `PUR-${Date.now()}`;
      const header = await client.query<PurchaseIdRow>(
        `INSERT INTO public.tec_purchases
           (tenant_id, reference_no, date, note, total, supplier_id, created_by)
         VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7)
         RETURNING id`,
        [tenantId, reference, input.date ?? null, input.note ?? '', total.toFixed(2), supplierId, user.id]
      );
      const purchaseId = header.rows[0]?.id;
      if (purchaseId === undefined) throw new BadRequestException('Purchase could not be created');

      for (const item of prepared) {
        await client.query(
          `INSERT INTO public.tec_purchase_items
             (tenant_id, purchase_id, product_id, quantity, cost, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tenantId,
            purchaseId,
            item.productId,
            item.quantity.toFixed(2),
            item.cost.toFixed(2),
            item.subtotal.toFixed(2)
          ]
        );
      }

      return {
        id: purchaseId,
        reference_no: reference,
        total: total.toFixed(2),
        supplier_id: supplierId,
        items: prepared.length
      };
    });
  }

  async update(tenantId: string, user: PosUser, purchaseId: number, input: CreatePurchaseDto) {
    const isAdmin = isAdminRole(user.group_name);
    if (!isAdmin && input.store_id && input.store_id !== user.store_id) {
      throw new ForbiddenException('This POS user cannot purchase for another store');
    }
    const storeId = isAdmin ? (input.store_id ?? user.store_id) : user.store_id;
    if (!storeId) throw new BadRequestException('Assign this POS user to a store or select one');

    return this.database.transaction(async (client) => {
      const existing = await client.query<{ id: number; reference_no: string | null }>(
        `SELECT id, reference_no
         FROM public.tec_purchases
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1
         FOR UPDATE`,
        [tenantId, purchaseId]
      );
      const purchase = existing.rows[0];
      if (!purchase) throw new NotFoundException('Purchase not found in this tenant');

      const store = await client.query<StoreIdRow>(
        'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
        [tenantId, storeId]
      );
      if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');

      let supplierId: number | null = null;
      if (input.supplier_id !== undefined) {
        const supplier = await client.query<SupplierIdRow>(
          'SELECT id FROM public.tec_suppliers WHERE tenant_id = $1 AND id = $2 LIMIT 1',
          [tenantId, input.supplier_id]
        );
        if (supplier.rowCount !== 1) throw new NotFoundException('Supplier not found in this tenant');
        supplierId = input.supplier_id;
      }

      const oldItems = await client.query<{ product_id: number | null; quantity: string | null }>(
        `SELECT product_id, quantity::text AS quantity
         FROM public.tec_purchase_items
         WHERE tenant_id = $1 AND purchase_id = $2`,
        [tenantId, purchaseId]
      );
      for (const item of oldItems.rows) {
        if (item.product_id === null) continue;
        await client.query(
          `UPDATE public.tec_product_store_qty
           SET quantity = quantity - $4
           WHERE tenant_id = $1 AND product_id = $2 AND store_id = $3
           RETURNING id`,
          [tenantId, item.product_id, storeId, Number(item.quantity ?? 0)]
        );
      }

      const prepared: Array<{
        productId: number;
        quantity: number;
        cost: Decimal;
        subtotal: Decimal;
        salePrice: Decimal | null;
      }> = [];
      let total = new Decimal(0);

      for (const item of input.items) {
        const quantity = new Decimal(item.quantity);
        if (!quantity.isFinite() || !quantity.isInteger() || quantity.lte(0)) {
          throw new BadRequestException('Purchase quantities must be whole units greater than zero');
        }
        const cost = new Decimal(item.cost);
        if (!cost.isFinite() || cost.isNegative()) throw new BadRequestException('Purchase cost is invalid');
        const salePrice = item.sale_price === undefined ? null : new Decimal(item.sale_price);
        if (salePrice !== null && (!salePrice.isFinite() || salePrice.isNegative())) {
          throw new BadRequestException('Sale price is invalid');
        }

        const product = await client.query<ProductPurchaseRow>(
          `SELECT id FROM public.tec_products
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1
           FOR UPDATE`,
          [tenantId, item.product_id]
        );
        if (product.rowCount !== 1) throw new NotFoundException('Product not found in this tenant');

        const subtotal = cost.times(quantity).toDecimalPlaces(2, MONEY_ROUNDING);
        total = total.plus(subtotal);
        prepared.push({ productId: item.product_id, quantity: quantity.toNumber(), cost, subtotal, salePrice });

        const updatedStock = await client.query<StockIdRow>(
          `UPDATE public.tec_product_store_qty
           SET quantity = quantity + $4
           WHERE tenant_id = $1 AND product_id = $2 AND store_id = $3
           RETURNING id`,
          [tenantId, item.product_id, storeId, quantity.toNumber()]
        );
        if (updatedStock.rowCount !== 1) {
          await client.query(
            `INSERT INTO public.tec_product_store_qty (tenant_id, product_id, store_id, quantity)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, item.product_id, storeId, quantity.toNumber()]
          );
        }

        await client.query(
          `UPDATE public.tec_products
           SET cost = $3,
               price = COALESCE($4::numeric, price)
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, item.product_id, cost.toFixed(2), salePrice === null ? null : salePrice.toFixed(2)]
        );
      }

      total = total.toDecimalPlaces(2, MONEY_ROUNDING);
      const reference = input.reference_no?.trim() || purchase.reference_no || `PUR-${Date.now()}`;

      await client.query(
        `UPDATE public.tec_purchases
         SET reference_no = $3, date = COALESCE($4::date, date), note = $5, total = $6, supplier_id = $7
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, purchaseId, reference, input.date ?? null, input.note ?? '', total.toFixed(2), supplierId]
      );

      await client.query(
        'DELETE FROM public.tec_purchase_items WHERE tenant_id = $1 AND purchase_id = $2',
        [tenantId, purchaseId]
      );
      for (const item of prepared) {
        await client.query(
          `INSERT INTO public.tec_purchase_items
             (tenant_id, purchase_id, product_id, quantity, cost, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tenantId,
            purchaseId,
            item.productId,
            item.quantity.toFixed(2),
            item.cost.toFixed(2),
            item.subtotal.toFixed(2)
          ]
        );
      }

      return {
        id: purchaseId,
        reference_no: reference,
        total: total.toFixed(2),
        supplier_id: supplierId,
        items: prepared.length
      };
    });
  }
}
