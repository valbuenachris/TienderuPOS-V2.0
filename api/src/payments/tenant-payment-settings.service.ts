import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type TenantPaymentProvider = 'bold' | 'addi' | 'sistecredito';

export interface TenantPaymentSettings {
  tenantId: string;
  boldEnabled: boolean; boldApiKey: string | null; boldWebhookSecret: string | null;
  addiEnabled: boolean; addiApiKey: string | null; addiWebhookSecret: string | null;
  sistecreditoEnabled: boolean; sistecreditoApiKey: string | null; sistecreditoWebhookSecret: string | null;
  sistecreditoVendorId: string | null; sistecreditoStoreId: string | null;
  returnUrl: string | null;
}

export interface ProviderCredentials {
  enabled: boolean;
  apiKey: string | null;
  webhookSecret: string | null;
}

export const PAYMENT_NOT_CONFIGURED_MESSAGE =
  'Este método de pago no está configurado para esta tienda. Por favor, elija Efectivo.';

type SettingsRow = {
  tenant_id: string;
  bold_enabled: boolean | null; bold_api_key: string | null; bold_webhook_secret: string | null;
  addi_enabled: boolean | null; addi_api_key: string | null; addi_webhook_secret: string | null;
  sistecredito_enabled: boolean | null; sistecredito_api_key: string | null; sistecredito_webhook_secret: string | null;
  sistecredito_vendor_id: string | null; sistecredito_store_id: string | null;
  return_url: string | null;
};

const CACHE_MS = 60000;

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

@Injectable()
export class TenantPaymentSettingsService implements OnModuleInit {
  private readonly logger = new Logger(TenantPaymentSettingsService.name);
  private ready = false;
  private lastReadyCheck = 0;
  private readonly cache = new Map<string, { settings: TenantPaymentSettings | null; at: number }>();

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    const ready = await this.ensureReady(true);
    if (!ready) {
      this.logger.warn(
        'tec_tenant_payment_settings no existe; los pagos por pasarela de la tienda virtual quedan deshabilitados (fail-closed). Ejecuta docs/migrations/v0.3.78-tenant-payment-settings.sql.'
      );
    }
  }

  private async ensureReady(force = false): Promise<boolean> {
    if (this.ready) return true;
    const now = Date.now();
    if (!force && now - this.lastReadyCheck < 30000) return false;
    this.lastReadyCheck = now;
    try {
      const result = await this.database.query<{ exists: boolean }>(
        "SELECT to_regclass('public.tec_tenant_payment_settings') IS NOT NULL AS exists"
      );
      this.ready = result.rows[0]?.exists === true;
    } catch (_error: unknown) {
      this.ready = false;
    }
    if (this.ready) this.logger.log('tec_tenant_payment_settings detectada; pagos por tenant habilitados');
    return this.ready;
  }

  async getForTenant(tenantId: string): Promise<TenantPaymentSettings | null> {
    if (!(await this.ensureReady())) return null;
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.settings;

    let settings: TenantPaymentSettings | null = null;
    try {
      const result = await this.database.query<SettingsRow>(
        `SELECT tenant_id::text AS tenant_id,
                bold_enabled, bold_api_key, bold_webhook_secret,
                addi_enabled, addi_api_key, addi_webhook_secret,
                sistecredito_enabled, sistecredito_api_key, sistecredito_webhook_secret,
                sistecredito_vendor_id, sistecredito_store_id,
                return_url
         FROM public.tec_tenant_payment_settings
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenantId]
      );
      const row = result.rows[0];
      if (row) {
        settings = {
          tenantId: row.tenant_id,
          boldEnabled: row.bold_enabled === true,
          boldApiKey: trimOrNull(row.bold_api_key),
          boldWebhookSecret: trimOrNull(row.bold_webhook_secret),
          addiEnabled: row.addi_enabled === true,
          addiApiKey: trimOrNull(row.addi_api_key),
          addiWebhookSecret: trimOrNull(row.addi_webhook_secret),
          sistecreditoEnabled: row.sistecredito_enabled === true,
          sistecreditoApiKey: trimOrNull(row.sistecredito_api_key),
          sistecreditoWebhookSecret: trimOrNull(row.sistecredito_webhook_secret),
          sistecreditoVendorId: trimOrNull(row.sistecredito_vendor_id),
          sistecreditoStoreId: trimOrNull(row.sistecredito_store_id),
          returnUrl: trimOrNull(row.return_url)
        };
      }
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo leer tec_tenant_payment_settings: ${error instanceof Error ? error.message : 'unknown'} ` +
        '(¿falta la migración docs/migrations/v0.12.6-sistecredito-ids.sql?)'
      );
      settings = null;
    }
    this.cache.set(tenantId, { settings, at: Date.now() });
    return settings;
  }

  /** Falla cerrado si el tenant no tiene el proveedor habilitado o sin llave. */
  async requireProvider(tenantId: string, provider: TenantPaymentProvider): Promise<TenantPaymentSettings> {
    const settings = await this.getForTenant(tenantId);
    if (!settings) throw new BadRequestException(PAYMENT_NOT_CONFIGURED_MESSAGE);
    const credentials = providerCredentials(settings, provider);
    if (!credentials.enabled || credentials.apiKey === null) {
      throw new BadRequestException(PAYMENT_NOT_CONFIGURED_MESSAGE);
    }
    return settings;
  }
}

export function providerCredentials(
  settings: TenantPaymentSettings,
  provider: TenantPaymentProvider
): ProviderCredentials {
  switch (provider) {
    case 'bold':
      return { enabled: settings.boldEnabled, apiKey: settings.boldApiKey, webhookSecret: settings.boldWebhookSecret };
    case 'addi':
      return { enabled: settings.addiEnabled, apiKey: settings.addiApiKey, webhookSecret: settings.addiWebhookSecret };
    case 'sistecredito':
      return {
        enabled: settings.sistecreditoEnabled,
        apiKey: settings.sistecreditoApiKey,
        webhookSecret: settings.sistecreditoWebhookSecret
      };
  }
}
