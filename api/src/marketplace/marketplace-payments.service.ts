import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { SalesService } from '../sales/sales.service';
import { TenantBoldService } from '../payments/tenant-bold.service';
import { MarketplaceMaintenanceService } from './marketplace-maintenance.service';
import { MarketplaceNotificationsService } from './marketplace-notifications.service';

type WebhookEvent = { type?: string; data?: Record<string, unknown> };

type OrderPaymentRow = {
  id: number;
  order_number: string;
  grand_total: string;
  status: string;
  payment_status: string;
  customer_phone: string | null;
};

export type MarketplaceWebhookStats = {
  approved: number;
  rejected: number;
  ignored: number;
  amount_mismatch: number;
  signature_invalid: number;
  unknown_order: number;
  last_event_at: string | null;
  last_error: string | null;
};

type SuborderSaleRow = {
  id: number;
  sale_id: number | null;
  tenant_total: string;
  status: string;
  tenant_id: string;
  tenant_name: string;
  items_count: number;
};

const ORDER_REFERENCE_RE = /^MKP-(\d+)(?:-|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readAmount(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  if (typeof value === 'string' && value.trim() !== '' && /^\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value.trim()).toFixed(2);
  }
  return null;
}

/**
 * Pagos de tienderu.com: cuenta Bold DE LA PLATAFORMA (MARKETPLACE_BOLD_*).
 * El cliente paga una sola vez; la comisión queda en la plataforma y a cada
 * tenant se le liquida `tenant_total` por sub-orden.
 */
@Injectable()
export class MarketplacePaymentsService {
  private readonly logger = new Logger(MarketplacePaymentsService.name);
  /** Métricas en memoria de webhooks Bold del marketplace (v0.11.5). */
  private readonly webhookStatsData: MarketplaceWebhookStats = {
    approved: 0,
    rejected: 0,
    ignored: 0,
    amount_mismatch: 0,
    signature_invalid: 0,
    unknown_order: 0,
    last_event_at: null,
    last_error: null
  };

  constructor(
    private readonly database: DatabaseService,
    private readonly sales: SalesService,
    private readonly tenantBold: TenantBoldService,
    private readonly config: ConfigService,
    private readonly maintenance: MarketplaceMaintenanceService,
    private readonly notifications: MarketplaceNotificationsService
  ) {}

  webhookStats(): MarketplaceWebhookStats {
    return { ...this.webhookStatsData };
  }

  private recordWebhookEvent(
    outcome: 'approved' | 'rejected' | 'ignored' | 'amount_mismatch' | 'signature_invalid' | 'unknown_order',
    detail?: string
  ): void {
    this.webhookStatsData[outcome] += 1;
    this.webhookStatsData.last_event_at = new Date().toISOString();
    if (outcome === 'amount_mismatch' || outcome === 'signature_invalid') {
      this.webhookStatsData.last_error = `${outcome}${detail ? `: ${detail}` : ''}`;
    }
  }

  async createPlatformLink(input: {
    orderId: number;
    orderNumber: string;
    amount: string;
    payerEmail?: string | null;
  }): Promise<{ url: string; paymentLink: string }> {
    const apiKey = (this.config.get<string>('MARKETPLACE_BOLD_API_KEY') ?? '').trim();
    if (apiKey === '') {
      throw new ServiceUnavailableException('El pago con Bold no está configurado en tienderu.com');
    }
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Order total is invalid for payment');
    }
    const reference = `MKP-${input.orderId}-${Date.now().toString(36)}`;
    const callbackUrl = this.config.get<string>('MARKETPLACE_CALLBACK_URL') ?? null;
    const link = await this.tenantBold.createLink({
      apiKey,
      amount,
      description: `Pedido ${input.orderNumber}`,
      reference,
      payerEmail: input.payerEmail ?? null,
      callbackUrl
    });

