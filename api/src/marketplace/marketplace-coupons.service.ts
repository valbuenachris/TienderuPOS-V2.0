import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { DatabaseService, SqlExecutor } from '../database/database.service';
import { AdminCouponDto } from './marketplace.dto';

const PROBE_CACHE_MS = 60_000;
const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;
const CODE_RE = /^[A-Z0-9_-]{3,40}$/;
export const COUPONS_MIGRATION_HINT =
  'Los cupones no están disponibles: ejecuta la migración v0.11.4-reviews-coupons.sql';

export type MarketplaceCouponRow = {
  id: number;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: string;
  min_total: string;
  max_uses: number | null;
  uses: number;
  active: boolean;
  expires_at: string | null;
  created_at: string | null;
};

export type ResolvedCoupon = { id: number; code: string; discount: Decimal };

/**
 * Cupones de plataforma (v0.11.4): el descuento lo absorbe la comisión de
 * Tienderu; el vendedor recibe siempre el valor completo de su venta. La
 * validación y el consumo ocurren dentro de la transacción del checkout.
 */
@Injectable()
export class MarketplaceCouponsService {
  private readonly logger = new Logger(MarketplaceCouponsService.name);
  private probe: { exists: boolean; at: number } | null = null;

  constructor(private readonly database: DatabaseService) {}

