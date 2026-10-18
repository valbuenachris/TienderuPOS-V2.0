import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EvolutionClient } from './evolution.client';
import { TenantWhatsappSettingsService } from './tenant-whatsapp-settings.service';

const STATUS_NONE = 'none';

function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug === '' ? 'tenant' : slug;
}

/** Instancias de WhatsApp por tenant contra el servidor Evolution compartido. */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly client: EvolutionClient,
    private readonly settings: TenantWhatsappSettingsService
  ) {}

  async settingsView(tenantId: string) {
    const ready = await this.settings.isReady();
    const row = await this.settings.getForTenant(tenantId);
    let status = row?.status ?? STATUS_NONE;
    let connectedAt = row?.connectedAt ?? null;

    if (row && this.client.isConfigured()) {
      try {
        const live = await this.client.connectionState(row.instanceName);
        if (live !== null && live !== row.status) {
          status = live;
          connectedAt = live === 'open' ? new Date().toISOString() : null;
          await this.settings.updateStatus(tenantId, live, live === 'open' ? connectedAt : null);
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
      instance_name: row?.instanceName ?? null,
      status,
      connected_at: connectedAt
    };
  }

  async createInstance(tenantId: string) {
    if (!this.client.isConfigured()) {
      throw new BadRequestException(
        'El servidor de WhatsApp (Evolution) no está configurado: define EVOLUTION_API_URL y EVOLUTION_API_KEY en el .env.'
      );
    }
    if (!(await this.settings.isReady())) {
      throw new BadRequestException(
        'Falta la migración: ejecuta docs/migrations/v0.5.0-tenant-whatsapp.sql en la base de datos.'
      );
    }

    const existing = await this.settings.getForTenant(tenantId);
    if (existing) {
      // Idempotente: la instancia ya está registrada; el QR se pide con "Conectar".
      const view = await this.settingsView(tenantId);
      return { ...view, qr: null };
    }

    const tenant = await this.database.query<{ name: string }>(
      'SELECT name FROM public.tec_tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    const tenantName = tenant.rows[0]?.name;
    if (tenantName === undefined) throw new NotFoundException('Tenant not found');

    const instanceName = `pos-${slugify(tenantName)}-${tenantId.replace(/-/g, '').slice(0, 8)}`;
    const created = await this.client.createInstance(instanceName);

    const status = created.state === 'open' ? 'open' : 'close';
    await this.settings.upsert(tenantId, instanceName, status, status === 'open' ? new Date().toISOString() : null);

    let qr = created.qr;
    if (qr === null) {
      try {
        const connected = await this.client.connect(instanceName);
        qr = connected.qr;
      } catch (_error: unknown) {
        // El QR se puede pedir luego con "Conectar".
      }
    }

    this.logger.log(`Instancia WhatsApp creada: ${instanceName} (tenant ${tenantId})`);
    const view = await this.settingsView(tenantId);
    return { ...view, qr };
  }

  async connect(tenantId: string) {
    const row = await this.requireInstance(tenantId);
    const result = await this.client.connect(row.instanceName);

    const status = result.state === 'open' ? 'open' : result.state === 'connecting' ? 'connecting' : 'close';
    if (status !== row.status) {
      await this.settings.updateStatus(tenantId, status, status === 'open' ? new Date().toISOString() : null);
    }
    return { state: result.state, qr: result.qr };
  }

  async status(tenantId: string) {
    const row = await this.settings.getForTenant(tenantId);
    if (!row) return { status: STATUS_NONE };

    const live = await this.client.connectionState(row.instanceName);
    if (live === null) return { status: 'close' };

    if (live !== row.status) {
      await this.settings.updateStatus(tenantId, live, live === 'open' ? new Date().toISOString() : null);
    }
    return { status: live };
  }

  async disconnect(tenantId: string) {
    const row = await this.requireInstance(tenantId);
    await this.client.logout(row.instanceName);
    await this.settings.updateStatus(tenantId, 'close', null);
    this.logger.log(`Instancia WhatsApp desconectada: ${row.instanceName} (tenant ${tenantId})`);
    return this.settingsView(tenantId);
  }

  private async requireInstance(tenantId: string) {
    const row = await this.settings.getForTenant(tenantId);
    if (!row) {
      throw new BadRequestException('Esta tienda no tiene una instancia de WhatsApp; créala primero.');
    }
    return row;
  }
}
