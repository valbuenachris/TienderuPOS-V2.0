import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { MarketplaceSettingsDto } from './marketplace.dto';

export type MarketplaceSettingsRow = {
  tenant_id: string;
  enabled: boolean;
  markup_percent: string;
  store_display_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const PROBE_CACHE_MS = 60_000;
export const MARKETPLACE_MIGRATION_HINT =
  'El marketplace no está disponible: ejecuta la migración v0.8.0-marketplace.sql';

export const DEFAULT_MARKUP_PERCENT = '10.00';

/**
 * Opt-in por tenant y markup del marketplace. Toda lectura pública exige
 * `enabled = true` (JOIN en el catálogo); este servicio gestiona el panel del tenant.
 */
@Injectable()
export class MarketplaceSettingsService {
  private probe: { exists: boolean; at: number } | null = null;
  private readonly shippingFlat: string;

  constructor(private readonly database: DatabaseService, config: ConfigService) {
    this.shippingFlat = this.parseShippingFlat(config.get<string>('MARKETPLACE_SHIPPING_FLAT'));
  }

  shippingFlatValue(): string {
    return this.shippingFlat;
  }

  async tableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.probe && now - this.probe.at < PROBE_CACHE_MS) return this.probe.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.tec_marketplace_settings')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.probe = { exists, at: now };
    return exists;
  }

  async assertAvailable(): Promise<void> {
    if (!(await this.tableExists())) throw new ServiceUnavailableException(MARKETPLACE_MIGRATION_HINT);
  }

  async get(tenantId: string): Promise<MarketplaceSettingsRow> {
    await this.assertAvailable();
    const result = await this.database.query<MarketplaceSettingsRow>(
      `SELECT tenant_id::text AS tenant_id, enabled, markup_percent::text AS markup_percent,
              store_display_name, created_at, updated_at
       FROM public.tec_marketplace_settings
       WHERE tenant_id = $1
       LIMIT 1`,
      [tenantId]
    );
    return result.rows[0] ?? {
      tenant_id: tenantId,
      enabled: false,
      markup_percent: DEFAULT_MARKUP_PERCENT,
      store_display_name: null,
      created_at: null,
      updated_at: null
    };
  }

  async upsert(tenantId: string, input: MarketplaceSettingsDto): Promise<MarketplaceSettingsRow> {
    await this.assertAvailable();
    const current = await this.get(tenantId);
    const enabled = input.enabled ?? current.enabled;
    const markup = input.markup_percent === undefined
      ? current.markup_percent
      : input.markup_percent.toFixed(2);
    const displayName = input.store_display_name === undefined
      ? current.store_display_name
      : (input.store_display_name.trim() === '' ? null : input.store_display_name.trim());

    const result = await this.database.query<MarketplaceSettingsRow>(
      `INSERT INTO public.tec_marketplace_settings (tenant_id, enabled, markup_percent, store_display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             markup_percent = EXCLUDED.markup_percent,
             store_display_name = EXCLUDED.store_display_name,
             updated_at = NOW()
       RETURNING tenant_id::text AS tenant_id, enabled, markup_percent::text AS markup_percent,
                 store_display_name, created_at, updated_at`,
      [tenantId, enabled, markup, displayName]
    );
    return result.rows[0];
  }

  private parseShippingFlat(raw: string | undefined): string {
    const value = Number((raw ?? '').trim());
    if (!Number.isFinite(value) || value < 0) return '0.00';
    return value.toFixed(2);
  }
}
