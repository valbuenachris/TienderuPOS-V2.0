import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface TenantWhatsappSettings {
  tenantId: string;
  instanceName: string;
  status: string;
  connectedAt: string | null;
}

type SettingsRow = {
  tenant_id: string;
  instance_name: string;
  status: string | null;
  connected_at: string | null;
};

const CACHE_MS = 60000;

function toSettings(row: SettingsRow): TenantWhatsappSettings {
  return {
    tenantId: row.tenant_id,
    instanceName: row.instance_name,
    status: row.status ?? 'close',
    connectedAt: row.connected_at
  };
}

@Injectable()
export class TenantWhatsappSettingsService implements OnModuleInit {
  private readonly logger = new Logger(TenantWhatsappSettingsService.name);
  private ready = false;
  private lastReadyCheck = 0;
  private readonly cache = new Map<string, { settings: TenantWhatsappSettings | null; at: number }>();

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    const ready = await this.ensureReady(true);
    if (!ready) {
      this.logger.warn(
        'tec_tenant_whatsapp_settings no existe; la sección de WhatsApp quedará deshabilitada. Ejecuta docs/migrations/v0.5.0-tenant-whatsapp.sql.'
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
        "SELECT to_regclass('public.tec_tenant_whatsapp_settings') IS NOT NULL AS exists"
      );
      this.ready = result.rows[0]?.exists === true;
    } catch (_error: unknown) {
      this.ready = false;
    }
    if (this.ready) this.logger.log('tec_tenant_whatsapp_settings detectada; WhatsApp por tenant habilitado');
    return this.ready;
  }

  async getForTenant(tenantId: string): Promise<TenantWhatsappSettings | null> {
    if (!(await this.ensureReady())) return null;
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.settings;

    let settings: TenantWhatsappSettings | null = null;
    try {
      const result = await this.database.query<SettingsRow>(
        `SELECT tenant_id::text AS tenant_id, instance_name, status, connected_at::text AS connected_at
         FROM public.tec_tenant_whatsapp_settings
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      );
      if (result.rows[0]) settings = toSettings(result.rows[0]);
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo leer tec_tenant_whatsapp_settings: ${error instanceof Error ? error.message : 'unknown'}`
      );
      settings = null;
    }
    this.cache.set(tenantId, { settings, at: Date.now() });
    return settings;
  }

  async upsert(
    tenantId: string,
    instanceName: string,
    status: string,
    connectedAt: string | null
  ): Promise<TenantWhatsappSettings> {
    const result = await this.database.query<SettingsRow>(
      `INSERT INTO public.tec_tenant_whatsapp_settings (tenant_id, instance_name, status, connected_at, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         instance_name = EXCLUDED.instance_name,
         status = EXCLUDED.status,
         connected_at = EXCLUDED.connected_at,
         updated_at = now()
       RETURNING tenant_id::text AS tenant_id, instance_name, status, connected_at::text AS connected_at`,
      [tenantId, instanceName, status, connectedAt]
    );
    const settings = toSettings(result.rows[0]);
    this.cache.set(tenantId, { settings, at: Date.now() });
    return settings;
  }

  async updateStatus(tenantId: string, status: string, connectedAt: string | null): Promise<void> {
    await this.database.query(
      `UPDATE public.tec_tenant_whatsapp_settings
       SET status = $2, connected_at = $3, updated_at = now()
       WHERE tenant_id = $1`,
      [tenantId, status, connectedAt]
    );
    this.cache.delete(tenantId);
  }
}
