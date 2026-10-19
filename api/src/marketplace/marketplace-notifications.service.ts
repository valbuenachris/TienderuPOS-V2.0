import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EvolutionClient } from '../whatsapp/evolution.client';
import { TenantWhatsappSettingsService } from '../whatsapp/tenant-whatsapp-settings.service';
import { MarketplaceWhatsappSettingsService } from './marketplace-whatsapp-settings.service';

const MONEY = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

function formatMoney(value: string | number): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? MONEY.format(amount) : `$ ${value}`;
}

function digitsOnly(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : null;
}

/**
 * Notificaciones WhatsApp del marketplace (v0.11.1, v0.12.0): prefiere la
 * instancia de la PLATAFORMA (tienderu.com) y cae a la instancia del tenant
 * cuando la plataforma no está conectada o el canal está desactivado.
 * Best-effort: nunca bloquea el flujo de pago ni de despacho.
 */
@Injectable()
export class MarketplaceNotificationsService {
  private readonly logger = new Logger(MarketplaceNotificationsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly evolution: EvolutionClient,
    private readonly whatsappSettings: TenantWhatsappSettingsService,
    private readonly marketplaceWhatsapp: MarketplaceWhatsappSettingsService
  ) {}

  /** Avisa al vendedor que un pedido fue pagado (al teléfono de contacto de su tienda). */
  async notifySellerPaidOrder(input: {
    tenantId: string;
    tenantName: string;
    orderNumber: string;
    itemsCount: number;
    tenantTotal: string;
    /** Contraentrega (v0.11.4): el vendedor cobra al entregar. */
    cod?: boolean;
  }): Promise<void> {
    const text = input.cod
      ? `🛒 Tienderu.com · Nuevo pedido contraentrega ${input.orderNumber}\n` +
        `${input.itemsCount} producto(s) de ${input.tenantName} por ${formatMoney(input.tenantTotal)}\n` +
        `Cobras ${formatMoney(input.tenantTotal)} al entregar. Prepáralo en el POS → Marketplace → Pedidos.`
      : `🛒 Tienderu.com · Pedido pagado ${input.orderNumber}\n` +
        `${input.itemsCount} producto(s) de ${input.tenantName} por ${formatMoney(input.tenantTotal)}\n` +
        `Recibes ${formatMoney(input.tenantTotal)}. Prepáralo en el POS → Marketplace → Pedidos.`;

    const phone = await this.tenantContactPhone(input.tenantId);
    if (!phone) return;

    const platform = await this.marketplaceWhatsapp.activeInstance('tenants');
    if (platform) {
      await this.send(platform, phone, text);
      return;
    }

    const instance = await this.openInstance(input.tenantId);
    if (!instance) return;
    await this.send(instance, phone, text);
  }

  /**
   * Mensaje ÚNICO de "pedido pagado" al comprador (v0.12.0): una compra = un
   * mensaje aunque haya varios vendedores. Sin instancia de plataforma, cae al
   * comportamiento v0.11.1 (un mensaje por vendedor con su instancia).
   */
  async notifyCustomerPaidOrder(input: {
    phone: string | null;
    orderNumber: string;
    grandTotal: string;
    sellers: Array<{ tenantId: string; tenantName: string }>;
  }): Promise<void> {
    const phone = digitsOnly(input.phone);
    if (!phone) return;

    const platform = await this.marketplaceWhatsapp.activeInstance('customers');
    if (platform) {
      const names = [...new Set(input.sellers.map((seller) => seller.tenantName).filter(Boolean))];
      const sellersText =
        names.length > 1 ? `${names.join(', ')} preparan` : `${names[0] ?? 'La tienda'} prepara`;
      await this.send(
        platform,
        phone,
        `✅ Tienderu.com · Tu pedido ${input.orderNumber} quedó confirmado por ${formatMoney(input.grandTotal)}.\n` +
          `${sellersText} tu pedido. Te avisaremos cuando sea enviado.`
      );
      return;
    }

    for (const seller of input.sellers) {
      await this.notifyCustomer({
        tenantId: seller.tenantId,
        tenantName: seller.tenantName,
        phone,
        orderNumber: input.orderNumber,
        event: 'paid'
      });
    }
  }

  /** Avisa al comprador el estado de su sub-pedido (pagado/enviado/entregado). */
  async notifyCustomer(input: {
    tenantId: string;
    tenantName: string;
    phone: string | null;
    orderNumber: string;
    event: 'paid' | 'shipped' | 'delivered';
    trackingNote?: string | null;
  }): Promise<void> {
    const phone = digitsOnly(input.phone);
    if (!phone) return;

    const messages: Record<typeof input.event, string> = {
      paid:
        `✅ Tienderu.com · Tu pedido ${input.orderNumber} de ${input.tenantName} quedó confirmado.\n` +
        `Te avisaremos cuando sea enviado.`,
      shipped:
        `🚚 Tienderu.com · Tu pedido ${input.orderNumber} de ${input.tenantName} fue enviado.` +
        (input.trackingNote ? `\nGuía/nota: ${input.trackingNote}` : ''),
      delivered:
        `📦 Tienderu.com · Tu pedido ${input.orderNumber} de ${input.tenantName} fue entregado. ¡Gracias por tu compra!`
    };

    const platform = await this.marketplaceWhatsapp.activeInstance('customers');
    if (platform) {
      await this.send(platform, phone, messages[input.event]);
      return;
    }

    const instance = await this.openInstance(input.tenantId);
    if (!instance) return;
    await this.send(instance, phone, messages[input.event]);
  }

  private async openInstance(tenantId: string): Promise<string | null> {
    try {
      const settings = await this.whatsappSettings.getForTenant(tenantId);
      if (!settings || settings.status !== 'open') return null;
      return settings.instanceName;
    } catch (_error: unknown) {
      return null; // tabla ausente o Evolution caído: sin notificación.
    }
  }

  private async tenantContactPhone(tenantId: string): Promise<string | null> {
    try {
      const result = await this.database.query<{ phone: string | null }>(
        `SELECT phone FROM public.tec_tenant_settings WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );
      return digitsOnly(result.rows[0]?.phone);
    } catch (_error: unknown) {
      return null; // tec_tenant_settings ausente.
    }
  }

  private async send(instanceName: string, number: string, text: string): Promise<void> {
    try {
      await this.evolution.sendText(instanceName, number, text);
    } catch (error: unknown) {
      this.logger.warn(
        `Marketplace: no se pudo notificar por WhatsApp (${instanceName} → ${number}): ${
          error instanceof Error ? error.message : 'unknown'
        }`
      );
    }
  }
}