    await this.database.query(
      `UPDATE public.tec_marketplace_orders
       SET bold_payment_id = $2, checkout_url = $3, updated_at = NOW()
       WHERE id = $1`,
      [input.orderId, link.paymentLink, link.url]
    );
    return link;
  }

  /**
   * Fase marketplace del webhook Bold (`MKP-<orderId>`). Devuelve `null` cuando
   * la referencia no es del marketplace (otra fase lo intentará). Firma
   * verificada con `MARKETPLACE_BOLD_WEBHOOK_SECRET ?? MARKETPLACE_BOLD_API_KEY`.
   */
  async handleBoldWebhook(
    rawBody: Buffer | string,
    signature: string | undefined,
    event: WebhookEvent
  ): Promise<{ handled: boolean } | null> {
    const metadata = isRecord(event.data?.metadata) ? (event.data?.metadata as Record<string, unknown>) : null;
    const reference = readString(metadata?.reference) ?? readString(event.data?.reference);
    const match = reference?.match(ORDER_REFERENCE_RE) ?? null;
    if (!match) return null;

    const orderId = Number(match[1]);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new BadRequestException('Invalid Bold signature');

    const secret = (
      this.config.get<string>('MARKETPLACE_BOLD_WEBHOOK_SECRET')
      ?? this.config.get<string>('MARKETPLACE_BOLD_API_KEY')
      ?? ''
    ).trim();
    if (secret === '') {
      this.recordWebhookEvent('signature_invalid', 'webhook secret vacío');
      throw new BadRequestException('Invalid Bold signature');
    }
    if (!this.tenantBold.verifySignature(rawBody, signature, secret)) {
      this.recordWebhookEvent('signature_invalid', `order ${orderId}`);
      throw new BadRequestException('Invalid Bold signature');
    }

    const orderResult = await this.database.query<OrderPaymentRow>(
      `SELECT id, order_number, grand_total::text AS grand_total, status, payment_status, customer_phone
       FROM public.tec_marketplace_orders
       WHERE id = $1
       LIMIT 1`,
      [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) {
      this.recordWebhookEvent('unknown_order', String(orderId));
      this.logger.warn(`Bold marketplace: pedido desconocido ${orderId}`);
      return { handled: false };
    }

    const eventType = event.type ?? '';
    // Pago rechazado (v0.11.0): repone stock y cancela el pedido impago.
    if (eventType === 'SALE_REJECTED') {
      const cancelled = await this.maintenance.cancelPendingOrder(orderId, {
        reason: 'bold_rejected',
        paymentStatus: 'failed'
      });
      this.recordWebhookEvent('rejected', order.order_number);
      this.logger.log(`Bold marketplace SALE_REJECTED order=${order.order_number} cancelado=${cancelled}`);
      return { handled: cancelled };
    }
    if (eventType !== 'SALE_APPROVED') {
      this.recordWebhookEvent('ignored', `${eventType || 'UNKNOWN'} ${order.order_number}`);
      this.logger.log(`Bold marketplace webhook ${eventType || 'UNKNOWN'} order=${order.order_number} ignorado`);
      return { handled: false };
    }

    // Verificación de monto: Bold cobra el total redondeado a entero (COP), así que
    // se compara contra el total redondeado. Nunca liquidar con un monto distinto.
    const amountData = isRecord(event.data?.amount) ? (event.data?.amount as Record<string, unknown>) : null;
    const paidAmount = readAmount(amountData?.total);
    const expected = Math.round(Number(order.grand_total));
    if (paidAmount === null || Math.abs(Number(paidAmount) - expected) >= 0.01) {
      this.recordWebhookEvent(
        'amount_mismatch',
        `${order.order_number} esperado=${expected} recibido=${paidAmount ?? 'n/d'}`
      );
      this.logger.error(
        `Bold marketplace: monto no coincide order=${order.order_number} esperado=${expected} recibido=${paidAmount ?? 'n/d'}`
      );
      return { handled: false };
    }

    const settlement = await this.settleOrder(orderId);
    const suborders = settlement.suborders;
    this.recordWebhookEvent('approved', order.order_number);
    this.logger.log(
      `Bold marketplace SALE_APPROVED order=${order.order_number} suborders=${suborders.length}`
    );

    // Liquida cada venta del POS del tenant (idempotente: salda el pendiente).
    for (const suborder of suborders) {
      if (suborder.sale_id === null) continue;
      try {
        await this.sales.registerGatewayPayment(suborder.sale_id, 'bold');
      } catch (error: unknown) {
        this.logger.error(
          `No se pudo liquidar la venta ${suborder.sale_id} del pedido ${order.order_number}: ${error instanceof Error ? error.message : 'unknown'}`
        );
      }
    }

    // Notificaciones (v0.11.1 / v0.12.0): solo en la PRIMERA liquidación (idempotente);
    // el comprador recibe UN mensaje del pedido completo y cada vendedor el suyo.
    if (settlement.firstSettlement) {
      for (const suborder of suborders) {
        await this.notifications.notifySellerPaidOrder({
          tenantId: suborder.tenant_id,
          tenantName: suborder.tenant_name,
          orderNumber: order.order_number,
          itemsCount: suborder.items_count,
          tenantTotal: suborder.tenant_total
        });
      }
      await this.notifications.notifyCustomerPaidOrder({
        phone: order.customer_phone,
        orderNumber: order.order_number,
        grandTotal: order.grand_total,
        sellers: suborders.map((suborder) => ({
          tenantId: suborder.tenant_id,
          tenantName: suborder.tenant_name
        }))
      });
    }
    return { handled: true };
  }

  private async settleOrder(
    orderId: number
  ): Promise<{ suborders: SuborderSaleRow[]; firstSettlement: boolean }> {
    return this.database.transaction(async (client) => {
      const current = await client.query<OrderPaymentRow>(
        `SELECT id, order_number, grand_total::text AS grand_total, status, payment_status, customer_phone
         FROM public.tec_marketplace_orders
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [orderId]
      );
      const order = current.rows[0];
      if (!order) return { suborders: [], firstSettlement: false };
      if (order.status === 'cancelled') {
        this.logger.warn(
          `Bold marketplace: pedido ${order.order_number} cancelado; SALE_APPROVED ignorado (revisar manualmente)`
        );
        return { suborders: [], firstSettlement: false };
      }
      const firstSettlement = order.payment_status !== 'paid';

      // Idempotente: repite las actualizaciones sin efecto si ya estaba pagado, y
      // SIEMPRE devuelve las sub-órdenes para reintentar la liquidación de ventas.
      await client.query(
        `UPDATE public.tec_marketplace_orders
         SET status = CASE WHEN status = 'pending_payment' THEN 'paid' ELSE status END,
             payment_status = 'paid', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [orderId]
      );
      await client.query(
        `UPDATE public.tec_marketplace_suborders
         SET status = CASE WHEN status = 'pending' THEN 'paid' ELSE status END, updated_at = NOW()
         WHERE order_id = $1`,
        [orderId]
      );
      const suborders = await client.query<SuborderSaleRow>(
        `SELECT s.id, s.sale_id, s.tenant_total::text AS tenant_total, s.status,
                s.tenant_id::text AS tenant_id, t.name AS tenant_name,
                (SELECT COALESCE(SUM(i.quantity), 0)::integer
                   FROM public.tec_marketplace_order_items i
                  WHERE i.suborder_id = s.id) AS items_count
         FROM public.tec_marketplace_suborders s
         JOIN public.tec_tenants t ON t.id = s.tenant_id
         WHERE s.order_id = $1`,
        [orderId]
      );
      return { suborders: suborders.rows, firstSettlement };
    });
  }
}
