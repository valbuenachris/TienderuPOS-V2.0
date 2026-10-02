import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DatabaseService } from '../database/database.service';
import { TableRow } from '../database/database.types';
import { PosUser } from '../auth/auth.types';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { CreateSaleDto, UpdateSaleDto } from './sale.dto';

type ProductRow = Omit<Pick<TableRow<'tec_products'>, 'id' | 'code' | 'name' | 'price' | 'tax' | 'reward_points' | 'type'>, 'price' | 'tax'> & {
  price: string | null;
  tax: string | null;
};
type StockRow = Pick<TableRow<'tec_product_store_qty'>, 'quantity'> & { store_price: string | null };
type SaleIdRow = Pick<TableRow<'tec_sales'>, 'id' | 'created_at'>;
type StoreIdRow = Pick<TableRow<'tec_stores'>, 'id'>;
type CustomerIdNameRow = Pick<TableRow<'tec_customers'>, 'id' | 'name'>;
type UpdatedStockRow = Pick<TableRow<'tec_product_store_qty'>, 'quantity'>;
type SalesListRow = Omit<Pick<
  TableRow<'tec_sales'>,
  'id' | 'tenant_id' | 'customer_id' | 'customer_name' | 'total' | 'grand_total' | 'paid' |
  'total_items' | 'total_quantity' | 'status' | 'created_at' | 'created_by' | 'store_id' |
  'total_reward_points' | 'status_delivery'
>, 'total' | 'grand_total' | 'paid' | 'total_quantity'> & {
  total: string | null;
  grand_total: string | null;
  paid: string | null;
  total_quantity: string | null;
};
type DailyReportRow = { day: string; sales_count: number; total: string; grand_total: string; paid: string };

type EditableSaleRow = {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  paid: string | null;
  store_id: number | null;
};

type SaleItemLockRow = {
  product_id: number | null;
  quantity: string | null;
  unit_price: string | null;
};

type SaleItemDetailRow = {
  id: number;
  product_id: number | null;
  code: string | null;
  name: string | null;
  quantity: string | null;
  unit_price: string | null;
  subtotal: string | null;
  reward_points: number | null;
};

type SalePaymentDetailRow = {
  id: number;
  amount: string | null;
  paid_by: string | null;
  created_at: string | null;
};

const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;

@Injectable()
export class SalesService {
  constructor(private readonly database: DatabaseService) {}