  async tableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.probe && now - this.probe.at < PROBE_CACHE_MS) return this.probe.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.tec_marketplace_coupons')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.probe = { exists, at: now };
    return exists;
  }

  /**
   * Valida un cupón y calcula su descuento (lock de fila + consumo de uso).
   * Se ejecuta dentro de la transacción del checkout: si algo falla después,
   * el incremento de `uses` se revierte con el resto.
   */
  async resolveForCheckout(
    client: SqlExecutor,
    codeInput: string | undefined,
    productsTotal: Decimal
  ): Promise<ResolvedCoupon | null> {
    const code = (codeInput ?? '').trim().toUpperCase();
    if (code === '') return null;
    if (!(await this.tableExists())) throw new ServiceUnavailableException(COUPONS_MIGRATION_HINT);

    const result = await client.query<MarketplaceCouponRow>(
      `SELECT id, code, discount_type, discount_value::text AS discount_value,
              min_total::text AS min_total, max_uses, uses, active, expires_at, created_at
       FROM public.tec_marketplace_coupons
       WHERE UPPER(code) = $1
       LIMIT 1
       FOR UPDATE`,
      [code]
    );
    const coupon = result.rows[0];
    if (!coupon) throw new BadRequestException('El cupón no existe');
    if (!coupon.active) throw new BadRequestException('El cupón ya no está activo');
    if (coupon.expires_at !== null && new Date(coupon.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('El cupón ya expiró');
    }
    if (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) {
      throw new BadRequestException('El cupón alcanzó su límite de usos');
    }
    const minTotal = new Decimal(coupon.min_total ?? '0');
    if (productsTotal.lt(minTotal)) {
      throw new BadRequestException(
        `El cupón requiere una compra mínima de $${minTotal.toFixed(2)}`
      );
    }

    const value = new Decimal(coupon.discount_value);
    let discount =
      coupon.discount_type === 'percent'
        ? productsTotal.times(value).dividedBy(100).toDecimalPlaces(2, MONEY_ROUNDING)
        : value.toDecimalPlaces(2, MONEY_ROUNDING);
    if (discount.gt(productsTotal)) discount = productsTotal.toDecimalPlaces(2, MONEY_ROUNDING);

    await client.query(
      `UPDATE public.tec_marketplace_coupons SET uses = uses + 1 WHERE id = $1`,
      [coupon.id]
    );
    return { id: coupon.id, code: coupon.code, discount };
  }

  // ---------------------------------------------------------------------------
  // Super admin: CRUD de cupones
  // ---------------------------------------------------------------------------

  async adminList(): Promise<MarketplaceCouponRow[]> {
    if (!(await this.tableExists())) return [];
    const result = await this.database.query<MarketplaceCouponRow>(
      `SELECT id, code, discount_type, discount_value::text AS discount_value,
              min_total::text AS min_total, max_uses, uses, active, expires_at, created_at
       FROM public.tec_marketplace_coupons
       ORDER BY id DESC
       LIMIT 200`
    );
    return result.rows;
  }

  async adminCreate(input: AdminCouponDto): Promise<MarketplaceCouponRow> {
    await this.assertAvailable();
    const code = this.normalizeCode(input.code);
    if (code === null) throw new BadRequestException('El código del cupón es obligatorio');
    const discountType = input.discount_type ?? 'percent';
    const value = this.validateValue(input.discount_value, discountType);
    const minTotal = this.validateMinTotal(input.min_total);
    const maxUses = input.max_uses ?? null;
    const expiresAt = this.validateExpiresAt(input.expires_at);

    try {
      const result = await this.database.query<MarketplaceCouponRow>(
        `INSERT INTO public.tec_marketplace_coupons
           (code, discount_type, discount_value, min_total, max_uses, active, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, code, discount_type, discount_value::text AS discount_value,
                   min_total::text AS min_total, max_uses, uses, active, expires_at, created_at`,
        [code, discountType, value, minTotal, maxUses, input.active ?? true, expiresAt]
      );
      return result.rows[0];
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new BadRequestException('Ya existe un cupón con ese código');
      }
      throw error;
    }
  }

  async adminUpdate(id: number, input: AdminCouponDto): Promise<MarketplaceCouponRow> {
    await this.assertAvailable();
    const current = await this.database.query<MarketplaceCouponRow>(
      `SELECT id, code, discount_type, discount_value::text AS discount_value,
              min_total::text AS min_total, max_uses, uses, active, expires_at, created_at
       FROM public.tec_marketplace_coupons
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    const coupon = current.rows[0];
    if (!coupon) throw new NotFoundException('Coupon not found');

    const code = input.code === undefined ? coupon.code : this.normalizeCode(input.code);
    if (code === null) throw new BadRequestException('El código del cupón es obligatorio');
    const discountType = input.discount_type ?? coupon.discount_type;
    const value =
      input.discount_value === undefined
        ? coupon.discount_value
        : this.validateValue(input.discount_value, discountType);
    if (input.discount_value === undefined && input.discount_type === 'percent') {
      this.validateValue(Number(coupon.discount_value), 'percent');
    }
    const minTotal = input.min_total === undefined ? coupon.min_total : this.validateMinTotal(input.min_total);
    const maxUses = input.max_uses === undefined ? coupon.max_uses : input.max_uses;
    const active = input.active ?? coupon.active;
    const expiresAt =
      input.expires_at === undefined ? coupon.expires_at : this.validateExpiresAt(input.expires_at);

    try {
      const result = await this.database.query<MarketplaceCouponRow>(
        `UPDATE public.tec_marketplace_coupons
         SET code = $2, discount_type = $3, discount_value = $4, min_total = $5,
             max_uses = $6, active = $7, expires_at = $8
         WHERE id = $1
         RETURNING id, code, discount_type, discount_value::text AS discount_value,
                   min_total::text AS min_total, max_uses, uses, active, expires_at, created_at`,
        [id, code, discountType, value, minTotal, maxUses, active, expiresAt]
      );
      return result.rows[0];
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new BadRequestException('Ya existe un cupón con ese código');
      }
      throw error;
    }
  }

  async adminRemove(id: number): Promise<void> {
    await this.assertAvailable();
    const result = await this.database.query(`DELETE FROM public.tec_marketplace_coupons WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new NotFoundException('Coupon not found');
    this.logger.log(`Cupón ${id} eliminado`);
  }

  private async assertAvailable(): Promise<void> {
    if (!(await this.tableExists())) throw new ServiceUnavailableException(COUPONS_MIGRATION_HINT);
  }

  private normalizeCode(raw: string | undefined): string | null {
    const code = (raw ?? '').trim().toUpperCase();
    if (code === '') return null;
    if (!CODE_RE.test(code)) {
      throw new BadRequestException(
        'El código debe tener entre 3 y 40 caracteres (letras, números, guiones o guion bajo)'
      );
    }
    return code;
  }

  private validateValue(value: number | undefined, discountType: 'percent' | 'fixed'): string {
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      throw new BadRequestException('El valor del descuento debe ser mayor a cero');
    }
    if (discountType === 'percent' && value > 100) {
      throw new BadRequestException('Un cupón de porcentaje no puede superar el 100%');
    }
    return new Decimal(value).toDecimalPlaces(2, MONEY_ROUNDING).toFixed(2);
  }

  private validateMinTotal(value: number | undefined): string {
    if (value === undefined) return '0.00';
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException('El mínimo de compra no puede ser negativo');
    }
    return new Decimal(value).toDecimalPlaces(2, MONEY_ROUNDING).toFixed(2);
  }

  private validateExpiresAt(value: string | null | undefined): string | null {
    if (value === undefined || value === null || value.trim() === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('La fecha de expiración no es válida');
    }
    return parsed.toISOString();
  }

  private isUniqueViolation(error: unknown): boolean {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code === '23505';
  }
}
