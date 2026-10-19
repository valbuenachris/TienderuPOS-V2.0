import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const PROBE_CACHE_MS = 60_000;
export const MARKETPLACE_WHATSAPP_INSTANCE = 'tienderu-marketplace';
export const MARKETPLACE_WHATSAPP_MIGRATION_HINT =
  'El WhatsApp del marketplace no está disponible: ejecuta la migración v0.12.0-marketplace-whatsapp.sql';

export type MarketplaceWhatsappRow = {
  instance_name: string;
  status: string;
  connected_at: string | null;
  agent_enabled: boolean;
  agent_name: string | null;
  agent_tone: string | null;
  notify_customers: boolean;
  notify_tenants: boolean;
};

export type MarketplaceWhatsappSettingsPatch = {
  agent_enabled?: boolean;
  agent_name?: string;
  agent_tone?: string;
  notify_customers?: boolean;
  notify_tenants?: boolean;
};

/**
 * Instancia ÚNICA de WhatsApp de la plataforma (v0.12.0). Fila única id = 1 en
 * `tec_marketplace_whatsapp`; sin la migración todo degrada a "no disponible".
 */
@Injectable()
export class MarketplaceWhatsappSettingsService {
  private readonly logger = new Logger(MarketplaceWhatsappSettingsService.name);
  private probe: { exists: boolean; at: number } | null = null;

  constructor(private readonly database: DatabaseService) {}

  async tableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.probe && now - this.probe.at < PROBE_CACHE_MS) return this.probe.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.tec_marketplace_whatsapp')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.probe = { exists, at: now };
    return exists;
  }

  /** Fila de configuración (null mientras no exista la migración o la fila). */
  async get(): Promise<MarketplaceWhatsappRow | null> {
    if (!(await this.tableExists())) return null;
    const result = await this.database.query<MarketplaceWhatsappRow>(
      `SELECT instance_name, status, connected_at, agent_enabled, agent_name, agent_tone,
              notify_customers, notify_tenants
       FROM public.tec_marketplace_whatsapp
       WHERE id = 1
       LIMIT 1`
    );
    return result.rows[0] ?? null;
  }

  /** Devuelve la fila asegurando que exista (la crea con los valores por defecto). */
  async getOrProvision(): Promise<MarketplaceWhatsappRow> {
    await this.database.query(
      `INSERT INTO public.tec_marketplace_whatsapp (id, instance_name)
       VALUES (1, $1)
       ON CONFLICT (id) DO NOTHING`,
      [MARKETPLACE_WHATSAPP_INSTANCE]
    );
    const row = await this.get();
    if (!row) throw new Error(MARKETPLACE_WHATSAPP_MIGRATION_HINT);
    return row;
  }

  async updateStatus(status: string, connectedAt: string | null): Promise<void> {
    await this.database.query(
      `UPDATE public.tec_marketplace_whatsapp
       SET status = $1, connected_at = $2, updated_at = NOW()
       WHERE id = 1`,
      [status, connectedAt]
    );
  }

  async updateSettings(patch: MarketplaceWhatsappSettingsPatch): Promise<MarketplaceWhatsappRow> {
    const current = await this.getOrProvision();
    const next = {
      agent_enabled: patch.agent_enabled ?? current.agent_enabled,
      agent_name:
        patch.agent_name === undefined
          ? current.agent_name
          : patch.agent_name.trim() === ''
            ? null
            : patch.agent_name.trim(),
      agent_tone: patch.agent_tone ?? current.agent_tone ?? 'amable',
      notify_customers: patch.notify_customers ?? current.notify_customers,
      notify_tenants: patch.notify_tenants ?? current.notify_tenants
    };
    const result = await this.database.query<MarketplaceWhatsappRow>(
      `UPDATE public.tec_marketplace_whatsapp
       SET agent_enabled = $1, agent_name = $2, agent_tone = $3,
           notify_customers = $4, notify_tenants = $5, updated_at = NOW()
       WHERE id = 1
       RETURNING instance_name, status, connected_at, agent_enabled, agent_name, agent_tone,
                 notify_customers, notify_tenants`,
      [next.agent_enabled, next.agent_name, next.agent_tone, next.notify_customers, next.notify_tenants]
    );
    return result.rows[0];
  }

  /**
   * Instancia de la plataforma SOLO si está conectada y el canal pedido está
   * habilitado (usado por las notificaciones del marketplace).
   */
  async activeInstance(channel: 'customers' | 'tenants'): Promise<string | null> {
    try {
      const row = await this.get();
      if (!row || row.status !== 'open') return null;
      if (channel === 'customers' && !row.notify_customers) return null;
      if (channel === 'tenants' && !row.notify_tenants) return null;
      return row.instance_name;
    } catch (error: unknown) {
      this.logger.debug(`WhatsApp plataforma no disponible: ${error instanceof Error ? error.message : 'unknown'}`);
      return null;
    }
  }
}
