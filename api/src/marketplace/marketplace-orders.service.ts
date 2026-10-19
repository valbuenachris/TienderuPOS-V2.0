import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PosMarketplaceCustomer } from '../auth/auth.types';
import { CatalogService } from '../catalog/catalog.service';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { DatabaseService, SqlExecutor } from '../database/database.service';
import {
  MarketplaceCheckoutDto,
  MarketplaceOrderStatusDto,
  MarketplacePayoutMarkDto
} from './marketplace.dto';
import { MarketplaceMaintenanceService } from './marketplace-maintenance.service';
import { computeParentOrderStatus } from './marketplace-order-status';
import { MarketplacePaymentsService } from './marketplace-payments.service';
import { MarketplaceSettingsService } from './marketplace-settings.service';

const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;
const MAX_PENDING_ORDERS_PER_CUSTOMER = 5;
const CHECKOUT_DEDUPE_WINDOW_MS = 60_000;
const SUBORDER_STATUS_RANK: Record<string, number> = {
  pending: 0,
  paid: 1,
  preparing: 2,
  shipped: 3,
  delivered: 4
};

type MarketplaceProductLockRow = {
  id: number;
  tenant_id: string;
  code: string | null;
  name: string | null;
  price: string | null;
  tax: string | null;
  quantity: number | null;
  type: string | null;
  image: string | null;
  image_2: string | null;
  image_3: string | null;
  reward_points: number | null;
  tenant_status: string | null;
  tenant_name: string | null;
  mkp_enabled: boolean | null;
  markup_percent: string | null;
};

type StoreRow = { id: number };
type OrderIdRow = { id: number };

type PreparedLine = {
  productId: number;
  tenantId: string;
  tenantName: string;
  code: string | null;
  name: string;
  image: string | null;
  quantity: number;
  unitPrice: Decimal;
  commissionUnit: Decimal;
  lineBase: Decimal;
  lineTax: Decimal;
  lineSubtotal: Decimal;
  lineTotal: Decimal;
  commissionTotal: Decimal;
  rewardPointsPerUnit: number;
};

export type MarketplaceOrderRow = {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  shipping_recipient: string;
  shipping_phone: string;
  shipping_address: string;
  shipping_neighborhood: string | null;
  shipping_city: string;
  shipping_notes: string | null;
  products_total: string;
  shipping_total: string;
  grand_total: string;
  commission_total: string;
  tenant_total: string;
  status: string;
  payment_method: string;
  payment_status: string;
  checkout_url: string | null;
  paid_at: string | null;
  created_at: string | null;
  total_count?: number;
};

export type MarketplaceSuborderRow = {
  id: number;
  order_id: number;
  tenant_id: string;
  sale_id: number | null;
  suborder_number: string;
  status: string;
  products_total: string;
  shipping_total: string;
  tenant_total: string;
  commission: string;
  tracking_note: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  payout_status: string;
  paid_out_at: string | null;
  created_at: string | null;
  total_count?: number;
};

export type MarketplaceOrderItemRow = {
  id: number;
  order_id: number;
  suborder_id: number;
  tenant_id: string;
  product_id: number;
  product_code: string | null;
  product_name: string;
  product_image: string | null;
  quantity: number;
  base_unit_price: string;
  unit_price: string;
  commission_unit: string;
  line_base: string;
  line_tax: string;
  line_subtotal: string;
  line_total: string;
  commission_total: string;
};

type AddressRow = {
  id: number;
  recipient_name: string;
  street_address: string;
  neighborhood: string | null;
  city: string | null;
  phone: string | null;
  additional_notes: string | null;
};

@Injectable()
export class MarketplaceOrdersService {
  private readonly logger = new Logger(MarketplaceOrdersService.name);
  /** Anti-duplicado de checkout (en memoria): fingerprint de items -> timestamp. */
  private readonly recentCheckouts = new Map<string, number>();

  constructor(
    private readonly database: DatabaseService,
    private readonly catalog: CatalogService,
    private readonly settings: MarketplaceSettingsService,
    private readonly payments: MarketplacePaymentsService,
    private readonly maintenance: MarketplaceMaintenanceService
  ) {}

  // ---------------------------------------------------------------------------
  // Cliente: checkout y mis pedidos
  // ---------------------------------------------------------------------------

  async checkout(customer: PosMarketplaceCustomer, input: MarketplaceCheckoutDto) {
    await this.settings.assertAvailable();

    const quantities = new Map<number, number>();
    for (const item of input.items) {
      quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + item.quantity);
    }
    if (quantities.size === 0) throw new BadRequestException('El carrito está vacío');
    const totalUnits = [...quantities.values()].reduce((sum, value) => sum + value, 0);
    if (totalUnits > 999) throw new BadRequestException('El pedido supera el máximo de unidades');

