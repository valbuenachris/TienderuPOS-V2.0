import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export type MarketplaceRateRule = { limit: number; windowMs: number };

export const CHECKOUT_RATE_RULE: MarketplaceRateRule = { limit: 15, windowMs: 10 * 60_000 };
export const PAY_RATE_RULE: MarketplaceRateRule = { limit: 10, windowMs: 5 * 60_000 };
export const REVIEW_RATE_RULE: MarketplaceRateRule = { limit: 5, windowMs: 60 * 60_000 };
export const BANNER_CLICK_RATE_RULE: MarketplaceRateRule = { limit: 60, windowMs: 60_000 };
export const REGISTER_RATE_RULE: MarketplaceRateRule = { limit: 10, windowMs: 60 * 60_000 };

const MAX_BUCKETS = 10_000;
const SWEEP_MAX_WINDOW_MS = 60 * 60_000;

/**
 * Rate limiting en memoria para los endpoints públicos del marketplace (v0.11.5).
 * Sin dependencias nuevas: ventana deslizante por clave (cliente autenticado o IP).
 * Es por proceso — suficiente para un contenedor de API único.
 */
@Injectable()
export class MarketplaceRateLimitService {
  private readonly buckets = new Map<string, number[]>();

  assertWithin(key: string, rule: MarketplaceRateRule): void {
    const now = Date.now();
    const windowStart = now - rule.windowMs;
    const hits = (this.buckets.get(key) ?? []).filter((at) => at > windowStart);
    if (hits.length >= rule.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + rule.windowMs - now) / 1000));
      throw new HttpException(
        {
          message: `Demasiadas solicitudes. Intenta de nuevo en ${retryAfterSeconds} s.`,
          retry_after_seconds: retryAfterSeconds
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    hits.push(now);
    this.buckets.set(key, hits);
    if (this.buckets.size > MAX_BUCKETS) this.sweep(now);
  }

  private sweep(now: number): void {
    for (const [key, hits] of this.buckets) {
      const alive = hits.filter((at) => at > now - SWEEP_MAX_WINDOW_MS);
      if (alive.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, alive);
    }
  }
}
