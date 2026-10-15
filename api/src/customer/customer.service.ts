import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PosCustomer } from '../auth/auth.types';
import { CatalogService } from '../catalog/catalog.service';
import { CategoriesService } from '../categories/categories.service';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { DatabaseService } from '../database/database.service';
import { UpdateCustomerProfileDto } from './customer.dto';

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
  private categoriesProbe: { exists: boolean; at: number } | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly catalog: CatalogService,
    private readonly categoriesService: CategoriesService
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
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        points_balance: customer.points_balance
      },
      recent_points: activity.rows
    };
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
