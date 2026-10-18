import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface TenantWhatsappSettings {
  tenantId: string;
  instanceName: string;
  status: string;
  connectedAt: string | null;
  agentEnabled: boolean;
  agentName: string | null;
  agentTone: string;
}

type SettingsRow = {
  tenant_id: string;
  instance_name: string;
  status: string | null;
  connected_at: string | null;
  agent_enabled: boolean | null;
  agent_name: string | null;
  agent_tone: string | null;
};

const CACHE_MS = 60000;
const MIGRATION_HINT = 'Ejecuta docs/migrations/v0.6.0-whatsapp-bot.sql';

function toSettings(row: SettingsRow): TenantWhatsappSettings {
  return {
    tenantId: row.tenant_id,
    instanceName: row.instance_name,
    status: row.status ?? 'close',
    connectedAt: row.connected_at,
    agentEnabled: row.agent_enabled === true,
    agentName: row.agent_name,
    agentTone: row.agent_tone ?? 'amable'
  };
}

@Injectable()
export class TenantWhatsappSettingsService implements OnModuleInit {
  private readonly logger = new Logger(TenantWhatsappSettingsService.name);
  private ready = false;
  private agentColumnsReady = false;
  private lastReadyCheck = 0;
  private lastColumnsCheck = 0;
  private readonly cache = new Map<string, { settings: TenantWhatsappSettings | null; at: number }>();
  private readonly instanceCache = new Map<string, { settings: TenantWhatsappSettings | null; at: number }>();

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    const ready = await this.ensureReady(true);
    if (!ready) {
      this.logger.warn(
        `tec_tenant_whatsapp_settings no existe; la sección de WhatsApp quedará deshabilitada. Ejecuta docs/migrations/v0.5.0-tenant-whatsapp.sql.`
      );
      return;
    }
    const columns = await this.ensureAgentColumns(true);
    if (!columns) {
      this.logger.warn(`Faltan columnas del agente en tec_tenant_whatsapp_settings (v0.5.0 sin v0.6.0). ${MIGRATION_HINT}.`);
    }
  }

  async isReady(): Promise<boolean> {
    return this.ensureReady();
  }

  async agentConfigReady(): Promise<boolean> {
    if (!(await this.ensureReady())) return false;
    return this.ensureAgentColumns();
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

  /** La migración v0.6.0 agrega las columnas del agente; sin ellas la sección sigue operando (v0.5.0). */
  private async ensureAgentColumns(force = false): Promise<boolean> {
    if (this.agentColumnsReady) return true;
    const now = Date.now();
    if (!force && now - this.lastColumnsCheck < 30000) return false;
    this.lastColumnsCheck = now;
    try {
      const result = await this.database.query<{ ready: boolean }>(
        `SELECT COUNT(*)::integer = 1 AS ready
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'tec_tenant_whatsapp_settings'
           AND column_name = 'agent_enabled'`
      );
      this.agentColumnsReady = result.rows[0]?.ready === true;
    } catch (_error: unknown) {
      this.agentColumnsReady = false;
    }
    return this.agentColumnsReady;
  }

  private async columnsExpression(): Promise<string> {
    const withAgent = await this.ensureAgentColumns();
    return withAgent
      ? 'agent_enabled, agent_name, agent_tone'
      : "false AS agent_enabled, NULL::varchar AS agent_name, NULL::varchar AS agent_tone";
  }

  async getForTenant(tenantId: string): Promise<TenantWhatsappSettings | null> {
    if (!(await this.ensureReady())) return null;
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.settings;

    let settings: TenantWhatsappSettings | null = null;
    try {
      const columns = await this.columnsExpression();
      const result = await this.database.query<SettingsRow>(
        `SELECT tenant_id::text AS tenant_id, instance_name, status, connected_at::text AS connected_at, ${columns}
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

  /** Resolución de tenant para el webhook de Evolution (por nombre de instancia). */
  async getByInstanceName(instanceName: string): Promise<TenantWhatsappSettings | null> {
    if (!(await this.ensureReady())) return null;
    const cached = this.instanceCache.get(instanceName);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.settings;

    let settings: TenantWhatsappSettings | null = null;
    try {
      const columns = await this.columnsExpression();
      const result = await this.database.query<SettingsRow>(
        `SELECT tenant_id::text AS tenant_id, instance_name, status, connected_at::text AS connected_at, ${columns}
         FROM public.tec_tenant_whatsapp_settings
         WHERE instance_name = $1
         LIMIT 1`,
        [instanceName]
      );
      if (result.rows[0]) settings = toSettings(result.rows[0]);
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo resolver la instancia ${instanceName}: ${error instanceof Error ? error.message : 'unknown'}`
      );
      settings = null;
    }
    this.instanceCache.set(instanceName, { settings, at: Date.now() });
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
    this.clearCaches(tenantId, instanceName);
    this.cache.set(tenantId, { settings, at: Date.now() });
    return settings;
  }

  async updateStatus(tenantId: string, status: string, connectedAt: string | null): Promise<void> {
    const result = await this.database.query<{ instance_name: string }>(
      `UPDATE public.tec_tenant_whatsapp_settings
       SET status = $2, connected_at = $3, updated_at = now()
       WHERE tenant_id = $1
       RETURNING instance_name`,
      [tenantId, status, connectedAt]
    );
    if (result.rows[0]) this.clearCaches(tenantId, result.rows[0].instance_name);
    else this.cache.delete(tenantId);
  }

  async updateAgent(
    tenantId: string,
    input: { agentEnabled?: boolean; agentName?: string; agentTone?: string }
  ): Promise<TenantWhatsappSettings> {
    if (!(await this.agentConfigReady())) {
      throw new BadRequestException(`Faltan las columnas del agente. ${MIGRATION_HINT}.`);
    }
    const name = input.agentName === undefined ? null : input.agentName.trim().slice(0, 60);
    const tone = input.agentTone === undefined ? null : input.agentTone.trim();
    const result = await this.database.query<SettingsRow>(
      `UPDATE public.tec_tenant_whatsapp_settings
       SET agent_enabled = COALESCE($2, agent_enabled),
           agent_name = COALESCE($3, agent_name),
           agent_tone = COALESCE($4, agent_tone),
           updated_at = now()
       WHERE tenant_id = $1
       RETURNING tenant_id::text AS tenant_id, instance_name, status, connected_at::text AS connected_at,
                 agent_enabled, agent_name, agent_tone`,
      [tenantId, input.agentEnabled ?? null, name === '' ? null : name, tone === '' ? null : tone]
    );
    if (!result.rows[0]) {
      throw new BadRequestException('Esta tienda no tiene una instancia de WhatsApp; créala primero.');
    }
    const settings = toSettings(result.rows[0]);
    this.clearCaches(tenantId, settings.instanceName);
    this.cache.set(tenantId, { settings, at: Date.now() });
    return settings;
  }

  private clearCaches(tenantId: string, instanceName: string): void {
    this.cache.delete(tenantId);
    this.instanceCache.delete(instanceName);
  }
}
