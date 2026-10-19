import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const PROBE_CACHE_MS = 60_000;
export const REVIEWS_MIGRATION_HINT =
  'Las reseñas del marketplace no están disponibles: ejecuta la migración v0.11.4-reviews-coupons.sql';

export type MarketplaceReviewRow = {
  id: number;
  product_id: number;
  customer_id: number;
  rating: number;
  comment: string | null;
  created_at: string | null;
};

/**
 * Reseñas de compradores del marketplace (v0.11.4): solo se puede calificar un
 * producto que el cliente compró y pagó (orden de marketplace con pago confirmado).
 */
@Injectable()
export class MarketplaceReviewsService {
  private readonly logger = new Logger(MarketplaceReviewsService.name);
  private probe: { exists: boolean; at: number } | null = null;

  constructor(private readonly database: DatabaseService) {}

  async tableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.probe && now - this.probe.at < PROBE_CACHE_MS) return this.probe.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.tec_marketplace_reviews')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.probe = { exists, at: now };
    return exists;
  }

  async create(customerId: number, productId: number, rating: number, commentInput?: string) {
    if (!(await this.tableExists())) throw new ServiceUnavailableException(REVIEWS_MIGRATION_HINT);

    const product = await this.database.query<{ id: number }>(
      `SELECT p.id FROM public.tec_products p
       JOIN public.tec_tenants t ON t.id = p.tenant_id AND t.status = 'active'
       JOIN public.tec_marketplace_settings mk ON mk.tenant_id = p.tenant_id AND mk.enabled = true
       WHERE p.id = $1
       LIMIT 1`,
      [productId]
    );
    if (product.rowCount !== 1) throw new NotFoundException('Product not found');

    if (!(await this.hasPurchased(customerId, productId))) {
      throw new BadRequestException('Solo puedes calificar productos que hayas comprado y pagado.');
    }

    const comment = commentInput?.trim().slice(0, 500) ?? '';
    try {
      const result = await this.database.query<MarketplaceReviewRow>(
        `INSERT INTO public.tec_marketplace_reviews (product_id, customer_id, rating, comment)
         VALUES ($1, $2, $3, $4)
         RETURNING id, product_id, customer_id, rating, comment, created_at`,
        [productId, customerId, rating, comment === '' ? null : comment]
      );
      return result.rows[0];
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : 'UNKNOWN';
      if (code === '23505') throw new BadRequestException('Ya calificaste este producto');
      throw error;
    }
  }

  async getMyReview(customerId: number, productId: number): Promise<MarketplaceReviewRow | null> {
    if (!(await this.tableExists())) return null;
    const result = await this.database.query<MarketplaceReviewRow>(
      `SELECT id, product_id, customer_id, rating, comment, created_at
       FROM public.tec_marketplace_reviews
       WHERE product_id = $1 AND customer_id = $2
       LIMIT 1`,
      [productId, customerId]
    );
    return result.rows[0] ?? null;
  }

  /** Contexto para la ficha del producto: mi reseña (si existe) y si puedo calificar. */
  async getMyReviewContext(
    customerId: number,
    productId: number
  ): Promise<{ review: MarketplaceReviewRow | null; can_review: boolean }> {
    if (!(await this.tableExists())) return { review: null, can_review: false };
    const [review, purchased] = await Promise.all([
      this.getMyReview(customerId, productId),
      this.hasPurchased(customerId, productId)
    ]);
    return { review, can_review: purchased };
  }

  private async hasPurchased(customerId: number, productId: number): Promise<boolean> {
    const purchased = await this.database.query<{ ok: number }>(
      `SELECT 1 AS ok FROM public.tec_marketplace_suborders s
       JOIN public.tec_marketplace_orders o ON o.id = s.order_id
       JOIN public.tec_marketplace_order_items i ON i.suborder_id = s.id
       WHERE o.customer_id = $1 AND o.payment_status = 'paid' AND i.product_id = $2
       LIMIT 1`,
      [customerId, productId]
    );
    return purchased.rowCount === 1;
  }
}