import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionClient } from '../whatsapp/evolution.client';
import { AdminMarketplaceWhatsappDto } from './marketplace.dto';
import {
  MARKETPLACE_WHATSAPP_INSTANCE,
  MARKETPLACE_WHATSAPP_MIGRATION_HINT,
  MarketplaceWhatsappSettingsService
} from './marketplace-whatsapp-settings.service';

const STATUS_NONE = 'none';
export const MARKETPLACE_WHATSAPP_WEBHOOK_PATH = 'webhooks/evolution-marketplace';

/**
 * Instancia ÚNICA de WhatsApp de tienderu.com (v0.12.0) contra el servidor
 * Evolution compartido: crea la instancia, muestra el QR, refresca el estado y
 * registra el webhook dedicado del chatbot al activarlo.
 */
@Injectable()
export class MarketplaceWhatsappService {
  private readonly logger = new Logger(MarketplaceWhatsappService.name);

  constructor(
    private readonly client: EvolutionClient,
    private readonly settings: MarketplaceWhatsappSettingsService,
    private readonly config: ConfigService
  ) {}

  async settingsView() {
    const ready = await this.settings.tableExists();
    const row = await this.settings.get();
    let status = row?.status ?? STATUS_NONE;
    let connectedAt = row?.connected_at ?? null;

    if (row && this.client.isConfigured()) {
      try {
        const live = await this.client.connectionState(row.instance_name);
        if (live !== null && live !== status) {
          status = live;
          connectedAt = live === 'open' ? new Date().toISOString() : null;
          await this.settings.updateStatus(live, live === 'open' ? connectedAt : null);
        }
      } catch (error: unknown) {
        // Si Evolution no responde, devolvemos el último estado persistido.
        this.logger.warn(
          `No se pudo consultar el estado en Evolution: ${error instanceof Error ? error.message : 'unknown'}`
        );
      }
    }

    return {
      configured: this.client.isConfigured(),
      table_ready: ready,
      instance_name: row?.instance_name ?? null,
      status,
      connected_at: connectedAt,
      agent_enabled: row?.agent_enabled ?? false,
      agent_name: row?.agent_name ?? null,
      agent_tone: row?.agent_tone ?? 'amable',
      notify_customers: row?.notify_customers ?? true,
      notify_tenants: row?.notify_tenants ?? true,
      webhook_token_ready: (this.config.get<string>('EVOLUTION_WEBHOOK_TOKEN')?.trim() ?? '') !== ''
    };
  }

  /** Configuración del chatbot/notificaciones; al activar el agente registra el webhook. */
  async updateSettings(input: AdminMarketplaceWhatsappDto) {
    await this.assertReady();
    const row = await this.settings.getOrProvision();
    await this.settings.updateSettings({
      agent_enabled: input.agent_enabled,
      agent_name: input.agent_name,
      agent_tone: input.agent_tone,
      notify_customers: input.notify_customers,
      notify_tenants: input.notify_tenants
    });

    if (input.agent_enabled === true) {
      const token = this.config.get<string>('EVOLUTION_WEBHOOK_TOKEN')?.trim() ?? '';
      if (token === '') {
        throw new BadRequestException(
          'Define EVOLUTION_WEBHOOK_TOKEN en el .env antes de activar el bot (seguridad del webhook).'
        );
      }
      const base = (this.config.get<string>('PUBLIC_API_URL')?.trim() || 'https://pos.tienderu.com').replace(/\/+$/, '');
      const url = `${base}/api/${MARKETPLACE_WHATSAPP_WEBHOOK_PATH}?token=${encodeURIComponent(token)}`;
      await this.client.setWebhook(row.instance_name, url);
      this.logger.log(`Webhook del chatbot del marketplace registrado en Evolution: ${row.instance_name}`);
    }

    return this.settingsView();
  }

  async createInstance() {
    if (!this.client.isConfigured()) {
      throw new BadRequestException(
        'El servidor de WhatsApp (Evolution) no está configurado: define EVOLUTION_API_URL y EVOLUTION_API_KEY en el .env.'
      );
    }
    await this.assertReady();

    const existing = await this.settings.get();
    if (existing) {
      // Idempotente: la instancia ya está registrada; el QR se pide con "Conectar".
      const view = await this.settingsView();
      return { ...view, qr: null };
    }

    const instanceName = MARKETPLACE_WHATSAPP_INSTANCE;
    const created = await this.client.createInstance(instanceName);

    await this.settings.getOrProvision();
    const status = created.state === 'open' ? 'open' : 'close';
    await this.settings.updateStatus(status, status === 'open' ? new Date().toISOString() : null);

    let qr = created.qr;
    if (qr === null) {
      try {
        const connected = await this.client.connect(instanceName);
        qr = connected.qr;
      } catch (_error: unknown) {
        // El QR se puede pedir luego con "Conectar".
      }
    }

    this.logger.log(`Instancia WhatsApp del marketplace creada: ${instanceName}`);
    const view = await this.settingsView();
    return { ...view, qr };
  }

  async connect() {
    const row = await this.requireInstance();
    const result = await this.client.connect(row.instance_name);

    const status = result.state === 'open' ? 'open' : result.state === 'connecting' ? 'connecting' : 'close';
    if (status !== row.status) {
      await this.settings.updateStatus(status, status === 'open' ? new Date().toISOString() : null);
    }
    return { state: result.state, qr: result.qr };
  }

  async status() {
    const row = await this.settings.get();
    if (!row) return { status: STATUS_NONE };

    const live = await this.client.connectionState(row.instance_name);
    if (live === null) return { status: 'close' };

    if (live !== row.status) {
      await this.settings.updateStatus(live, live === 'open' ? new Date().toISOString() : null);
    }
    return { status: live };
  }

  async disconnect() {
    const row = await this.requireInstance();
    await this.client.logout(row.instance_name);
    await this.settings.updateStatus('close', null);
    this.logger.log(`Instancia WhatsApp del marketplace desconectada: ${row.instance_name}`);
    return this.settingsView();
  }

  private async assertReady(): Promise<void> {
    if (!(await this.settings.tableExists())) {
      throw new BadRequestException(MARKETPLACE_WHATSAPP_MIGRATION_HINT);
    }
  }

  private async requireInstance() {
    await this.assertReady();
    const row = await this.settings.get();
    if (!row) {
      throw new BadRequestException('El marketplace no tiene instancia de WhatsApp; créala primero.');
    }
    return row;
  }
}
