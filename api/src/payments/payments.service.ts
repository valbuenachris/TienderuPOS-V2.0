import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PosCustomer } from '../auth/auth.types';
import { CustomerCheckoutWithPaymentDto } from '../customer/customer.dto';
import { DatabaseService } from '../database/database.service';
import { SalesService } from '../sales/sales.service';
import { AddiService, extractSaleIdFromWebhook, parseBasicAuthHeader, readAmount, secureCompare } from './addi.service';
import {
  buildSistecreditoAck,
  normalizeSistecreditoDocumentNumber,
  normalizeSistecreditoDocumentType,
  toCents
} from './sistecredito.service';
import type { SistecreditoAck } from './sistecredito.service';
import { SistecreditoService } from './sistecredito.service';
import { TenantBoldService } from './tenant-bold.service';
import { TenantPaymentSettingsService, providerCredentials } from './tenant-payment-settings.service';

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
    private readonly tenantBold: TenantBoldService,
    private readonly addi: AddiService,
    private readonly sistecredito: SistecreditoService
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

    if (method === 'addi') {
      const paymentUrl = await this.addi.createCheckoutLink({
        tenantId,
        saleId: sale.id,
        amount,
        customer,
        redirectionUrl: callbackUrl
      });
      return {
        order_id: sale.id,
        status: sale.status,
        payment_url: paymentUrl,
        payment_method: method
      };
    }

    // sistecredito: cliente REAL (v0.12.6, contrato del plugin WooCommerce v1.13.0).
    const sistecreditoUrl = await this.sistecredito.createCheckoutLink({
      tenantId,
      saleId: sale.id,
      amount,
      customer
    });
    return {
      order_id: sale.id,
      status: sale.status,
      payment_url: sistecreditoUrl,
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

  /**
   * Webhook de Addi (v0.3.79): Basic Auth contra las credenciales DEL TENANT
   * (fail-closed) y liquidación solo con estado `approved`. El controller responde
   * 200 con el mismo JSON (Regla de Oro de Addi) después de esta validación.
   */
  async handleAddiWebhook(payload: unknown, authorization?: string): Promise<{ handled: boolean }> {
    if (!isRecord(payload)) throw new BadRequestException('Invalid payload');

    const saleId = extractSaleIdFromWebhook(payload);
    if (saleId === null) {
      this.logger.warn('Addi webhook sin referencia ORDER-<saleId>; no se puede validar el origen');
      throw new UnauthorizedException('Invalid Addi webhook credentials');
    }
    const sale = await this.resolveSaleTenant(saleId);
    if (!sale) {
      this.logger.warn(`Addi webhook para pedido desconocido ${saleId}`);
      throw new UnauthorizedException('Invalid Addi webhook credentials');
    }

    const settings = await this.paymentSettings.getForTenant(sale.tenantId);
    const credentials = settings ? providerCredentials(settings, 'addi') : null;
    // FAIL-CLOSED: sin credenciales del tenant no se procesa NADA (antes: modo sandbox abierto).
    if (!credentials || !credentials.enabled || !credentials.apiKey || !credentials.webhookSecret) {
      this.logger.warn(`Addi webhook rechazado: tenant ${sale.tenantId} sin addi_api_key/addi_webhook_secret`);
      throw new UnauthorizedException('Invalid Addi webhook credentials');
    }
    const basic = parseBasicAuthHeader(authorization);
    if (!basic) {
      this.logger.warn(`Addi webhook rechazado: sin Basic Auth (tenant ${sale.tenantId})`);
      throw new UnauthorizedException('Invalid Addi webhook credentials');
    }
    // El portal puede configurar el par en cualquier orden: se aceptan ambas orientaciones.
    const forward = secureCompare(basic.user, credentials.apiKey) && secureCompare(basic.password, credentials.webhookSecret);
    const reversed = secureCompare(basic.user, credentials.webhookSecret) && secureCompare(basic.password, credentials.apiKey);
    if (!forward && !reversed) {
      this.logger.warn(`Addi webhook rechazado: credenciales inválidas (tenant ${sale.tenantId})`);
      throw new UnauthorizedException('Invalid Addi webhook credentials');
    }

    // Callback oficial: { orderId, applicationId, approvedAmount, currency, status, statusTimestamp }
    // con status UPPERCASE (APPROVED|PENDING|REJECTED|ABANDONED|DECLINED|INTERNAL_ERROR).
    const status = (readString(payload.status) ?? readString(payload.state) ?? '').toLowerCase();
    if (status !== 'approved') {
      this.logger.log(`Addi webhook ${status === '' ? 'sin estado' : status} tenant=${sale.tenantId} order=${saleId} ignorado`);
      return { handled: false };
    }

    const amount = readAmount(payload.approvedAmount) ?? readAmount(payload.amount);
    const result = await this.sales.registerGatewayPayment(saleId, 'ADI', amount ?? undefined);
    this.logger.log(`Addi webhook pagado tenant=${sale.tenantId} order=${saleId} handled=${result.handled}`);
    return { handled: result.handled };
  }

  /**
   * Webhook de Sistecrédito (v0.12.6, contrato real del plugin WooCommerce v1.13.0):
   * POST server-to-server con `OrderId / TransactionId / TypeDocument / IdDocument /
   * ValueToPay / CreditNumber / Authentication (JWT) / TransactionStatus
   * ("Terminado"|"Error"|"Abandonada")`. Valida el JWT contra el token determinista de
   * la venta + `aud`, y el monto contra `grand_total` (comparación en centavos).
   * Responde SIEMPRE HTTP 200 con el acuse JSON `{function,errorCode,message,country,
   * data{...}}` (espejo de `confirm_payment()`); solo `Terminado` liquida vía
   * `registerGatewayPayment` (idempotente, acredita puntos). Fail-closed: sin tenant
   * habilitado o JWT inválido NO liquida.
   */
  async handleSistecreditoWebhook(payload: unknown): Promise<SistecreditoAck> {
    const errorAck = (
      errorCode: number,
      message: string,
      orderId: string | number | null = null,
      transactionId: string | null = null,
      errors: string[] = []
    ): SistecreditoAck =>
      buildSistecreditoAck({ errorCode, message, orderId, transactionId, status: 'ERROR', errors });

    if (!isRecord(payload)) {
      return errorAck(822, 'ConfirmationsParamsInvalid', null, null, ['Invalid payload']);
    }

    const orderId = this.readSistecreditoOrderId(payload);
    const transactionId = readString(payload.TransactionId) ?? readString(payload.transactionId);
    const status = readString(payload.TransactionStatus) ?? readString(payload.transactionStatus);
    const authentication = readString(payload.Authentication) ?? readString(payload.authentication);
    const documentType = normalizeSistecreditoDocumentType(
      readString(payload.TypeDocument) ?? readString(payload.typeDocument)
    );
    const documentNumber = normalizeSistecreditoDocumentNumber(
      readString(payload.IdDocument) ?? readString(payload.idDocument)
    );
    const amount = readAmount(payload.ValueToPay ?? payload.valueToPay);

    if (orderId === null) {
      return errorAck(822, 'ConfirmationsParamsInvalid', null, transactionId, ['OrderId inválido']);
    }
    if (status === null || authentication === null || documentType === null || documentNumber === null || amount === null) {
      return errorAck(822, 'ConfirmationsParamsInvalid', orderId, transactionId, ['Parámetros de confirmación inválidos']);
    }

    const sale = await this.resolveSaleTenant(orderId);
    if (!sale) {
      this.logger.warn(`[sistecredito webhook] pedido desconocido ${orderId}`);
      return errorAck(822, 'ConfirmationsParamsInvalid', orderId, transactionId, ['No se encontró el pedido']);
    }
    const settings = await this.paymentSettings.getForTenant(sale.tenantId);
    const credentials = settings ? providerCredentials(settings, 'sistecredito') : null;
    if (!credentials || !credentials.enabled || !credentials.apiKey) {
      this.logger.warn(`[sistecredito webhook] tenant ${sale.tenantId} sin Sistecrédito habilitado; rechazado`);
      return errorAck(825, 'ConfirmationJwtCatch', orderId, transactionId, ['La tienda no tiene Sistecrédito habilitado']);
    }
    if (!this.sistecredito.verifyConfirmationJwt(orderId, authentication)) {
      this.logger.warn(`[sistecredito webhook] JWT inválido tenant=${sale.tenantId} order=${orderId}`);
      return errorAck(825, 'ConfirmationJwtCatch', orderId, transactionId, ['No se pudo validar la autenticación']);
    }

    const expectedCents = toCents(sale.grandTotal);
    const receivedCents = toCents(amount);
    if (expectedCents === null || receivedCents === null || expectedCents !== receivedCents) {
      this.logger.error(
        `[sistecredito webhook] monto no coincide order=${orderId} ValueToPay=${amount} grand_total=${sale.grandTotal}`
      );
      return errorAck(826, 'ConfirmationValueNotMatch', orderId, transactionId, [
        `ValueToPay:${amount} Pedido:${sale.grandTotal}`
      ]);
    }

    const normalized = status.toLowerCase();
    if (normalized === 'terminado') {
      const result = await this.sales.registerGatewayPayment(orderId, 'Sistecredito', amount);
      this.logger.log(`Sistecrédito webhook aprobado tenant=${sale.tenantId} order=${orderId} handled=${result.handled}`);
      return buildSistecreditoAck({
        errorCode: 0,
        message: '',
        orderId,
        transactionId,
        status: 'VALID',
        errors: []
      });
    }
    if (normalized === 'abandonada' && sale.status === 'due') {
      this.logger.log(`Sistecrédito webhook abandonada tenant=${sale.tenantId} order=${orderId}`);
      return errorAck(827, 'Abandonada', orderId, transactionId, ['El usuario abandonó el proceso de pago con Sistecrédito']);
    }
    this.logger.log(`Sistecrédito webhook estado ${status} tenant=${sale.tenantId} order=${orderId} ignorado`);
    return errorAck(823, 'ConfirmationsTransactionStatusInvalid', orderId, transactionId, [`Estado ${status}`]);
  }

  /**
   * Retorno del usuario desde el checkout de Sistecrédito (GET a la misma URL con
   * `?transactionId=&orderId=`): verifica la transacción con `getInfoCredit` y liquida
   * idempotente si está aprobada (respaldo del webhook). Devuelve la URL de redirección
   * (`return_url` del tenant o el global `CUSTOMER_PAYMENT_RETURN_URL`).
   */
  async verifySistecreditoReturn(orderIdRaw: string | undefined, transactionIdRaw: string | undefined): Promise<string> {
    const fallback = this.config.get<string>('CUSTOMER_PAYMENT_RETURN_URL') ?? 'https://pos.tienderu.com';
    const orderId = orderIdRaw !== undefined && /^\d+$/.test(orderIdRaw.trim()) ? Number(orderIdRaw.trim()) : null;
    const transactionId = readString(transactionIdRaw ?? null);
    if (orderId === null || !Number.isSafeInteger(orderId) || orderId <= 0 || transactionId === null) {
      return fallback;
    }
    const sale = await this.resolveSaleTenant(orderId);
    if (!sale) return fallback;
    const settings = await this.paymentSettings.getForTenant(sale.tenantId);
    const returnUrl = settings?.returnUrl ?? fallback;
    try {
      const info = await this.sistecredito.verifyTransaction(sale.tenantId, transactionId);
      if (info?.approved === true) {
        await this.sales.registerGatewayPayment(orderId, 'Sistecredito', info.valueToPaid ?? undefined);
        this.logger.log(`Sistecrédito retorno verificado order=${orderId} transaction=${transactionId} aprobada`);
      } else {
        this.logger.log(`Sistecrédito retorno order=${orderId} transaction=${transactionId} sin aprobación`);
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Sistecrédito retorno no verificable order=${orderId}: ${error instanceof Error ? error.message : 'unknown'}`
      );
    }
    return returnUrl;
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
    const amount = readAmount(amountData?.total);
    const result = await this.sales.registerGatewayPayment(
      saleId,
      'bold',
      amount === null || amount === '0' ? undefined : amount
    );
    this.logger.log(`Bold tenant webhook pagado tenant=${sale.tenantId} order=${saleId} handled=${result.handled}`);
    return { handled: result.handled };
  }

  private async resolveSaleTenant(
    saleId: number
  ): Promise<{ saleId: number; tenantId: string; grandTotal: string | null; status: string } | null> {
    const result = await this.database.query<{
      id: number;
      tenant_id: string;
      grand_total: string | null;
      status: string;
    }>(
      `SELECT id, tenant_id::text AS tenant_id, grand_total::text AS grand_total, status
       FROM public.tec_sales WHERE id = $1 LIMIT 1`,
      [saleId]
    );
    const row = result.rows[0];
    return row
      ? { saleId: row.id, tenantId: row.tenant_id, grandTotal: row.grand_total, status: row.status }
      : null;
  }

  private readSistecreditoOrderId(payload: Record<string, unknown>): number | null {
    const direct = payload.OrderId ?? payload.orderId;
    if (typeof direct === 'number' && Number.isSafeInteger(direct) && direct > 0) return direct;
    if (typeof direct === 'string' && /^\d+$/.test(direct.trim())) return Number(direct.trim());
    return null;
  }
}
