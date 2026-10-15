import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PosCustomer } from '../auth/auth.types';
import { CatalogService } from '../catalog/catalog.service';
import { CategoriesService } from '../categories/categories.service';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { DatabaseService } from '../database/database.service';
import { SettingsService } from '../settings/settings.service';
import { TenantManagementService } from '../tenant-management/tenant-management.service';
import { RedeemProductDto, UpdateCustomerProfileDto } from './customer.dto';

const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;
const PROBE_CACHE_MS = 60_000;

type StoreRow = {
  id: number;
  name: string;
  code: string | null;
};

type CustomerCategory = {
  id: string;
  name: string;
  image_url: string | null;
};

type CustomerPointActivityRow = {
  id: number;
  created_at: string | null;
  grand_total: string | null;
  total_reward_points: number | null;
};

type CustomerOrderRow = {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  total: string | null;
  grand_total: string | null;
  paid: string | null;
  total_items: number | null;
  total_quantity: string | null;
  status: string | null;
  status_delivery: string | null;
  payment_method: string | null;
  total_reward_points: number | null;
  created_at: string | null;
  store_id: number | null;
};

type CustomerOrderHeaderRow = CustomerOrderRow & {
  total_discount: string | null;
  order_discount_id: string | null;
};

type CustomerOrderItemRow = {
  id: number;
  product_id: number | null;
  code: string | null;
  name: string | null;
  quantity: string | null;
  unit_price: string | null;
  subtotal: string | null;
  reward_points: number | null;
};

type CustomerOrderPaymentRow = {
  id: number;
  amount: string | null;
  paid_by: string | null;
  created_at: string | null;
};

