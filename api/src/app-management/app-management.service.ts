import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { DatabaseService } from '../database/database.service';
import { TenantManagementService } from '../tenant-management/tenant-management.service';
import { AdjustPointsDto, CreateBannerDto, UpdateDeliveryStatusDto } from './app-management.dto';

export type AppOrderRow = {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  total: string | null;
  grand_total: string | null;
  paid: string | null;
  status: string | null;
  status_delivery: string | null;
  payment_method: string | null;
  total_items: number | null;
  total_reward_points: number | null;
  created_at: string | null;
  store_id: number | null;
};

export type AppCustomerRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  points_balance: number;
};

export type AdminReviewRow = {
  id: number;
  product_id: number;
  product_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  rating: number;
  comment: string | null;
  created_at: string | null;
};

export type AdminBannerRow = {
  id: string;
  image_url: string;
  created_at: string | null;
};

type CustomerPointsRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  points_balance: number;
};

type ReviewProductRow = { id: number };

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class AppManagementService {
  private readonly logger = new Logger(AppManagementService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly tenantManagement: TenantManagementService
  ) {}

  async listAppOrders(tenantId: string, pagination: PaginationQuery): Promise<Paginated<AppOrderRow>> {
    const result = await this.database.query<AppOrderRow & { total_count: number }>(
      `SELECT s.id, s.customer_id, s.customer_name, s.total::text AS total,
              s.grand_total::text AS grand_total, s.paid::text AS paid,
              s.status, s.status_delivery, s.payment_method,
              s.total_items, s.total_reward_points, s.created_at, s.store_id,
              COUNT(*) OVER() AS total_count
       FROM public.tec_sales s
       WHERE s.tenant_id = $1 AND s.created_by IS NULL
       ORDER BY s.created_at DESC NULLS LAST, s.id DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, pagination.limit, pagination.offset]
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async updateOrderDelivery(
    tenantId: string,
    saleId: number,
    input: UpdateDeliveryStatusDto
  ): Promise<AppOrderRow> {
    const status = input.status_delivery.trim();
    const result = await this.database.query<AppOrderRow>(
      `UPDATE public.tec_sales
       SET status_delivery = $3
       WHERE tenant_id = $1 AND id = $2 AND created_by IS NULL
       RETURNING id, customer_id, customer_name, total::text AS total,
                 grand_total::text AS grand_total, paid::text AS paid,
                 status, status_delivery, payment_method,
                 total_items, total_reward_points, created_at, store_id`,
      [tenantId, saleId, status === '' ? null : status]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('App order not found in this tenant');
    return row;
  }

  async listAppCustomers(
    tenantId: string,
    search: string,
    pagination: PaginationQuery
  ): Promise<Paginated<AppCustomerRow>> {
    const term = search.trim().slice(0, 100);
    const pattern = `%${escapeLike(term)}%`;
    const result = await this.database.query<AppCustomerRow & { total_count: number }>(
      `SELECT c.id, c.name, c.email, c.phone,
              COALESCE(c.points_balance, 0)::integer AS points_balance,
              COUNT(*) OVER() AS total_count
       FROM public.tec_customers c
       WHERE c.tenant_id = $1
         AND c.password IS NOT NULL
         AND ($2 = '' OR c.name ILIKE $3 OR c.email ILIKE $3 OR c.phone ILIKE $3)
       ORDER BY c.name NULLS LAST, c.id
       LIMIT $4 OFFSET $5`,
      [tenantId, term, pattern, pagination.limit, pagination.offset]
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async adjustCustomerPoints(tenantId: string, customerId: number, input: AdjustPointsDto) {
    if (input.amount === 0) throw new BadRequestException('amount must be different from 0');
    const result = await this.database.transaction(async (client) => {
      const existing = await client.query<CustomerPointsRow>(
        `SELECT id, name, email, phone, COALESCE(points_balance, 0)::integer AS points_balance
         FROM public.tec_customers
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1
         FOR UPDATE`,
        [tenantId, customerId]
      );
      const customer = existing.rows[0];
      if (!customer) throw new NotFoundException('Customer not found');

      const newBalance = customer.points_balance + input.amount;
      if (newBalance < 0) {
        throw new BadRequestException(
          `El cliente solo tiene ${customer.points_balance} punto(s); no se puede dejar el saldo en negativo`
        );
      }
      const updated = await client.query<CustomerPointsRow>(
        `UPDATE public.tec_customers
         SET points_balance = $3
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, name, email, phone, COALESCE(points_balance, 0)::integer AS points_balance`,
        [tenantId, customerId, newBalance]
      );
      return updated.rows[0];
    });

    this.logger.log(
      `Points adjusted tenant=${tenantId} customer=${customerId} amount=${input.amount} reason="${input.reason.trim()}" new_balance=${result.points_balance}`
    );
    await this.tenantManagement.logActivity(
      tenantId,
      'customer_points_adjusted',
      { customer_id: customerId, amount: input.amount, reason: input.reason.trim(), new_balance: result.points_balance },
      null
    );
    return result;
  }

  async resetCustomerPassword(tenantId: string, customerId: number) {
    const result = await this.database.query<{ id: number; email: string | null; phone: string | null }>(
      `UPDATE public.tec_customers
       SET password = NULL
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, email, phone`,
      [tenantId, customerId]
    );
    const customer = result.rows[0];
    if (!customer) throw new NotFoundException('Customer not found');

    const identities: string[] = [];
    if (customer.email?.trim()) identities.push(customer.email.trim().toLowerCase());
    if (customer.phone?.trim()) {
      const digits = customer.phone.replace(/\D/g, '');
      if (digits) identities.push(digits);
    }
    if (identities.length > 0) {
      await this.database.query(
        'DELETE FROM public.tec_login_attempts WHERE tenant_id = $1 AND login = ANY($2::text[])',
        [tenantId, identities]
      );
    }

    this.logger.log(`Customer password reset tenant=${tenantId} customer=${customerId}`);
    await this.tenantManagement.logActivity(tenantId, 'customer_password_reset', { customer_id: customerId }, null);
    return { id: customer.id, reset: true };
  }

  async listReviews(tenantId: string, pagination: PaginationQuery): Promise<Paginated<AdminReviewRow>> {
    const result = await this.database.query<AdminReviewRow & { total_count: number }>(
      `SELECT r.id, r.product_id, p.name AS product_name,
              r.customer_id, NULLIF(TRIM(c.name), '') AS customer_name,
              r.rating, r.comment, r.created_at,
              COUNT(*) OVER() AS total_count
       FROM public.product_reviews r
       JOIN public.tec_products p ON p.id = r.product_id AND p.tenant_id = $1
       LEFT JOIN public.tec_customers c ON c.id = r.customer_id
       ORDER BY r.created_at DESC NULLS LAST, r.id DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, pagination.limit, pagination.offset]
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async deleteReview(tenantId: string, reviewId: number): Promise<void> {
    const result = await this.database.query<ReviewProductRow>(
      `DELETE FROM public.product_reviews r
       USING public.tec_products p
       WHERE r.id = $2 AND p.id = r.product_id AND p.tenant_id = $1
       RETURNING r.id`,
      [tenantId, reviewId]
    );
    if (result.rowCount !== 1) throw new NotFoundException('Review not found in this tenant');
    await this.tenantManagement.logActivity(tenantId, 'review_deleted', { review_id: reviewId }, null);
  }

  async listBanners(): Promise<AdminBannerRow[]> {
    const result = await this.database.query<AdminBannerRow>(
      `SELECT id::text AS id, image_url, created_at
       FROM public.banners
       WHERE image_url IS NOT NULL AND btrim(image_url) <> ''
       ORDER BY created_at DESC NULLS LAST, id DESC
       LIMIT 50`
    );
    return result.rows;
  }

  async createBanner(input: CreateBannerDto): Promise<AdminBannerRow> {
    const imageUrl = input.image_url.trim();
    if (imageUrl === '') throw new BadRequestException('image_url is required');
    const result = await this.database.query<AdminBannerRow>(
      `INSERT INTO public.banners (image_url)
       VALUES ($1)
       RETURNING id::text AS id, image_url, created_at`,
      [imageUrl]
    );
    return result.rows[0];
  }

  async deleteBanner(bannerId: string): Promise<void> {
    const result = await this.database.query<{ id: string }>(
      'DELETE FROM public.banners WHERE id = $1::bigint RETURNING id::text AS id',
      [bannerId]
    );
    if (result.rowCount !== 1) throw new NotFoundException('Banner not found');
  }
}
