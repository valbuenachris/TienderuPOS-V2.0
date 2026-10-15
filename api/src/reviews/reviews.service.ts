import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PosCustomer } from '../auth/auth.types';
import { DatabaseService, SqlResult } from '../database/database.service';
import { CreateReviewDto } from './review.dto';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && String((error as { code?: unknown }).code) === '23505';
}

export type ReviewRow = {
  id: number;
  product_id: number;
  customer_id: number | null;
  customer_name: string | null;
  rating: number;
  comment: string | null;
  created_at: string | null;
};

const PROBE_CACHE_MS = 60_000;

@Injectable()
export class ReviewsService {
  private probe: { exists: boolean; at: number } | null = null;

  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, productId: number): Promise<ReviewRow[]> {
    await this.assertProduct(tenantId, productId);
    if (!(await this.tableExists())) return [];

    const result = await this.database.query<ReviewRow>(
      `SELECT r.id, r.product_id, r.customer_id, r.rating, r.comment, r.created_at,
              NULLIF(TRIM(c.name), '') AS customer_name
       FROM public.product_reviews r
       LEFT JOIN public.tec_customers c ON c.id = r.customer_id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 100`,
      [productId]
    );
    return result.rows;
  }

  async average(tenantId: string, productId: number) {
    await this.assertProduct(tenantId, productId);
    if (!(await this.tableExists())) {
      return { product_id: productId, average_rating: null as number | null, reviews_count: 0 };
    }

    const result = await this.database.query<{ average_rating: string | null; reviews_count: number }>(
      `SELECT ROUND(AVG(rating)::numeric, 2)::text AS average_rating,
              COUNT(*)::integer AS reviews_count
       FROM public.product_reviews
       WHERE product_id = $1`,
      [productId]
    );
    const row = result.rows[0];
    const count = row?.reviews_count ?? 0;
    const rawAverage = row?.average_rating ?? null;
    const average = rawAverage === null ? null : Number(rawAverage);
    return {
      product_id: productId,
      average_rating: count > 0 ? average : null,
      reviews_count: count
    };
  }

  async create(tenantId: string, customer: PosCustomer, input: CreateReviewDto): Promise<ReviewRow> {
    await this.assertProduct(tenantId, input.product_id);
    if (!(await this.tableExists())) {
      throw new ServiceUnavailableException(
        'Las reseñas no están disponibles: ejecuta la migración v0.3.65-product-reviews.sql'
      );
    }

    const existing = await this.database.query<{ id: number }>(
      `SELECT id FROM public.product_reviews
       WHERE product_id = $1 AND customer_id = $2
       LIMIT 1`,
      [input.product_id, customer.id]
    );
    if (existing.rowCount !== 0) {
      throw new BadRequestException('Ya calificaste este producto');
    }

    const comment = input.comment?.trim();
    let result: SqlResult<Omit<ReviewRow, 'customer_name'>>;
    try {
      result = await this.database.query<Omit<ReviewRow, 'customer_name'>>(
        `INSERT INTO public.product_reviews (product_id, customer_id, rating, comment)
         VALUES ($1, $2, $3, $4)
         RETURNING id, product_id, customer_id, rating, comment, created_at`,
        [input.product_id, customer.id, input.rating, comment !== undefined && comment !== '' ? comment : null]
      );
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException('Ya calificaste este producto');
      }
      throw error;
    }
    return { ...result.rows[0], customer_name: customer.name };
  }

  private async assertProduct(tenantId: string, productId: number): Promise<void> {
    const result = await this.database.query<{ id: number }>(
      `SELECT id FROM public.tec_products
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [tenantId, productId]
    );
    if (result.rowCount !== 1) throw new NotFoundException('Product not found in this tenant');
  }

  private async tableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.probe && now - this.probe.at < PROBE_CACHE_MS) return this.probe.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.product_reviews')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.probe = { exists, at: now };
    return exists;
  }
}