type CustomerProfileRow = {
  id: number;
  tenant_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  points_balance: number;
};

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);
  private readonly recentRedemptions = new Map<string, number>();
  private categoriesProbe: { exists: boolean; at: number } | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly catalog: CatalogService,
    private readonly categoriesService: CategoriesService,
    private readonly settings: SettingsService,
    private readonly tenantManagement: TenantManagementService
  ) {}

  async stores(tenantId: string): Promise<StoreRow[]> {
    const result = await this.database.query<StoreRow>(
      `SELECT id, name, code
       FROM public.tec_stores
       WHERE tenant_id = $1
       ORDER BY name
       LIMIT 100`,
      [tenantId]
    );
    return result.rows;
  }

  async categories(tenantId: string): Promise<CustomerCategory[]> {
    if (!(await this.categoriesTableExists())) return [];
    const rows = await this.categoriesService.list(tenantId);
    return rows
      .map((row) => ({ id: row.id, name: row.name, image_url: row.image_url ?? null }))
      .filter((category) => category.id !== '' && category.name.trim() !== '');
  }

  private async categoriesTableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.categoriesProbe && now - this.categoriesProbe.at < PROBE_CACHE_MS) {
      return this.categoriesProbe.exists;
    }
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.tec_categories')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.categoriesProbe = { exists, at: now };
    return exists;
  }

  async products(tenantId: string, storeId: number, search: string, categoryId?: string) {
    return this.catalog.listProducts(tenantId, search, storeId, categoryId, true);
  }

  async rewards(tenantId: string) {
    return this.catalog.listRewardProducts(tenantId);
  }

  async updateProfile(tenantId: string, customerId: number, input: UpdateCustomerProfileDto): Promise<CustomerProfileRow> {
    const name = input.name?.trim();
    const email = input.email?.trim() ?? null;
    const phone = input.phone === undefined ? null : input.phone.replace(/\D/g, '');
    const result = await this.database.query<CustomerProfileRow>(
      `UPDATE public.tec_customers
       SET name = COALESCE($3, name),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone)
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, tenant_id::text AS tenant_id, name, email, phone,
                 COALESCE(points_balance, 0)::integer AS points_balance`,
      [
        tenantId,
        customerId,
        name !== undefined && name.length > 0 ? name : null,
        email !== null && email.length > 0 ? email : null,
        phone !== null && phone.length > 0 ? phone : null
      ]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Customer not found');
    return row;
  }

  async profile(tenantId: string, customer: PosCustomer) {
    const activity = await this.database.query<CustomerPointActivityRow>(
      `SELECT id, created_at, grand_total::text AS grand_total, total_reward_points
       FROM public.tec_sales
       WHERE tenant_id = $1 AND customer_id = $2
         AND status IN ('paid', 'partial')
         AND total_reward_points > 0
       ORDER BY created_at DESC, id DESC
       LIMIT 5`,
      [tenantId, customer.id]
    );
    const tenant = await this.tenantBranding(tenantId);
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        points_balance: customer.points_balance
      },
      tenant,
      recent_points: activity.rows
    };
  }

  private async tenantBranding(tenantId: string): Promise<{ id: string; name: string | null; logo_url: string | null }> {
    const tenantResult = await this.database.query<{ id: string; name: string | null }>(
      'SELECT id::text AS id, name FROM public.tec_tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    const tenantRow = tenantResult.rows[0];
    if (!tenantRow) {
      this.logger.warn(`Customer profile branding: tenant ${tenantId} not found in tec_tenants`);
    }

    let logoUrl: string | null = null;
    let source = 'none';

    // 1) Fuente principal: tec_tenant_settings (branding por tenant).
    try {
      const direct = await this.database.query<{ logo_url: string | null }>(
        `SELECT logo_url
         FROM public.tec_tenant_settings
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      );
      const candidate = direct.rows[0]?.logo_url;
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        logoUrl = candidate.trim();
        source = 'tec_tenant_settings';
      }
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : (error instanceof Error ? error.name : 'UNKNOWN');
      this.logger.warn(`Customer profile branding: tec_tenant_settings lookup failed (${code})`);
    }

    // 2) Fallback: misma fuente que la web POS (soporta el modo legacy tec_settings).
    if (logoUrl === null) {
      try {
        const settings: unknown = await this.settings.getPosForTenant(tenantId);
        if (settings !== null && typeof settings === 'object' && 'logo_url' in settings) {
          const candidate = (settings as { logo_url?: unknown }).logo_url;
          if (typeof candidate === 'string' && candidate.trim() !== '') {
            logoUrl = candidate.trim();
            source = 'settings_service';
          }
        }
      } catch (error: unknown) {
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : (error instanceof Error ? error.name : 'UNKNOWN');
        this.logger.warn(`Customer profile branding: settings fallback failed (${code})`);
      }
    }

    this.logger.log(
      `Customer profile branding: tenant=${tenantId} name=${tenantRow?.name ?? 'null'} logo=${logoUrl === null ? 'none' : 'yes'} source=${source}`
    );
    return { id: tenantRow?.id ?? tenantId, name: tenantRow?.name ?? null, logo_url: logoUrl };
  }

  async redeem(tenantId: string, customer: PosCustomer, input: RedeemProductDto) {
    const duplicateKey = `${tenantId}:${customer.id}:${input.product_id}`;
    const lastAt = this.recentRedemptions.get(duplicateKey);
    if (lastAt !== undefined && Date.now() - lastAt < 60000) {
      throw new BadRequestException('Ya canjeaste este producto hace un momento; espera un minuto antes de reintentar');
    }

    const result = await this.database.transaction(async (client) => {
      const productResult = await client.query<{
        id: number;
        name: string | null;
        points_cost: number | null;
        quantity: number | null;
      }>(
        `SELECT id, name, COALESCE(points_cost, 0)::integer AS points_cost, quantity
         FROM public.tec_products
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1
         FOR UPDATE`,
        [tenantId, input.product_id]
      );
      const product = productResult.rows[0];
      if (!product) throw new NotFoundException('Product not found in this tenant');
      const pointsCost = product.points_cost ?? 0;
      if (pointsCost <= 0) throw new BadRequestException('Este producto no está disponible para canje');
      if ((product.quantity ?? 0) <= 0) throw new BadRequestException('Sin existencias');

      const customerResult = await client.query<{ id: number; points_balance: number }>(
        `SELECT id, COALESCE(points_balance, 0)::integer AS points_balance
         FROM public.tec_customers
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1
         FOR UPDATE`,
        [tenantId, customer.id]
      );
      const customerRow = customerResult.rows[0];
      if (!customerRow) throw new NotFoundException('Customer not found');
      if (customerRow.points_balance < pointsCost) {
        throw new BadRequestException('Saldo de puntos insuficiente');
      }

      const updatedCustomer = await client.query<{ points_balance: number }>(
        `UPDATE public.tec_customers
         SET points_balance = points_balance - $3
         WHERE tenant_id = $1 AND id = $2
         RETURNING COALESCE(points_balance, 0)::integer AS points_balance`,
        [tenantId, customer.id, pointsCost]
      );

      await client.query(
        `UPDATE public.tec_products
         SET quantity = quantity - 1
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, input.product_id]
      );

      const sale = await client.query<{ id: number }>(
        `INSERT INTO public.tec_sales
           (tenant_id, customer_id, customer_name, total, grand_total, paid,
            total_items, total_quantity, status, status_delivery, created_by, store_id,
            payment_method, total_reward_points,
            product_discount, order_discount, total_discount, product_tax, order_tax, total_tax, rounding)
         VALUES ($1, $2, $3, 0, 0, 0, 1, 1, 'due', NULL, NULL, NULL, 'points', 0, 0, 0, 0, 0, 0, 0, 0)
         RETURNING id`,
        [tenantId, customer.id, customer.name ?? null]
      );
      const orderId = sale.rows[0]?.id;
      if (orderId === undefined) throw new BadRequestException('Redemption order could not be created');

      await client.query(
        `INSERT INTO public.tec_sale_items
           (tenant_id, sale_id, product_id, quantity, unit_price, subtotal, reward_points)
         VALUES ($1, $2, $3, 1, 0, 0, 0)`,
        [tenantId, orderId, input.product_id]
      );

      return {
        order_id: orderId,
        new_balance: updatedCustomer.rows[0]?.points_balance ?? customerRow.points_balance - pointsCost,
        product_name: product.name,
        points_cost: pointsCost
      };
    });

    this.recentRedemptions.set(duplicateKey, Date.now());
    this.logger.log(
      `Points redeemed tenant=${tenantId} customer=${customer.id} product=${input.product_id} cost=${result.points_cost} order=${result.order_id} new_balance=${result.new_balance}`
    );
    await this.tenantManagement.logActivity(
      tenantId,
      'customer_points_redeemed',
      {
        customer_id: customer.id,
        product_id: input.product_id,
        product_name: result.product_name,
        order_id: result.order_id,
        new_balance: result.new_balance
      },
      null
    );
    return { success: true, new_balance: result.new_balance, order_id: result.order_id };
  }

  async orders(
    tenantId: string,
    customerId: number,
    pagination: PaginationQuery
  ): Promise<Paginated<CustomerOrderRow>> {
    const result = await this.database.query<CustomerOrderRow & { total_count: number }>(
      `SELECT id, customer_id, customer_name, total::text AS total,
              grand_total::text AS grand_total, paid::text AS paid, total_items,
              total_quantity::text AS total_quantity, status, status_delivery,
              payment_method, total_reward_points, created_at, store_id,
              COUNT(*) OVER() AS total_count
       FROM public.tec_sales
       WHERE tenant_id = $1 AND customer_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [tenantId, customerId, pagination.limit, pagination.offset]
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async orderDetail(tenantId: string, customerId: number, saleId: number) {
    const header = await this.database.query<CustomerOrderHeaderRow>(
      `SELECT id, customer_id, customer_name, total::text AS total,
              grand_total::text AS grand_total, paid::text AS paid, total_items,
              total_quantity::text AS total_quantity, status, status_delivery,
              payment_method, total_reward_points, created_at, store_id,
              total_discount::text AS total_discount, order_discount_id
       FROM public.tec_sales
       WHERE tenant_id = $1 AND id = $2 AND customer_id = $3
       LIMIT 1`,
      [tenantId, saleId, customerId]
    );
    const sale = header.rows[0];
    if (!sale) throw new NotFoundException('Order not found');

    const [items, payments] = await Promise.all([
      this.database.query<CustomerOrderItemRow>(
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
      this.database.query<CustomerOrderPaymentRow>(
        `SELECT id, amount::text AS amount, paid_by, created_at
         FROM public.tec_payments
         WHERE tenant_id = $1 AND sale_id = $2
         ORDER BY id`,
        [tenantId, saleId]
      )
    ]);

    const taxTotal = new Decimal(sale.grand_total ?? '0')
      .minus(sale.total ?? '0')
      .plus(sale.total_discount ?? '0')
      .toDecimalPlaces(2, MONEY_ROUNDING)
      .toFixed(2);

    return { ...sale, tax_total: taxTotal, items: items.rows, payments: payments.rows };
  }
}
