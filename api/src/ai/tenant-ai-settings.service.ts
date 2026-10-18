import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface TenantAiSettings {
  tenantId: string;
  model: string | null;
  enabled: boolean;
}

type SettingsRow = { tenant_id: string; model: string | null; enabled: boolean | null };

const CACHE_MS = 60000;
const MIGRATION_HINT = 'Ejecuta docs/migrations/v0.4.0-tenant-ai-settings.sql';

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

@Injectable()
export class TenantAiSettingsService implements OnModuleInit {
  private readonly logger = new Logger(TenantAiSettingsService.name);
  private ready = false;
  private lastReadyCheck = 0;
  private readonly cache = new Map<string, { settings: TenantAiSettings | null; at: number }>();

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    const ready = await this.ensureReady(true);
    if (!ready) {
      this.logger.warn(
        `tec_tenant_ai_settings no existe; el Asistente IA usará los valores por defecto del servidor. ${MIGRATION_HINT}.`
      );
    }
  }

  async isReady(): Promise<boolean> {
    return this.ensureReady();
  }

  private async ensureReady(force = false): Promise<boolean> {
    if (this.ready) return true;
    const now = Date.now();
    if (!force && now - this.lastReadyCheck < 30000) return false;
    this.lastReadyCheck = now;
    try {
      const result = await this.database.query<{ exists: boolean }>(
        "SELECT to_regclass('public.tec_tenant_ai_settings') IS NOT NULL AS exists"
      );
      this.ready = result.rows[0]?.exists === true;
    } catch (_error: unknown) {
      this.ready = false;
    }
    if (this.ready) this.logger.log('tec_tenant_ai_settings detectada; configuración IA por tenant habilitada');
    return this.ready;
  }

  async getForTenant(tenantId: string): Promise<TenantAiSettings | null> {
    if (!(await this.ensureReady())) return null;
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.settings;

    let settings: TenantAiSettings | null = null;
    try {
      const result = await this.database.query<SettingsRow>(
        `SELECT tenant_id::text AS tenant_id, model, enabled
         FROM public.tec_tenant_ai_settings
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      );
      const row = result.rows[0];
      if (row) {
        settings = {
          tenantId: row.tenant_id,
          model: trimOrNull(row.model),
          enabled: row.enabled !== false
        };
      }
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo leer tec_tenant_ai_settings: ${error instanceof Error ? error.message : 'unknown'}`
      );
      settings = null;
    }
    this.cache.set(tenantId, { settings, at: Date.now() });
    return settings;
  }

  async update(
    tenantId: string,
    input: { model?: string; enabled?: boolean }
  ): Promise<TenantAiSettings> {
    if (!(await this.ensureReady())) {
      throw new BadRequestException(`La tabla de configuración IA no existe. ${MIGRATION_HINT}.`);
    }

    // Lectura fresca (sin caché) para soportar actualizaciones parciales.
    const currentResult = await this.database.query<SettingsRow>(
      `SELECT tenant_id::text AS tenant_id, model, enabled
       FROM public.tec_tenant_ai_settings
       WHERE tenant_id = $1
       LIMIT 1`,
      [tenantId]
    );
    const current = currentResult.rows[0];
    const model = input.model === undefined ? trimOrNull(current?.model) : trimOrNull(input.model);
    const enabled = input.enabled === undefined ? (current?.enabled !== false) : input.enabled;

    const result = await this.database.query<SettingsRow>(
      `INSERT INTO public.tec_tenant_ai_settings (tenant_id, model, enabled, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         model = EXCLUDED.model,
         enabled = EXCLUDED.enabled,
         updated_at = now()
       RETURNING tenant_id::text AS tenant_id, model, enabled`,
      [tenantId, model, enabled]
    );
    const row = result.rows[0];
    const settings: TenantAiSettings = {
      tenantId,
      model: trimOrNull(row?.model ?? model),
      enabled: (row?.enabled ?? enabled) !== false
    };
    this.cache.set(tenantId, { settings, at: Date.now() });
    return settings;
  }
}