  async create(tenantId: string, user: PosUser, input: CreateSaleDto) {
    const isAdmin = user.group_name?.toLowerCase() === 'admin';
    if (!isAdmin && user.store_id && input.store_id && input.store_id !== user.store_id) {
      throw new ForbiddenException('This POS user cannot sell from another store');
    }
    const storeId = isAdmin ? (input.store_id ?? user.store_id) : user.store_id;
    if (!storeId) throw new BadRequestException('Assign this POS user to a store before creating sales');
    if (!isAdmin && input.store_id && input.store_id !== storeId) {
      throw new ForbiddenException('This POS user cannot sell from another store');
    }

    return this.database.transaction(async (client) => {
      const store = await client.query<StoreIdRow>(
        'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
        [tenantId, storeId]
      );
      if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');

      let customer: { id: number; name: string | null } | null = null;
      if (input.customer_id) {
        const result = await client.query<CustomerIdNameRow>(
          `SELECT id, name FROM public.tec_customers
           WHERE tenant_id = $1 AND id = $2
             AND (store_id IS NULL OR store_id = $3)
           LIMIT 1 FOR KEY SHARE`,
          [tenantId, input.customer_id, storeId]
        );
        customer = result.rows[0] ?? null;
        if (!customer) throw new NotFoundException('Customer not found in this tenant');
      }

      // Sort locks by product ID to reduce deadlocks for carts with multiple items.
      const lines = [...input.items].sort((a, b) => a.product_id - b.product_id);
      const prepared: Array<{
        productId: number;
        code: string | null;
        name: string | null;
        quantity: Decimal;
        unitPrice: Decimal;
        subtotal: Decimal;
        rewardPoints: number;
      }> = [];
      let total = new Decimal(0);
      let taxTotal = new Decimal(0);
      let totalQuantity = new Decimal(0);
      let totalRewardPoints = 0;

      for (const line of lines) {
        const quantity = new Decimal(line.quantity);
        if (!quantity.isFinite() || quantity.lte(0)) {
          throw new BadRequestException('Each sale quantity must be greater than zero');
        }
        // Store-level stock is INTEGER in the immutable schema.
        if (!quantity.isInteger()) {
          throw new BadRequestException('Fractional quantities are not supported by store inventory');
        }

        const products = await client.query<ProductRow>(
          `SELECT id, code, name, price::text AS price, tax::text AS tax,
                  reward_points, type
           FROM public.tec_products
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1
           FOR UPDATE`,
          [tenantId, line.product_id]
        );
        const product = products.rows[0];
        if (!product) throw new NotFoundException('Product not found in this tenant');
        if (product.type === 'combo') {
          throw new BadRequestException('Combo sales are not enabled in this first POS build');
        }

        const stockResult = await client.query<StockRow>(
          `SELECT quantity, price::text AS store_price
           FROM public.tec_product_store_qty
           WHERE tenant_id = $1 AND store_id = $2 AND product_id = $3
           LIMIT 2
           FOR UPDATE`,
          [tenantId, storeId, product.id]
        );
        if (stockResult.rowCount !== 1) {
          throw new NotFoundException('Product has no unique stock row for the selected store');
        }

        const stock = stockResult.rows[0];
        const available = new Decimal(stock.quantity ?? 0);
        if (available.lt(quantity)) {
          throw new BadRequestException(`Insufficient store stock for product ${product.id}`);
        }

        const selectedPrice = stock.store_price ?? product.price;
        if (selectedPrice === null) throw new BadRequestException(`Product ${product.id} has no price`);
        const unitPrice = new Decimal(selectedPrice);
        if (!unitPrice.isFinite() || unitPrice.isNegative()) {
          throw new BadRequestException(`Product ${product.id} has an invalid price`);
        }
        const lineSubtotal = unitPrice.times(quantity).toDecimalPlaces(2, MONEY_ROUNDING);
        const taxRate = new Decimal(product.tax ?? '0');
        if (!taxRate.isFinite() || taxRate.isNegative()) {
          throw new BadRequestException(`Product ${product.id} has an invalid tax rate`);
        }
        const lineTax = lineSubtotal.times(taxRate).dividedBy(100).toDecimalPlaces(2, MONEY_ROUNDING);
        const rewardsPerUnit = Number(product.reward_points ?? 0);
        if (!Number.isSafeInteger(rewardsPerUnit) || rewardsPerUnit < 0) {
          throw new BadRequestException(`Product ${product.id} has invalid reward points`);
        }
        const lineRewards = rewardsPerUnit * quantity.toNumber();
        if (!Number.isSafeInteger(lineRewards)) throw new BadRequestException('Reward points are out of range');

        prepared.push({ productId: product.id, code: product.code, name: product.name, quantity, unitPrice, subtotal: lineSubtotal, rewardPoints: lineRewards });
        total = total.plus(lineSubtotal);
        taxTotal = taxTotal.plus(lineTax);
        totalQuantity = totalQuantity.plus(quantity);
        totalRewardPoints += lineRewards;
        if (!Number.isSafeInteger(totalRewardPoints)) {
          throw new BadRequestException('Total reward points are out of range');
        }

        const updatedStock = await client.query<UpdatedStockRow>(
          `UPDATE public.tec_product_store_qty
           SET quantity = quantity - $1
           WHERE tenant_id = $2 AND store_id = $3 AND product_id = $4 AND quantity >= $1
           RETURNING quantity`,
          [quantity.toNumber(), tenantId, storeId, product.id]
        );
        if (updatedStock.rowCount !== 1) {
          throw new BadRequestException(`Insufficient store stock for product ${product.id}`);
        }
      }

      total = total.toDecimalPlaces(2, MONEY_ROUNDING);
      const grandTotal = total.plus(taxTotal).toDecimalPlaces(2, MONEY_ROUNDING);

      let paid: Decimal;
      let amountReceived: Decimal | null = null;
      let change = new Decimal(0);
      if (!input.paid_by) {
        if (input.paid_amount !== undefined || input.amount_received !== undefined) {
          throw new BadRequestException('A payment method is required when a payment amount is supplied');
        }
        paid = new Decimal(0);
      } else if (input.paid_by === 'cash' && input.amount_received !== undefined) {
        const received = new Decimal(input.amount_received);
        if (!received.isFinite() || received.isNegative()) {
          throw new BadRequestException('amount_received must be zero or greater');
        }
        amountReceived = received;
        paid = Decimal.min(received, grandTotal);
        change = received.minus(paid).toDecimalPlaces(2, MONEY_ROUNDING);
        if (input.change_amount !== undefined) {
          const requested = new Decimal(input.change_amount);
          if (!requested.isFinite() || requested.isNegative()) {
            throw new BadRequestException('change_amount must be zero or greater');
          }
          if (!requested.equals(change)) {
            throw new BadRequestException('change_amount does not match amount_received minus the sale total');
          }
        }
      } else if (input.paid_amount !== undefined) {
        paid = new Decimal(input.paid_amount);
        if (!paid.isFinite() || paid.isNegative() || paid.gt(grandTotal)) {
          throw new BadRequestException('paid_amount must be between zero and the sale total');
        }
      } else {
        paid = grandTotal;
      }
      if (paid.gt(0) && !input.paid_by) {
        throw new BadRequestException('paid_by is required when the sale has a payment');
      }

      const status = paid.gte(grandTotal) ? 'paid' : (paid.eq(0) ? 'due' : 'partial');
      const header = await client.query<SaleIdRow>(
        `INSERT INTO public.tec_sales
          (tenant_id, customer_id, customer_name, total, grand_total, paid,
           total_items, total_quantity, status, created_by, store_id,
           total_reward_points, created_at, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, NULL)
         RETURNING id, created_at`,
        [
          tenantId, customer?.id ?? null, customer?.name ?? 'Cliente ocasional',
          total.toFixed(2), grandTotal.toFixed(2), paid.toFixed(2), prepared.length,
          totalQuantity.toFixed(2), status, user.id, storeId, totalRewardPoints
        ]
      );
      const saleId = header.rows[0]?.id;
      if (saleId === undefined) throw new BadRequestException('Sale could not be created');
      const saleCreatedAt = header.rows[0]?.created_at ?? null;

      for (const line of prepared) {
        await client.query(
          `INSERT INTO public.tec_sale_items
            (tenant_id, sale_id, product_id, quantity, unit_price, subtotal, reward_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tenantId, saleId, line.productId, line.quantity.toFixed(2), line.unitPrice.toFixed(2), line.subtotal.toFixed(2), line.rewardPoints]
        );
      }

      if (paid.gt(0)) {
        await client.query(
          `INSERT INTO public.tec_payments (tenant_id, sale_id, amount, paid_by, created_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [tenantId, saleId, paid.toFixed(2), input.paid_by]
        );
      }

      return {
        id: saleId,
        tenant_id: tenantId,
        customer_id: customer?.id ?? null,
        customer_name: customer?.name ?? 'Cliente ocasional',
        store_id: storeId,
        total: total.toFixed(2),
        tax_total: taxTotal.toFixed(2),
        grand_total: grandTotal.toFixed(2),
        paid: paid.toFixed(2),
        status,
        paid_by: input.paid_by ?? null,
        amount_received: amountReceived === null ? null : amountReceived.toFixed(2),
        change_amount: change.toFixed(2),
        created_at: saleCreatedAt,
        total_items: prepared.length,
        total_quantity: totalQuantity.toFixed(2),
        total_reward_points: totalRewardPoints,
        items: prepared.map((line) => ({
          product_id: line.productId,
          code: line.code,
          name: line.name,
          quantity: line.quantity.toFixed(2),
          unit_price: line.unitPrice.toFixed(2),
          subtotal: line.subtotal.toFixed(2),
          reward_points: line.rewardPoints
        }))
      };
    });
  }

  async dailyReport(tenantId: string, date: string, user: PosUser) {
    const isAdmin = user.group_name?.toLowerCase() === 'admin';
    const result = await this.database.query<DailyReportRow>(
      `SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*)::integer AS sales_count,
              COALESCE(SUM(total), 0)::text AS total,
              COALESCE(SUM(grand_total), 0)::text AS grand_total,
              COALESCE(SUM(paid), 0)::text AS paid
       FROM public.tec_sales
       WHERE tenant_id = $1
         AND created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
         AND created_at < (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
         AND ($3::boolean OR created_by = $4)
       GROUP BY TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      [tenantId, date, isAdmin, user.id]
    );
    return result.rows[0] ?? {
      day: date,
      sales_count: 0,
      total: '0.00',
      grand_total: '0.00',
      paid: '0.00'
    };
  }

  async list(
    tenantId: string,
    user: PosUser,
    from: string | undefined,
    to: string | undefined,
    pagination: PaginationQuery
  ): Promise<Paginated<SalesListRow>> {
    if ((from && !to) || (!from && to)) throw new BadRequestException('from and to must be supplied together');
    if (from && to && from > to) throw new BadRequestException('from must be on or before to');
    const isAdmin = user.group_name?.toLowerCase() === 'admin';

    if (from && to) {
      const values: unknown[] = [tenantId, from, to];
      let ownerFilter = '';
      if (!isAdmin) {
        values.push(user.id);
        ownerFilter = ` AND created_by = $${values.length}`;
      }
      values.push(pagination.limit, pagination.offset);
      const result = await this.database.query<SalesListRow & { total_count: number }>(
        `SELECT id, tenant_id, customer_id, customer_name, total::text AS total,
                grand_total::text AS grand_total, paid::text AS paid, total_items,
                total_quantity::text AS total_quantity, status, created_at, created_by,
                store_id, total_reward_points, status_delivery,
                COUNT(*) OVER() AS total_count
         FROM public.tec_sales
         WHERE tenant_id = $1
           AND created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND created_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
           ${ownerFilter}
         ORDER BY created_at DESC, id DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );
      const total = result.rows[0]?.total_count ?? 0;
      const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
      return buildPaginated(data, total, pagination);
    }

    const values: unknown[] = [tenantId];
    let ownerFilter = '';
    if (!isAdmin) {
      values.push(user.id);
      ownerFilter = ` AND created_by = $${values.length}`;
    }
    values.push(pagination.limit, pagination.offset);
    const result = await this.database.query<SalesListRow & { total_count: number }>(
      `SELECT id, tenant_id, customer_id, customer_name, total::text AS total,
              grand_total::text AS grand_total, paid::text AS paid, total_items,
              total_quantity::text AS total_quantity, status, created_at, created_by,
              store_id, total_reward_points, status_delivery,
              COUNT(*) OVER() AS total_count
       FROM public.tec_sales
       WHERE tenant_id = $1
       ${ownerFilter}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async detail(tenantId: string, user: PosUser, saleId: number) {
    const isAdmin = user.group_name?.toLowerCase() === 'admin';
    const values: unknown[] = [tenantId, saleId];
    let ownerFilter = '';
    if (!isAdmin) {
      values.push(user.id);
      ownerFilter = ` AND created_by = $${values.length}`;
    }

    const header = await this.database.query<SalesListRow>(
      `SELECT id, tenant_id, customer_id, customer_name, total::text AS total,
              grand_total::text AS grand_total, paid::text AS paid, total_items,
              total_quantity::text AS total_quantity, status, created_at, created_by,
              store_id, total_reward_points, status_delivery
       FROM public.tec_sales
       WHERE tenant_id = $1 AND id = $2${ownerFilter}
       LIMIT 1`,
      values
    );
    const sale = header.rows[0];
    if (!sale) throw new NotFoundException('Sale not found in this tenant');

    const [items, payments] = await Promise.all([
      this.database.query<SaleItemDetailRow>(
        `SELECT si.id, si.product_id, p.code, p.name,
                si.quantity::text AS quantity, si.unit_price::text AS unit_price,
                si.subtotal::text AS subtotal, si.reward_points
         FROM public.tec_sale_items si
         LEFT JOIN public.tec_products p
           ON p.id = si.product_id AND p.tenant_id = $1
         WHERE si.tenant_id = $1 AND si.sale_id = $2
         ORDER BY si.id`,
        [tenantId, saleId]
      ),
      this.database.query<SalePaymentDetailRow>(
        `SELECT id, amount::text AS amount, paid_by, created_at
         FROM public.tec_payments
         WHERE tenant_id = $1 AND sale_id = $2
         ORDER BY id`,
        [tenantId, saleId]
      )
    ]);

    return { ...sale, items: items.rows, payments: payments.rows };
  }

  async update(tenantId: string, user: PosUser, saleId: number, input: UpdateSaleDto) {
    if (user.group_name?.toLowerCase() !== 'admin') {
      throw new ForbiddenException('Administrator access required');
    }

    await this.database.transaction(async (client) => {
      const saleResult = await client.query<EditableSaleRow>(
        `SELECT id, customer_id, customer_name, paid::text AS paid, store_id
         FROM public.tec_sales
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1
         FOR UPDATE`,
        [tenantId, saleId]
      );
      const sale = saleResult.rows[0];
      if (!sale) throw new NotFoundException('Sale not found in this tenant');
      if (sale.store_id === null) throw new BadRequestException('Sale has no store assigned');

      const oldItemsResult = await client.query<SaleItemLockRow>(
        `SELECT product_id, quantity::text AS quantity, unit_price::text AS unit_price
         FROM public.tec_sale_items
         WHERE tenant_id = $1 AND sale_id = $2
         ORDER BY product_id`,
        [tenantId, saleId]
      );
      if (oldItemsResult.rowCount === 0) throw new BadRequestException('Sale has no items to edit');

      const oldItems = new Map<number, { quantity: Decimal; unitPrice: Decimal }>();
      for (const row of oldItemsResult.rows) {
        if (row.product_id === null) continue;
        const quantity = new Decimal(row.quantity ?? '0');
        const current = oldItems.get(row.product_id);
        if (current) {
          current.quantity = current.quantity.plus(quantity);
        } else {
          oldItems.set(row.product_id, { quantity, unitPrice: new Decimal(row.unit_price ?? '0') });
        }
      }
      if (oldItems.size === 0) {
        throw new BadRequestException('Sale contains custom items that cannot be edited from this POS');
      }

      const requested = new Map<number, Decimal>();
      for (const line of input.items) {
        if (requested.has(line.product_id)) {
          throw new BadRequestException(`Duplicate product ${line.product_id} in sale`);
        }
        if (!oldItems.has(line.product_id)) {
          throw new BadRequestException(`Product ${line.product_id} is not part of this sale`);
        }
        const quantity = new Decimal(line.quantity);
        if (!quantity.isFinite() || !quantity.isInteger() || quantity.lte(0)) {
          throw new BadRequestException('Each sale quantity must be a positive whole number');
        }
        requested.set(line.product_id, quantity);
      }

      let customer: { id: number; name: string | null } | null;
      if (input.customer_id === undefined) {
        customer = sale.customer_id === null ? null : { id: sale.customer_id, name: sale.customer_name };
      } else if (input.customer_id === null) {
        customer = null;
      } else {
        if (!Number.isSafeInteger(input.customer_id) || input.customer_id < 1) {
          throw new BadRequestException('customer_id must be a positive integer');
        }
        const customerResult = await client.query<CustomerIdNameRow>(
          `SELECT id, name FROM public.tec_customers
           WHERE tenant_id = $1 AND id = $2
             AND (store_id IS NULL OR store_id = $3)
           LIMIT 1
           FOR KEY SHARE`,
          [tenantId, input.customer_id, sale.store_id]
        );
        customer = customerResult.rows[0] ?? null;
        if (!customer) throw new NotFoundException('Customer not found in this tenant');
      }

      const productIds = [...oldItems.keys()].sort((a, b) => a - b);
      const prepared: Array<{
        productId: number;
        quantity: Decimal;
        unitPrice: Decimal;
        subtotal: Decimal;
        rewardPoints: number;
      }> = [];
      let total = new Decimal(0);
      let taxTotal = new Decimal(0);
      let totalQuantity = new Decimal(0);
      let totalRewardPoints = 0;

      for (const productId of productIds) {
        const old = oldItems.get(productId);
        if (!old) continue;

        const products = await client.query<ProductRow>(
          `SELECT id, code, name, price::text AS price, tax::text AS tax,
                  reward_points, type
           FROM public.tec_products
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1
           FOR UPDATE`,
          [tenantId, productId]
        );
        const product = products.rows[0];
        if (!product) throw new NotFoundException(`Product ${productId} not found in this tenant`);
        if (product.type === 'combo') {
          throw new BadRequestException(`Combo product ${productId} cannot be edited from this POS`);
        }

        const stockResult = await client.query<StockRow>(
          `SELECT quantity, price::text AS store_price
           FROM public.tec_product_store_qty
           WHERE tenant_id = $1 AND store_id = $2 AND product_id = $3
           LIMIT 2
           FOR UPDATE`,
          [tenantId, sale.store_id, productId]
        );
        if (stockResult.rowCount !== 1) {
          throw new NotFoundException(`Product ${productId} has no unique stock row for the sale store`);
        }

        const restored = await client.query(
          `UPDATE public.tec_product_store_qty
           SET quantity = quantity + $1
           WHERE tenant_id = $2 AND store_id = $3 AND product_id = $4
           RETURNING quantity`,
          [old.quantity.toNumber(), tenantId, sale.store_id, productId]
        );
        if (restored.rowCount !== 1) {
          throw new NotFoundException(`Stock row for product ${productId} could not be restored`);
        }

        const quantity = requested.get(productId);
        if (!quantity) continue;

        const deducted = await client.query(
          `UPDATE public.tec_product_store_qty
           SET quantity = quantity - $1
           WHERE tenant_id = $2 AND store_id = $3 AND product_id = $4 AND quantity >= $1
           RETURNING quantity`,
          [quantity.toNumber(), tenantId, sale.store_id, productId]
        );
        if (deducted.rowCount !== 1) {
          throw new BadRequestException(`Insufficient store stock for product ${productId}`);
        }

        const unitPrice = old.unitPrice;
        if (!unitPrice.isFinite() || unitPrice.isNegative()) {
          throw new BadRequestException(`Product ${productId} has an invalid sale price`);
        }
        const lineSubtotal = unitPrice.times(quantity).toDecimalPlaces(2, MONEY_ROUNDING);
        const taxRate = new Decimal(product.tax ?? '0');
        if (!taxRate.isFinite() || taxRate.isNegative()) {
          throw new BadRequestException(`Product ${productId} has an invalid tax rate`);
        }
        const lineTax = lineSubtotal.times(taxRate).dividedBy(100).toDecimalPlaces(2, MONEY_ROUNDING);
        const rewardsPerUnit = Number(product.reward_points ?? 0);
        if (!Number.isSafeInteger(rewardsPerUnit) || rewardsPerUnit < 0) {
          throw new BadRequestException(`Product ${productId} has invalid reward points`);
        }
        const lineRewards = rewardsPerUnit * quantity.toNumber();
        if (!Number.isSafeInteger(lineRewards)) throw new BadRequestException('Reward points are out of range');

        prepared.push({ productId, quantity, unitPrice, subtotal: lineSubtotal, rewardPoints: lineRewards });
        total = total.plus(lineSubtotal);
        taxTotal = taxTotal.plus(lineTax);
        totalQuantity = totalQuantity.plus(quantity);
        totalRewardPoints += lineRewards;
        if (!Number.isSafeInteger(totalRewardPoints)) {
          throw new BadRequestException('Total reward points are out of range');
        }
      }

      if (prepared.length === 0) throw new BadRequestException('Sale must keep at least one item');

      total = total.toDecimalPlaces(2, MONEY_ROUNDING);
      const grandTotal = total.plus(taxTotal).toDecimalPlaces(2, MONEY_ROUNDING);
      const paid = new Decimal(sale.paid ?? '0');
      if (paid.gt(grandTotal)) {
        throw new BadRequestException('El pago registrado supera el nuevo total; ajusta los pagos antes de editar.');
      }
      const status = paid.gte(grandTotal) ? 'paid' : (paid.eq(0) ? 'due' : 'partial');

      await client.query(
        `UPDATE public.tec_sales
         SET customer_id = $1, customer_name = $2, total = $3, grand_total = $4,
             total_items = $5, total_quantity = $6, status = $7, total_reward_points = $8
         WHERE tenant_id = $9 AND id = $10`,
        [
          customer?.id ?? null,
          customer?.name ?? 'Cliente ocasional',
          total.toFixed(2),
          grandTotal.toFixed(2),
          prepared.length,
          totalQuantity.toFixed(2),
          status,
          totalRewardPoints,
          tenantId,
          saleId
        ]
      );

      await client.query(
        'DELETE FROM public.tec_sale_items WHERE tenant_id = $1 AND sale_id = $2',
        [tenantId, saleId]
      );
      for (const line of prepared) {
        await client.query(
          `INSERT INTO public.tec_sale_items
            (tenant_id, sale_id, product_id, quantity, unit_price, subtotal, reward_points)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            tenantId,
            saleId,
            line.productId,
            line.quantity.toFixed(2),
            line.unitPrice.toFixed(2),
            line.subtotal.toFixed(2),
            line.rewardPoints
          ]
        );
      }
    });

    return this.detail(tenantId, user, saleId);
  }

  async remove(tenantId: string, user: PosUser, saleId: number) {
    if (user.group_name?.toLowerCase() !== 'admin') {
      throw new ForbiddenException('Administrator access required');
    }

    await this.database.transaction(async (client) => {
      const saleResult = await client.query<{ id: number; store_id: number | null }>(
        `SELECT id, store_id
         FROM public.tec_sales
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1
         FOR UPDATE`,
        [tenantId, saleId]
      );
      const sale = saleResult.rows[0];
      if (!sale) throw new NotFoundException('Sale not found in this tenant');
      if (sale.store_id === null) throw new BadRequestException('Sale has no store assigned');

      const items = await client.query<SaleItemLockRow>(
        `SELECT product_id, quantity::text AS quantity, unit_price::text AS unit_price
         FROM public.tec_sale_items
         WHERE tenant_id = $1 AND sale_id = $2
         ORDER BY product_id`,
        [tenantId, saleId]
      );

      const restoreByProduct = new Map<number, Decimal>();
      for (const row of items.rows) {
        if (row.product_id === null) continue;
        const quantity = new Decimal(row.quantity ?? '0');
        restoreByProduct.set(
          row.product_id,
          (restoreByProduct.get(row.product_id) ?? new Decimal(0)).plus(quantity)
        );
      }

      const productIds = [...restoreByProduct.keys()].sort((a, b) => a - b);
      for (const productId of productIds) {
        const products = await client.query<ProductRow>(
          `SELECT id, code, name, price::text AS price, tax::text AS tax,
                  reward_points, type
           FROM public.tec_products
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1
           FOR UPDATE`,
          [tenantId, productId]
        );
        const product = products.rows[0];
        if (!product) throw new NotFoundException(`Product ${productId} not found in this tenant`);
        if (product.type === 'combo') {
          throw new BadRequestException(`Combo product ${productId} cannot be deleted from this POS`);
        }

        const restored = await client.query(
          `UPDATE public.tec_product_store_qty
           SET quantity = quantity + $1
           WHERE tenant_id = $2 AND store_id = $3 AND product_id = $4
           RETURNING quantity`,
          [restoreByProduct.get(productId)?.toNumber() ?? 0, tenantId, sale.store_id, productId]
        );
        if (restored.rowCount !== 1) {
          throw new NotFoundException(`Stock row for product ${productId} could not be restored`);
        }
      }

      await client.query(
        'DELETE FROM public.tec_sale_items WHERE tenant_id = $1 AND sale_id = $2',
        [tenantId, saleId]
      );
      await client.query(
        'DELETE FROM public.tec_payments WHERE tenant_id = $1 AND sale_id = $2',
        [tenantId, saleId]
      );
      await client.query(
        'DELETE FROM public.tec_sales WHERE tenant_id = $1 AND id = $2',
        [tenantId, saleId]
      );
    });

    return { id: saleId, deleted: true };
  }
}
