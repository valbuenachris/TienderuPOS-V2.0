import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PosCustomer } from '../auth/auth.types';
import { BoldService } from '../billing/bold.service';
import { CustomerCheckoutWithPaymentDto } from '../customer/customer.dto';
import { DatabaseService } from '../database/database.service';
import { SalePaymentMethod } from '../sales/sale.dto';
import { SalesService } from '../sales/sales.service';

type FinancingProvider = 'addi' | 'sistecredito';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly sales: SalesService,
    private readonly bold: BoldService,
    private readonly database: DatabaseService,
    private readonly config: ConfigService
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

    const amount = Number(sale.grand_total);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Order total is invalid for payment');
    }

    if (method === 'bold') {
      const reference = `ORDER-${sale.id}-${Date.now().toString(36)}`;
      const link = await this.bold.createPaymentLink({
        amount,
        description: `Pedido #${sale.id}`,
        reference,
        payerEmail: customer.email,
        callbackUrl: this.config.get<string>('CUSTOMER_PAYMENT_RETURN_URL') ?? null
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
      payment_url: this.createFinancingLink(method, sale.id, amount),
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
    const secretEnv = provider === 'addi'
      ? this.config.get<string>('ADDI_WEBHOOK_SECRET')
      : this.config.get<string>('SISTECREDITO_WEBHOOK_SECRET');
    const secret = (secretEnv ?? '').trim();
    if (secret !== '') {
      if (secretHeader !== secret) throw new BadRequestException('Invalid webhook secret');
    } else {
      this.logger.warn(`${provider} webhook sin secreto configurado; modo sandbox (stub)`);
    }

    this.logger.log(`[${provider} webhook] ${JSON.stringify(payload)?.slice(0, 500) ?? 'null'}`);
    if (!isRecord(payload)) throw new BadRequestException('Invalid payload');

    const orderId = this.readOrderId(payload);
    if (orderId === null) return { received: true, handled: false };
    const status = (readString(payload.status) ?? '').toLowerCase();
    if (status !== 'approved' && status !== 'paid' && status !== 'completed') {
      return { received: true, handled: false };
    }
    const amount = readString(payload.amount);
    const paidBy: SalePaymentMethod = provider === 'addi' ? 'ADI' : 'Sistecredito';
    const result = await this.sales.registerGatewayPayment(orderId, paidBy, amount ?? undefined);
    return { received: true, handled: result.handled };
  }

  private createFinancingLink(provider: FinancingProvider, saleId: number, amount: number): string {
    const callbackUrl = this.config.get<string>('CUSTOMER_PAYMENT_RETURN_URL') ?? 'https://pos.tienderu.com';
    const configuredKey = provider === 'addi'
      ? this.config.get<string>('ADDI_API_KEY')?.trim() ?? ''
      : this.config.get<string>('SISTECREDITO_API_KEY')?.trim() ?? '';
    const payload = {
      merchant_order_id: `ORDER-${saleId}`,
      reference: `ORDER-${saleId}`,
      amount,
      currency: 'COP',
      callback_url: callbackUrl,
      api_key_configured: configuredKey !== ''
    };
    this.logger.log(`[${provider.toUpperCase()} STUB] checkout payload: ${JSON.stringify(payload)}`);
    // TODO: replace this stub with the real provider API call once the contract is confirmed:
    //   - Addi: POST to the Addi checkout API using ADDI_API_KEY, return its checkout URL.
    //   - Sistecrédito: POST to the Sistecrédito API using SISTECREDITO_API_KEY, return its URL.
    // The order reference is `ORDER-<saleId>`; the provider must echo it on the webhook.
    if (provider === 'addi') {
      const base = this.config.get<string>('ADDI_CHECKOUT_BASE_URL') ?? 'https://sandbox.addi.com/checkout';
      return `${base}?order=ORDER-${saleId}`;
    }
    const base = this.config.get<string>('SISTECREDITO_CHECKOUT_BASE_URL') ?? 'https://sandbox.sistecredito.com/checkout';
    return `${base}?order=ORDER-${saleId}`;
  }

  private readOrderId(payload: Record<string, unknown>): number | null {
    const direct = payload.order_id ?? payload.sale_id;
    if (typeof direct === 'number' && Number.isSafeInteger(direct) && direct > 0) return direct;
    if (typeof direct === 'string' && /^\d+$/.test(direct.trim())) return Number(direct.trim());
    const reference = readString(payload.reference) ?? readString(payload.merchant_order_id);
    if (reference !== null && reference.startsWith('ORDER-')) {
      const candidate = Number(reference.split('-')[1]);
      if (Number.isSafeInteger(candidate) && candidate > 0) return candidate;
    }
    return null;
  }
}
