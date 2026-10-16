import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PosCustomer } from '../auth/auth.types';
import { CustomerCheckoutWithPaymentDto } from '../customer/customer.dto';
import { DatabaseService } from '../database/database.service';
import { SalePaymentMethod } from '../sales/sale.dto';
import { SalesService } from '../sales/sales.service';
import { TenantBoldService } from './tenant-bold.service';
import { TenantPaymentSettingsService, providerCredentials } from './tenant-payment-settings.service';

type FinancingProvider = 'addi' | 'sistecredito';
type WebhookEvent = { type?: string; data?: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const ORDER_REFERENCE_RE = /^ORDER-(\d+)(?:-|$)/i;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly sales: SalesService,
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly paymentSettings: TenantPaymentSettingsService,
    private readonly tenantBold: TenantBoldService
  ) {}

  async checkoutWithPayment(tenantId: string, customer: PosCustomer, input: CustomerCheckoutWithPaymentDto) {
    const method = input.payment_method;
    const combos = input.combos ?? [];
    if (combos.length > 0 && method !== 'cash' && method !== 'bold') {
      throw new BadRequestException('Los combos solo están disponibles para pago en efectivo/contraentrega o tarjetas/PSE.');
    }
    const sale = await this.sales.createForCustomer(tenantId, customer, {
      store_id: input.store_id,
      items: input.items ?? [],
      combos,
      payment_method: method
    });

    if (method === 'cash') {
      return {
        order_id: sale.id,
        status: sale.status,
        payment_url: null,
        payment_method: method
      };
    }

    // Fail-closed: cada método usa las credenciales del tenant (no el .env del SaaS).
    const settings = await this.paymentSettings.requireProvider(tenantId, method);
    const callbackUrl = settings.returnUrl ?? this.config.get<string>('CUSTOMER_PAYMENT_RETURN_URL') ?? null;

    const amount = Number(sale.grand_total);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Order total is invalid for payment');
    }

    if (method === 'bold') {
      const credentials = providerCredentials(settings, 'bold');
      const reference = `ORDER-${sale.id}-${Date.now().toString(36)}`;
      const link = await this.tenantBold.createLink({
        apiKey: credentials.apiKey!,
        amount,
        description: `Pedido #${sale.id}`,
        reference,
        payerEmail: customer.email,
        callbackUrl
      });
      return {
        order_id: sale.id,
        status: sale.status,
        payment_url: link.url,
        payment_method: method
      };
    }

    return {
      order_id: sale.id,
      status: sale.status,
      payment_url: this.createFinancingLink(method, sale.id, amount, settings.tenantId, callbackUrl),
      payment_method: method
    };
  }

  async listCustomerPaymentMethods(tenantId: string, customerId: number) {
    const result = await this.database.query<{
      method: string;
      last_used_at: Date | null;
      times_used: number;
    }>(
      `SELECT p.paid_by AS method,
              MAX(p.created_at) AS last_used_at,
              COUNT(*)::integer AS times_used
       FROM public.tec_payments p
       JOIN public.tec_sales s ON s.id = p.sale_id AND s.tenant_id = p.tenant_id
       WHERE s.tenant_id = $1 AND s.customer_id = $2 AND p.paid_by IS NOT NULL
       GROUP BY p.paid_by
       ORDER BY MAX(p.created_at) DESC NULLS LAST`,
      [tenantId, customerId]
    );
    return result.rows.map((row) => ({
      method: row.method,
      last_used_at: row.last_used_at === null ? null : row.last_used_at.toISOString(),
      times_used: row.times_used
    }));
  }

  async handleFinancingWebhook(
    provider: FinancingProvider,
    payload: unknown,
    secretHeader?: string
  ): Promise<{ received: true; handled: boolean }> {
    if (!isRecord(payload)) throw new BadRequestException('Invalid payload');
    const orderId = this.readOrderId(payload);
    if (orderId === null) return { received: true, handled: false };

    const sale = await this.resolveSaleTenant(orderId);
    if (!sale) return { received: true, handled: false };
    const settings = await this.paymentSettings.getForTenant(sale.tenantId);
    if (!settings) {
      this.logger.warn(`[${provider} webhook] tenant ${sale.tenantId} sin configuración de pagos; ignorado`);
      return { received: true, handled: false };
    }
    const credentials = providerCredentials(settings, provider);
    if (!credentials.enabled) {
      this.logger.warn(`[${provider} webhook] deshabilitado para tenant ${sale.tenantId}; ignorado`);
      return { received: true, handled: false };
    }
    const secret = credentials.webhookSecret;
    if (secret !== null) {
      if (secretHeader !== secret) throw new BadRequestException('Invalid webhook secret');
    } else {
      this.logger.warn(`[${provider} webhook] tenant ${sale.tenantId} sin secreto configurado; modo sandbox (stub)`);
    }

    this.logger.log(
      `[${provider} webhook] tenant=${sale.tenantId} order=${orderId} ${JSON.stringify(payload)?.slice(0, 500) ?? 'null'}`
    );
    const status = (readString(payload.status) ?? '').toLowerCase();
    if (status !== 'approved' && status !== 'paid' && status !== 'completed') {
      return { received: true, handled: false };
    }
    const amount = readString(payload.amount);
    const paidBy: SalePaymentMethod = provider === 'addi' ? 'ADI' : 'Sistecredito';
    const result = await this.sales.registerGatewayPayment(orderId, paidBy, amount ?? undefined);
    return { received: true, handled: result.handled };
  }

  /**
   * Bold para pedidos de la tienda virtual: resuelve el tenant por la
   * referencia `ORDER-<saleId>` y valida la firma con la llave DEL TENANT.
   * El webhook del SaaS (api/src/billing) sigue validando primero con el .env global.
   */
  async handleTenantBoldWebhook(
    rawBody: Buffer | string,
    signature: string | undefined,
    event: WebhookEvent
  ): Promise<{ handled: boolean }> {
    const metadata = isRecord(event.data?.metadata) ? event.data?.metadata as Record<string, unknown> : null;
    const reference = readString(metadata?.reference) ?? readString(event.data?.reference);
    const match = reference?.match(ORDER_REFERENCE_RE) ?? null;
    if (!match) throw new BadRequestException('Invalid Bold signature');
    const saleId = Number(match[1]);
    if (!Number.isSafeInteger(saleId) || saleId <= 0) throw new BadRequestException('Invalid Bold signature');

    const sale = await this.resolveSaleTenant(saleId);
    if (!sale) throw new BadRequestException('Invalid Bold signature');
    const settings = await this.paymentSettings.getForTenant(sale.tenantId);
    if (!settings) throw new BadRequestException('Invalid Bold signature');
    const credentials = providerCredentials(settings, 'bold');
    if (!credentials.enabled) throw new BadRequestException('Invalid Bold signature');
    const sandbox = credentials.webhookSecret === null && credentials.apiKey === null;
    const secret = credentials.webhookSecret ?? credentials.apiKey ?? '';
    if (secret === '' && !sandbox) throw new BadRequestException('Invalid Bold signature');
    if (!this.tenantBold.verifySignature(rawBody, signature, secret)) {
      throw new BadRequestException('Invalid Bold signature');
    }

    if ((event.type ?? '') !== 'SALE_APPROVED') {
      this.logger.log(`Bold tenant webhook ${event.type ?? 'UNKNOWN'} tenant=${sale.tenantId} order=${saleId} ignorado`);
      return { handled: false };
    }

    const amountData = isRecord(event.data?.amount) ? event.data?.amount as Record<string, unknown> : null;
    const amount = amountData?.total !== undefined && amountData?.total !== null
      ? String(amountData.total)
      : null;
    const result = await this.sales.registerGatewayPayment(
      saleId,
      'bold',
      amount === null || amount === '0' ? undefined : amount
    );
    this.logger.log(`Bold tenant webhook pagado tenant=${sale.tenantId} order=${saleId} handled=${result.handled}`);
    return { handled: result.handled };
  }

  private async resolveSaleTenant(saleId: number): Promise<{ saleId: number; tenantId: string } | null> {
    const result = await this.database.query<{ id: number; tenant_id: string }>(
      'SELECT id, tenant_id::text AS tenant_id FROM public.tec_sales WHERE id = $1 LIMIT 1',
      [saleId]
    );
    const row = result.rows[0];
    return row ? { saleId: row.id, tenantId: row.tenant_id } : null;
  }

  private createFinancingLink(
    provider: FinancingProvider,
    saleId: number,
    amount: number,
    tenantId: string,
    callbackUrl: string | null
  ): string {
    const payload = {
      merchant_order_id: `ORDER-${saleId}`,
      reference: `ORDER-${saleId}`,
      amount,
      currency: 'COP',
      callback_url: callbackUrl ?? 'https://pos.tienderu.com',
      tenant_id: tenantId
    };
    this.logger.log(`[${provider.toUpperCase()} STUB] tenant=${tenantId} checkout payload: ${JSON.stringify(payload)}`);
    // TODO: replace this stub with the real provider API call once the contract is confirmed,
    // using the TENANT's api key (tec_tenant_payment_settings). The order reference is
    // `ORDER-<saleId>`; the provider must echo it on the webhook, which is then validated
    // with the tenant's webhook secret.
    const base = provider === 'addi'
      ? this.config.get<string>('ADDI_CHECKOUT_BASE_URL') ?? 'https://sandbox.addi.com/checkout'
      : this.config.get<string>('SISTECREDITO_CHECKOUT_BASE_URL') ?? 'https://sandbox.sistecredito.com/checkout';
    return `${base}?order=ORDER-${saleId}`;
  }

  private readOrderId(payload: Record<string, unknown>): number | null {
    const direct = payload.order_id ?? payload.sale_id;
    if (typeof direct === 'number' && Number.isSafeInteger(direct) && direct > 0) return direct;
    if (typeof direct === 'string' && /^\d+$/.test(direct.trim())) return Number(direct.trim());
    const reference = readString(payload.reference) ?? readString(payload.merchant_order_id);
    const match = reference?.match(ORDER_REFERENCE_RE) ?? null;
    if (match) {
      const candidate = Number(match[1]);
      if (Number.isSafeInteger(candidate) && candidate > 0) return candidate;
    }
    return null;
  }
}