    // Anti-abuso (v0.11.0): limita pedidos pendientes simultáneos y duplicados inmediatos.
    const pending = await this.database.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM public.tec_marketplace_orders
       WHERE customer_id = $1 AND status = 'pending_payment'`,
      [customer.id]
    );
    if ((pending.rows[0]?.count ?? 0) >= MAX_PENDING_ORDERS_PER_CUSTOMER) {
      throw new BadRequestException(
        'Tienes varios pedidos pendientes de pago. Completa el pago o espera su cancelación automática antes de crear otro.'
      );
    }
    const fingerprint = `${customer.id}|${[...quantities.entries()]
      .map(([productId, quantity]) => `${productId}x${quantity}`)
      .sort()
      .join(',')}`;
    const now = Date.now();
    const lastCheckout = this.recentCheckouts.get(fingerprint);
    if (lastCheckout !== undefined && now - lastCheckout < CHECKOUT_DEDUPE_WINDOW_MS) {
      throw new BadRequestException('Este pedido ya está en proceso. Revisa «Mis pedidos» para completar el pago.');
    }
    this.recentCheckouts.set(fingerprint, now);
    for (const [key, at] of this.recentCheckouts) {
      if (now - at > CHECKOUT_DEDUPE_WINDOW_MS) this.recentCheckouts.delete(key);
    }

    const addressResult = await this.database.query<AddressRow>(
      `SELECT id, recipient_name, street_address, neighborhood, city, phone, additional_notes
       FROM public.tec_marketplace_addresses
       WHERE id = $1 AND customer_id = $2
       LIMIT 1`,
      [input.address_id, customer.id]
    );
    const address = addressResult.rows[0];
    if (!address) throw new NotFoundException('Address not found');

    const shippingFlat = new Decimal(this.settings.shippingFlatValue());

    const created = await this.database.transaction(async (client) => {
      const productIds = [...quantities.keys()].sort((a, b) => a - b);
      const prepared: PreparedLine[] = [];

      for (const productId of productIds) {
        const quantity = quantities.get(productId) ?? 0;
        const products = await client.query<MarketplaceProductLockRow>(
          `SELECT p.id, p.tenant_id::text AS tenant_id, p.code, p.name, p.price::text AS price,
                  p.tax::text AS tax, p.quantity, p.type, p.image, p.image_2, p.image_3, p.reward_points,
                  t.status AS tenant_status, t.name AS tenant_name,
                  mk.enabled AS mkp_enabled, mk.markup_percent::text AS markup_percent
           FROM public.tec_products p
           JOIN public.tec_tenants t ON t.id = p.tenant_id
           LEFT JOIN public.tec_marketplace_settings mk ON mk.tenant_id = p.tenant_id
           WHERE p.id = $1
           LIMIT 1
           FOR UPDATE OF p`,
          [productId]
        );
        const product = products.rows[0];
        if (!product || product.tenant_status !== 'active' || product.mkp_enabled !== true) {
          throw new BadRequestException(`El producto ${productId} no está disponible en la tienda`);
        }
        if ((product.type ?? 'standard') === 'combo') {
          throw new BadRequestException(`El producto ${productId} no está disponible en la tienda`);
        }
        const stock = new Decimal(product.quantity ?? 0);
        if (stock.lt(quantity)) {
          throw new BadRequestException(`No hay existencias suficientes de «${product.name ?? productId}»`);
        }
        const base = new Decimal(product.price ?? 'NaN');
        if (!base.isFinite() || base.lte(0)) {
          throw new BadRequestException(`El producto ${productId} no tiene un precio válido`);
        }
        const taxRate = new Decimal(product.tax ?? '0');
        if (!taxRate.isFinite() || taxRate.isNegative()) {
          throw new BadRequestException(`El producto ${productId} tiene un impuesto inválido`);
        }
        const markup = new Decimal(product.markup_percent ?? '10');
        if (!markup.isFinite() || markup.isNegative()) {
          throw new BadRequestException(`El producto ${productId} tiene un markup inválido`);
        }

        const quantityDecimal = new Decimal(quantity);
        const lineBase = base.times(quantityDecimal).toDecimalPlaces(2, MONEY_ROUNDING);
        const lineTax = lineBase.times(taxRate).dividedBy(100).toDecimalPlaces(2, MONEY_ROUNDING);
        const lineSubtotal = lineBase.plus(lineTax);
        const lineTotal = lineSubtotal
          .times(new Decimal(1).plus(markup.dividedBy(100)))
          .toDecimalPlaces(2, MONEY_ROUNDING);
        const commissionTotal = lineTotal.minus(lineSubtotal).toDecimalPlaces(2, MONEY_ROUNDING);
        const baseWithTaxUnit = base.plus(base.times(taxRate).dividedBy(100).toDecimalPlaces(2, MONEY_ROUNDING));
        const unitPrice = baseWithTaxUnit
          .times(new Decimal(1).plus(markup.dividedBy(100)))
          .toDecimalPlaces(2, MONEY_ROUNDING);
        const commissionUnit = commissionTotal
          .dividedBy(quantityDecimal)
          .toDecimalPlaces(2, MONEY_ROUNDING);

        const updatedStock = await client.query<{ quantity: number | null }>(
          `UPDATE public.tec_products
           SET quantity = quantity - $1
           WHERE tenant_id = $2 AND id = $3 AND quantity >= $1
           RETURNING quantity`,
          [quantity, product.tenant_id, product.id]
        );
        if (updatedStock.rowCount !== 1) {
          throw new BadRequestException(`No hay existencias suficientes de «${product.name ?? productId}»`);
        }

        prepared.push({
          productId: product.id,
          tenantId: product.tenant_id,
          tenantName: product.tenant_name ?? 'Tienda',
          code: product.code,
          name: product.name ?? `Producto ${product.id}`,
          image: this.catalog.resolveProductImageUrl(product.image),
          quantity,
          unitPrice,
          commissionUnit,
          lineBase,
          lineTax,
          lineSubtotal,
          lineTotal,
          commissionTotal,
          rewardPointsPerUnit: Number(product.reward_points ?? 0)
        });
      }

      const byTenant = new Map<string, PreparedLine[]>();
      for (const line of prepared) {
        const group = byTenant.get(line.tenantId);
        if (group) {
          group.push(line);
        } else {
          byTenant.set(line.tenantId, [line]);
        }
      }

      const orderIdResult = await client.query<OrderIdRow>(
        `SELECT nextval(pg_get_serial_sequence('public.tec_marketplace_orders', 'id'))::bigint AS id`
      );
      const orderId = Number(orderIdResult.rows[0]?.id);
      if (!Number.isSafeInteger(orderId) || orderId < 1) {
        throw new BadRequestException('No se pudo crear el pedido');
      }
      const orderNumber = `TDR-${String(orderId).padStart(6, '0')}`;

      const productsTotal = prepared.reduce((sum, line) => sum.plus(line.lineTotal), new Decimal(0));
      const commissionTotal = prepared.reduce((sum, line) => sum.plus(line.commissionTotal), new Decimal(0));
      const tenantTotal = prepared.reduce((sum, line) => sum.plus(line.lineSubtotal), new Decimal(0));
      const grandTotal = productsTotal.plus(shippingFlat).toDecimalPlaces(2, MONEY_ROUNDING);

      await client.query(
        `INSERT INTO public.tec_marketplace_orders
           (id, order_number, customer_id, customer_name, customer_email, customer_phone,
            shipping_recipient, shipping_phone, shipping_address, shipping_neighborhood, shipping_city, shipping_notes,
            products_total, shipping_total, grand_total, commission_total, tenant_total,
            status, payment_method, payment_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, 'pending_payment', 'bold', 'pending')`,
        [
          orderId, orderNumber, customer.id, customer.name ?? 'Cliente', customer.email, customer.phone,
          address.recipient_name, address.phone, address.street_address, address.neighborhood,
          address.city ?? 'Bogotá', address.additional_notes,
          productsTotal.toFixed(2), shippingFlat.toFixed(2), grandTotal.toFixed(2),
          commissionTotal.toFixed(2), tenantTotal.toFixed(2)
        ]
      );

      let suborderIndex = 0;
      const suborders: Array<{ id: number; tenantId: string; saleId: number | null; tenantTotal: string }> = [];
      for (const [tenantId, lines] of byTenant) {
        suborderIndex += 1;
        const storeResult = await client.query<StoreRow>(
          `SELECT id FROM public.tec_stores WHERE tenant_id = $1 ORDER BY id ASC LIMIT 1`,
          [tenantId]
        );
        const storeId = storeResult.rows[0]?.id;
        if (storeId === undefined) {
          throw new BadRequestException('Uno de los vendedores no tiene tiendas configuradas');
        }

        const saleId = await this.createTenantSale(client, {
          tenantId,
          storeId,
          customerName: customer.name ?? 'Cliente',
          lines
        });

        const suborderTotal = lines.reduce((sum, line) => sum.plus(line.lineTotal), new Decimal(0));
        const suborderTenantTotal = lines.reduce((sum, line) => sum.plus(line.lineSubtotal), new Decimal(0));
        const suborderCommission = lines.reduce((sum, line) => sum.plus(line.commissionTotal), new Decimal(0));
        const suborderNumber = `${orderNumber}-${suborderIndex}`;

        const suborderResult = await client.query<SuborderIdRow>(
          `INSERT INTO public.tec_marketplace_suborders
             (order_id, tenant_id, sale_id, suborder_number, status, products_total, shipping_total,
              tenant_total, commission)
           VALUES ($1, $2, $3, $4, 'pending', $5, '0.00', $6, $7)
           RETURNING id`,
          [
            orderId, tenantId, saleId, suborderNumber,
            suborderTotal.toFixed(2), suborderTenantTotal.toFixed(2), suborderCommission.toFixed(2)
          ]
        );
        const suborderId = suborderResult.rows[0]?.id;
        if (suborderId === undefined) throw new BadRequestException('No se pudo crear la sub-orden');

        for (const line of lines) {
          await client.query(
            `INSERT INTO public.tec_marketplace_order_items
               (order_id, suborder_id, tenant_id, product_id, product_code, product_name, product_image,
                quantity, base_unit_price, unit_price, commission_unit, line_base, line_tax,
                line_subtotal, line_total, commission_total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              orderId, suborderId, tenantId, line.productId, line.code, line.name, line.image,
              line.quantity, line.lineBase.dividedBy(line.quantity).toDecimalPlaces(2, MONEY_ROUNDING).toFixed(2),
              line.unitPrice.toFixed(2), line.commissionUnit.toFixed(2), line.lineBase.toFixed(2),
              line.lineTax.toFixed(2), line.lineSubtotal.toFixed(2), line.lineTotal.toFixed(2),
              line.commissionTotal.toFixed(2)
            ]
          );
        }

        suborders.push({ id: suborderId, tenantId, saleId, tenantTotal: suborderTenantTotal.toFixed(2) });
      }

      return {
        order: {
          id: orderId,
          order_number: orderNumber,
          status: 'pending_payment',
          payment_method: 'bold',
          products_total: productsTotal.toFixed(2),
          shipping_total: shippingFlat.toFixed(2),
          grand_total: grandTotal.toFixed(2)
        },
        suborders
      };
    });

    let paymentUrl: string | null = null;
    try {
      const link = await this.payments.createPlatformLink({
        orderId: created.order.id,
        orderNumber: created.order.order_number,
        amount: created.order.grand_total,
        payerEmail: customer.email
      });
      paymentUrl = link.url;
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo crear el link Bold del pedido ${created.order.order_number}: ${error instanceof Error ? error.message : 'unknown'}`
      );
    }

    return { ...created.order, payment_url: paymentUrl };
  }

  async payOrder(customerId: number, orderId: number) {
    await this.settings.assertAvailable();
    const order = await this.getCustomerOrder(customerId, orderId);
    if (order.payment_status === 'paid') {
      throw new BadRequestException('Este pedido ya está pagado');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException('Este pedido fue cancelado');
    }
    const link = await this.payments.createPlatformLink({
      orderId: order.id,
      orderNumber: order.order_number,
      amount: order.grand_total,
      payerEmail: order.customer_email
    });
    return { order_id: order.id, order_number: order.order_number, payment_url: link.url, payment_method: 'bold' };
  }

  /** Cancelación del cliente (v0.11.0): solo pedidos impagos; repone stock y elimina la venta POS. */
  async cancelCustomerOrder(customerId: number, orderId: number) {
    await this.settings.assertAvailable();
    const order = await this.getCustomerOrder(customerId, orderId);
    if (order.payment_status === 'paid') {
      throw new BadRequestException('Este pedido ya está pagado; solicita la cancelación al vendedor.');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException('Este pedido ya fue cancelado');
    }
    const cancelled = await this.maintenance.cancelPendingOrder(orderId, { reason: 'customer' });
    if (!cancelled) {
      throw new BadRequestException(
        'Este pedido ya no se puede cancelar (solo pedidos sin pago confirmado y sin despacho iniciado).'
      );
    }
    return this.customerOrderDetail(customerId, orderId);
  }

  async listCustomerOrders(
    customerId: number,
    pagination: PaginationQuery
  ): Promise<Paginated<MarketplaceOrderRow & { suborders: MarketplaceCustomerSuborder[] }>> {
    if (!(await this.settings.tableExists())) return buildPaginated([], 0, pagination);
    const result = await this.database.query<MarketplaceOrderRow>(
      `SELECT id, order_number, customer_id, customer_name, customer_email, customer_phone,
              shipping_recipient, shipping_phone, shipping_address, shipping_neighborhood, shipping_city, shipping_notes,
              products_total::text AS products_total, shipping_total::text AS shipping_total,
              grand_total::text AS grand_total, commission_total::text AS commission_total,
              tenant_total::text AS tenant_total, status, payment_method, payment_status,
              checkout_url, paid_at, created_at, COUNT(*) OVER() AS total_count
       FROM public.tec_marketplace_orders
       WHERE customer_id = $1
       ORDER BY id DESC
       LIMIT $2 OFFSET $3`,
      [customerId, pagination.limit, pagination.offset]
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    const enriched = await this.attachChildren(data);
    return buildPaginated(enriched, total, pagination);
  }

  async customerOrderDetail(customerId: number, orderId: number) {
    const order = await this.getCustomerOrder(customerId, orderId);
    const [enriched] = await this.attachChildren([order]);
    return enriched;
  }

  private async getCustomerOrder(customerId: number, orderId: number): Promise<MarketplaceOrderRow> {
    const result = await this.database.query<MarketplaceOrderRow>(
      `SELECT id, order_number, customer_id, customer_name, customer_email, customer_phone,
              shipping_recipient, shipping_phone, shipping_address, shipping_neighborhood, shipping_city, shipping_notes,
              products_total::text AS products_total, shipping_total::text AS shipping_total,
              grand_total::text AS grand_total, commission_total::text AS commission_total,
              tenant_total::text AS tenant_total, status, payment_method, payment_status,
              checkout_url, paid_at, created_at
       FROM public.tec_marketplace_orders
       WHERE id = $1 AND customer_id = $2
       LIMIT 1`,
      [orderId, customerId]
    );
    const order = result.rows[0];
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ---------------------------------------------------------------------------
  // Vendedor (tenant admin)
  // ---------------------------------------------------------------------------

  async listTenantOrders(
    tenantId: string,
    status: string | undefined,
    pagination: PaginationQuery
  ): Promise<Paginated<MarketplaceSuborderRow & { order_number: string; customer_name: string; shipping_city: string }>> {
    await this.settings.assertAvailable();
    const values: unknown[] = [tenantId];
    let statusFilter = '';
    if (status !== undefined && status.trim() !== '') {
      const clean = status.trim().toLowerCase();
      if (!['pending', 'paid', 'preparing', 'shipped', 'delivered'].includes(clean)) {
        throw new BadRequestException('invalid status');
      }
      values.push(clean);
      statusFilter = ` AND s.status = $${values.length}`;
    }
    values.push(pagination.limit, pagination.offset);
    const result = await this.database.query<
      MarketplaceSuborderRow & { order_number: string; customer_name: string; shipping_city: string }
    >(
      `SELECT s.id, s.order_id, s.tenant_id::text AS tenant_id, s.sale_id, s.suborder_number, s.status,
              s.products_total::text AS products_total, s.shipping_total::text AS shipping_total,
              s.tenant_total::text AS tenant_total, s.commission::text AS commission,
              s.tracking_note, s.shipped_at, s.delivered_at, s.payout_status, s.paid_out_at, s.created_at,
              o.order_number, o.customer_name, o.shipping_city,
              COUNT(*) OVER() AS total_count
       FROM public.tec_marketplace_suborders s
       JOIN public.tec_marketplace_orders o ON o.id = s.order_id
       WHERE s.tenant_id = $1${statusFilter}
       ORDER BY s.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    const items = await this.loadSuborderItems(data.map((suborder) => suborder.id));
    return buildPaginated(
      data.map((suborder) => ({ ...suborder, items: items.get(suborder.id) ?? [] })),
      total,
      pagination
    );
  }

  async tenantOrderDetail(tenantId: string, suborderId: number) {
    const result = await this.database.query<
      MarketplaceSuborderRow & {
        order_number: string;
        customer_name: string;
        customer_email: string | null;
        customer_phone: string | null;
        shipping_recipient: string;
        shipping_phone: string;
        shipping_address: string;
        shipping_neighborhood: string | null;
        shipping_city: string;
        shipping_notes: string | null;
        order_status: string;
        paid_at: string | null;
      }
    >(
      `SELECT s.id, s.order_id, s.tenant_id::text AS tenant_id, s.sale_id, s.suborder_number, s.status,
              s.products_total::text AS products_total, s.shipping_total::text AS shipping_total,
              s.tenant_total::text AS tenant_total, s.commission::text AS commission,
              s.tracking_note, s.shipped_at, s.delivered_at, s.payout_status, s.paid_out_at, s.created_at,
              o.order_number, o.customer_name, o.customer_email, o.customer_phone,
              o.shipping_recipient, o.shipping_phone, o.shipping_address, o.shipping_neighborhood,
              o.shipping_city, o.shipping_notes, o.status AS order_status, o.paid_at
       FROM public.tec_marketplace_suborders s
       JOIN public.tec_marketplace_orders o ON o.id = s.order_id
       WHERE s.tenant_id = $1 AND s.id = $2
       LIMIT 1`,
      [tenantId, suborderId]
    );
    const suborder = result.rows[0];
    if (!suborder) throw new NotFoundException('Order not found');
    const items = await this.loadSuborderItems([suborderId]);
    return { ...suborder, items: items.get(suborderId) ?? [] };
  }

  async updateTenantOrderStatus(tenantId: string, suborderId: number, input: MarketplaceOrderStatusDto) {
    await this.settings.assertAvailable();
    // Cancelación del vendedor (v0.11.0): solo sub-órdenes impagas; repone stock y
    // elimina la venta POS si no tiene pagos. Las pagadas requieren reembolso manual.
    if (input.status === 'cancelled') {
      await this.maintenance.cancelSuborder(tenantId, suborderId);
      return this.tenantOrderDetail(tenantId, suborderId);
    }
    const targetRank = SUBORDER_STATUS_RANK[input.status];
    const note = input.note?.trim().slice(0, 300);

    await this.database.transaction(async (client) => {
      const current = await client.query<MarketplaceSuborderRow>(
        `SELECT id, order_id, tenant_id::text AS tenant_id, sale_id, suborder_number, status,
                products_total::text AS products_total, shipping_total::text AS shipping_total,
                tenant_total::text AS tenant_total, commission::text AS commission,
                tracking_note, shipped_at, delivered_at, payout_status, paid_out_at, created_at
         FROM public.tec_marketplace_suborders
         WHERE id = $1 AND tenant_id = $2
         LIMIT 1
         FOR UPDATE`,
        [suborderId, tenantId]
      );
      const suborder = current.rows[0];
      if (!suborder) throw new NotFoundException('Order not found');
      if (suborder.status === 'cancelled') {
        throw new BadRequestException('Este pedido fue cancelado');
      }
      if (suborder.status === 'pending') {
        throw new BadRequestException('El pago de este pedido aún no se ha confirmado');
      }
      const currentRank = SUBORDER_STATUS_RANK[suborder.status] ?? 1;
      if (targetRank <= currentRank) {
        throw new BadRequestException('El pedido ya está en ese estado o en uno posterior');
      }

      await client.query(
        `UPDATE public.tec_marketplace_suborders
         SET status = $3,
             tracking_note = COALESCE($4, tracking_note),
             shipped_at = CASE WHEN $3 IN ('shipped', 'delivered') THEN COALESCE(shipped_at, NOW()) ELSE shipped_at END,
             delivered_at = CASE WHEN $3 = 'delivered' THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [suborderId, tenantId, input.status, note ?? null]
      );

      // La venta del POS refleja el despacho igual que los pedidos de la app.
      if (suborder.sale_id !== null) {
        await client.query(
          `UPDATE public.tec_sales SET status_delivery = $3 WHERE id = $1 AND tenant_id = $2`,
          [suborder.sale_id, tenantId, input.status]
        );
      }

      await this.recomputeOrderStatus(client, suborder.order_id);
    });

    return this.tenantOrderDetail(tenantId, suborderId);
  }

  async tenantSummary(tenantId: string) {
    await this.settings.assertAvailable();
    const result = await this.database.query<{
      orders_count: number;
      pending_count: number;
      delivered_count: number;
      tenant_total: string;
      commission: string;
      payout_pending: string;
    }>(
      `SELECT COUNT(*) FILTER (WHERE status <> 'pending')::integer AS orders_count,
              COUNT(*) FILTER (WHERE status = 'pending')::integer AS pending_count,
              COUNT(*) FILTER (WHERE status = 'delivered')::integer AS delivered_count,
              COALESCE(SUM(tenant_total) FILTER (WHERE status <> 'pending'), 0)::text AS tenant_total,
              COALESCE(SUM(commission) FILTER (WHERE status <> 'pending'), 0)::text AS commission,
              COALESCE(SUM(tenant_total) FILTER (WHERE payout_status = 'pending' AND status <> 'pending'), 0)::text AS payout_pending
       FROM public.tec_marketplace_suborders
       WHERE tenant_id = $1`,
      [tenantId]
    );
    const row = result.rows[0];
    return {
      orders_count: row?.orders_count ?? 0,
      pending_count: row?.pending_count ?? 0,
      delivered_count: row?.delivered_count ?? 0,
      tenant_total: row?.tenant_total ?? '0.00',
      commission: row?.commission ?? '0.00',
      payout_pending: row?.payout_pending ?? '0.00'
    };
  }

  // ---------------------------------------------------------------------------
  // Super admin (plataforma)
  // ---------------------------------------------------------------------------

  async adminOrders(
    status: string | undefined,
    tenantId: string | undefined,
    pagination: PaginationQuery
  ): Promise<Paginated<MarketplaceOrderRow & { suborders_count: number; sellers: string; suborders: MarketplaceCustomerSuborder[] }>> {
    await this.settings.assertAvailable();
    const values: unknown[] = [];
    const filters: string[] = [];
    if (status !== undefined && status.trim() !== '') {
      const clean = status.trim().toLowerCase();
      if (!['pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled'].includes(clean)) {
        throw new BadRequestException('invalid status');
      }
      values.push(clean);
      filters.push(`o.status = $${values.length}`);
    }
    if (tenantId !== undefined && tenantId.trim() !== '') {
      values.push(tenantId.trim().toLowerCase());
      filters.push(`EXISTS (
        SELECT 1 FROM public.tec_marketplace_suborders sx
        WHERE sx.order_id = o.id AND sx.tenant_id = $${values.length}
      )`);
    }
    values.push(pagination.limit, pagination.offset);
    const result = await this.database.query<MarketplaceOrderRow & { suborders_count: number; sellers: string }>(
      `SELECT o.id, o.order_number, o.customer_id, o.customer_name, o.customer_email, o.customer_phone,
              o.shipping_recipient, o.shipping_phone, o.shipping_address, o.shipping_neighborhood, o.shipping_city, o.shipping_notes,
              o.products_total::text AS products_total, o.shipping_total::text AS shipping_total,
              o.grand_total::text AS grand_total, o.commission_total::text AS commission_total,
              o.tenant_total::text AS tenant_total, o.status, o.payment_method, o.payment_status,
              o.checkout_url, o.paid_at, o.created_at,
              (SELECT COUNT(*)::integer FROM public.tec_marketplace_suborders s WHERE s.order_id = o.id) AS suborders_count,
              (SELECT STRING_AGG(DISTINCT t.name, ', ') FROM public.tec_marketplace_suborders s
                 JOIN public.tec_tenants t ON t.id = s.tenant_id WHERE s.order_id = o.id) AS sellers,
              COUNT(*) OVER() AS total_count
       FROM public.tec_marketplace_orders o
       ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY o.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    const enriched = await this.attachChildren(data);
    return buildPaginated(enriched, total, pagination);
  }

  async adminSummary() {
    await this.settings.assertAvailable();
    const [totals, byTenant] = await Promise.all([
      this.database.query<{
        orders_count: number;
        paid_orders: number;
        gmv: string;
        commission: string;
        tenant_payable: string;
        pending_payment: number;
        pending_payout: string;
      }>(
        `SELECT COUNT(*)::integer AS orders_count,
                COUNT(*) FILTER (WHERE payment_status = 'paid')::integer AS paid_orders,
                COALESCE(SUM(grand_total) FILTER (WHERE payment_status = 'paid'), 0)::text AS gmv,
                COALESCE(SUM(commission_total) FILTER (WHERE payment_status = 'paid'), 0)::text AS commission,
                COALESCE(SUM(tenant_total) FILTER (WHERE payment_status = 'paid'), 0)::text AS tenant_payable,
                COUNT(*) FILTER (WHERE status = 'pending_payment')::integer AS pending_payment,
                COALESCE((SELECT SUM(s.tenant_total) FROM public.tec_marketplace_suborders s
                          WHERE s.payout_status = 'pending' AND s.status <> 'pending'), 0)::text AS pending_payout
         FROM public.tec_marketplace_orders`
      ),
      this.database.query<{ id: string; name: string; orders_count: number; pending_payout: string; paid_out: string }>(
        `SELECT t.id::text AS id, t.name,
                COUNT(*) FILTER (WHERE s.status <> 'pending')::integer AS orders_count,
                COALESCE(SUM(s.tenant_total) FILTER (WHERE s.payout_status = 'pending' AND s.status <> 'pending'), 0)::text AS pending_payout,
                COALESCE(SUM(s.tenant_total) FILTER (WHERE s.payout_status = 'paid'), 0)::text AS paid_out
         FROM public.tec_marketplace_suborders s
         JOIN public.tec_tenants t ON t.id = s.tenant_id
         GROUP BY t.id, t.name
         ORDER BY COALESCE(SUM(s.tenant_total) FILTER (WHERE s.payout_status = 'pending' AND s.status <> 'pending'), 0) DESC,
                  t.name ASC`
      )
    ]);
    return {
      ...(totals.rows[0] ?? {
        orders_count: 0,
        paid_orders: 0,
        gmv: '0.00',
        commission: '0.00',
        tenant_payable: '0.00',
        pending_payment: 0,
        pending_payout: '0.00'
      }),
      tenants: byTenant.rows
    };
  }

  async adminMarkPayouts(input: MarketplacePayoutMarkDto) {
    await this.settings.assertAvailable();
    const values: unknown[] = [input.tenant_id.trim().toLowerCase()];
    let idsFilter = '';
    if (input.suborder_ids !== undefined && input.suborder_ids.length > 0) {
      values.push(input.suborder_ids);
      idsFilter = ` AND id = ANY($${values.length}::bigint[])`;
    }
    const result = await this.database.query<{ marked: number; total: string }>(
      `WITH marked AS (
         UPDATE public.tec_marketplace_suborders
         SET payout_status = 'paid', paid_out_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1 AND payout_status = 'pending' AND status <> 'pending'${idsFilter}
         RETURNING tenant_total
       )
       SELECT COUNT(*)::integer AS marked, COALESCE(SUM(tenant_total), 0)::text AS total FROM marked`,
      values
    );
    return {
      tenant_id: input.tenant_id.trim().toLowerCase(),
      marked: result.rows[0]?.marked ?? 0,
      total: result.rows[0]?.total ?? '0.00'
    };
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  private async createTenantSale(
    client: SqlExecutor,
    input: {
      tenantId: string;
      storeId: number;
      customerName: string;
      lines: PreparedLine[];
    }
  ): Promise<number> {
    let total = new Decimal(0);
    let taxTotal = new Decimal(0);
    let totalQuantity = new Decimal(0);
    let totalRewardPoints = 0;
    for (const line of input.lines) {
      total = total.plus(line.lineBase);
      taxTotal = taxTotal.plus(line.lineTax);
      totalQuantity = totalQuantity.plus(line.quantity);
      totalRewardPoints += line.rewardPointsPerUnit * line.quantity;
    }
    total = total.toDecimalPlaces(2, MONEY_ROUNDING);
    taxTotal = taxTotal.toDecimalPlaces(2, MONEY_ROUNDING);
    const grandTotal = total.plus(taxTotal).toDecimalPlaces(2, MONEY_ROUNDING);

    const header = await client.query<{ id: number; created_at: string | null }>(
      `INSERT INTO public.tec_sales
        (tenant_id, customer_id, customer_name, total, grand_total, paid,
         total_items, total_quantity, status, created_by, store_id,
         total_reward_points, created_at, user_id, payment_method,
         product_discount, order_discount_id, order_discount, total_discount,
         product_tax, order_tax_id, order_tax, total_tax, rounding)
       VALUES ($1, NULL, $2, $3, $4, '0.00', $5, $6, 'due', NULL, $7,
               $8, CURRENT_TIMESTAMP, NULL, 'marketplace',
               '0.00', NULL, '0.00', '0.00', $9, NULL, '0.00', $9, '0.00')
       RETURNING id, created_at`,
      [
        input.tenantId, input.customerName, total.toFixed(2), grandTotal.toFixed(2),
        input.lines.length, totalQuantity.toFixed(2), input.storeId, totalRewardPoints, taxTotal.toFixed(2)
      ]
    );
    const saleId = header.rows[0]?.id;
    if (saleId === undefined) throw new BadRequestException('No se pudo crear la venta del vendedor');

    for (const line of input.lines) {
      await client.query(
        `INSERT INTO public.tec_sale_items
           (tenant_id, sale_id, product_id, quantity, unit_price, subtotal, reward_points)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.tenantId,
          saleId,
          line.productId,
          line.quantity,
          line.lineBase.dividedBy(line.quantity).toDecimalPlaces(2, MONEY_ROUNDING).toFixed(2),
          line.lineBase.toFixed(2),
          line.rewardPointsPerUnit * line.quantity
        ]
      );
    }
    return saleId;
  }

  private async recomputeOrderStatus(client: SqlExecutor, orderId: number): Promise<void> {
    const result = await client.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::integer AS count
       FROM public.tec_marketplace_suborders
       WHERE order_id = $1
       GROUP BY status`,
      [orderId]
    );
    const next = computeParentOrderStatus(result.rows);

    await client.query(
      `UPDATE public.tec_marketplace_orders
       SET status = CASE
             WHEN $2 = 'cancelled' THEN 'cancelled'
             WHEN status = 'pending_payment' THEN status
             ELSE $2
           END,
           updated_at = NOW()
       WHERE id = $1`,
      [orderId, next]
    );
  }

  private async attachChildren<T extends { id: number }>(
    orders: T[]
  ): Promise<Array<T & { suborders: MarketplaceCustomerSuborder[] }>> {
    if (orders.length === 0) return [];
    const suborderResult = await this.database.query<MarketplaceSuborderRow & { tenant_name: string }>(
      `SELECT s.id, s.order_id, s.tenant_id::text AS tenant_id, s.sale_id, s.suborder_number, s.status,
              s.products_total::text AS products_total, s.shipping_total::text AS shipping_total,
              s.tenant_total::text AS tenant_total, s.commission::text AS commission,
              s.tracking_note, s.shipped_at, s.delivered_at, s.payout_status, s.paid_out_at, s.created_at,
              t.name AS tenant_name
       FROM public.tec_marketplace_suborders s
       JOIN public.tec_tenants t ON t.id = s.tenant_id
       WHERE s.order_id = ANY($1::bigint[])
       ORDER BY s.id ASC`,
      [orders.map((order) => order.id)]
    );
    const items = await this.loadSuborderItems(suborderResult.rows.map((row) => row.id));
    const byOrder = new Map<number, MarketplaceCustomerSuborder[]>();
    for (const row of suborderResult.rows) {
      const suborder: MarketplaceCustomerSuborder = { ...row, items: items.get(row.id) ?? [] };
      const list = byOrder.get(row.order_id);
      if (list) list.push(suborder);
      else byOrder.set(row.order_id, [suborder]);
    }
    return orders.map((order) => ({ ...order, suborders: byOrder.get(order.id) ?? [] }));
  }

  private async loadSuborderItems(suborderIds: number[]): Promise<Map<number, MarketplaceOrderItemRow[]>> {
    const items = new Map<number, MarketplaceOrderItemRow[]>();
    if (suborderIds.length === 0) return items;
    const result = await this.database.query<MarketplaceOrderItemRow>(
      `SELECT id, order_id, suborder_id, tenant_id::text AS tenant_id, product_id, product_code, product_name,
              product_image, quantity, base_unit_price::text AS base_unit_price, unit_price::text AS unit_price,
              commission_unit::text AS commission_unit, line_base::text AS line_base, line_tax::text AS line_tax,
              line_subtotal::text AS line_subtotal, line_total::text AS line_total,
              commission_total::text AS commission_total
       FROM public.tec_marketplace_order_items
       WHERE suborder_id = ANY($1::bigint[])
       ORDER BY id ASC`,
      [suborderIds]
    );
    for (const row of result.rows) {
      const list = items.get(row.suborder_id);
      if (list) list.push(row);
      else items.set(row.suborder_id, [row]);
    }
    return items;
  }
}

type SuborderIdRow = { id: number };

export type MarketplaceCustomerSuborder = MarketplaceSuborderRow & {
  tenant_name: string;
  items: MarketplaceOrderItemRow[];
};
