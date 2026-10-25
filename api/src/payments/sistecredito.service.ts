import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PAYMENT_NOT_CONFIGURED_MESSAGE,
  providerCredentials,
  TenantPaymentSettingsService
} from './tenant-payment-settings.service';

const DEFAULT_CHECKOUT_BASE_URL = 'https://sandbox.sistecredito.com/checkout';
const DEFAULT_CALLBACK_URL = 'https://pos.tienderu.com';

/** URL del stub de checkout (contrato real pendiente). `ORDER-<saleId>` como referencia. */
export function buildSistecreditoStubUrl(baseUrl: string, saleId: number): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return `${base}?order=ORDER-${saleId}`;
}

/** Payload previsto del checkout real (hoy solo se registra en el log del stub). */
export function buildSistecreditoStubPayload(input: {
  tenantId: string;
  saleId: number;
  amount: number;
  redirectionUrl: string | null;
}): Record<string, unknown> {
  return {
    merchant_order_id: `ORDER-${input.saleId}`,
    reference: `ORDER-${input.saleId}`,
    amount: Math.round(input.amount),
    currency: 'COP',
    callback_url: input.redirectionUrl ?? DEFAULT_CALLBACK_URL,
    tenant_id: input.tenantId
  };
}

/**
 * Sistecrédito para la tienda virtual (v0.3.85): resuelve las credenciales DEL
 * TENANT (`sistecredito_enabled` + `sistecredito_api_key`) y genera el link de
 * checkout. El contrato real de la API de Sistecrédito aún no está confirmado:
 * hoy devuelve una URL sandbox (`SISTECREDITO_CHECKOUT_BASE_URL`) y registra el
 * payload previsto. Reemplazar `createCheckoutLink` por la llamada real cuando
 * el contrato esté disponible — AddiService (v0.3.79) es la implementación de
 * referencia — manteniendo el webhook `x-webhook-secret` (fail-closed) de
 * PaymentsService.
 */
@Injectable()
export class SistecreditoService {
  private readonly logger = new Logger(SistecreditoService.name);
  private readonly checkoutBaseUrl: string;

  constructor(
    config: ConfigService,
    private readonly paymentSettings: TenantPaymentSettingsService
  ) {
    this.checkoutBaseUrl = (
      config.get<string>('SISTECREDITO_CHECKOUT_BASE_URL') ?? DEFAULT_CHECKOUT_BASE_URL
    ).trim().replace(/\/+$/, '');
    if (!config.get('SISTECREDITO_CHECKOUT_BASE_URL')) {
      this.logger.warn(
        'Sistecrédito usando URL de SANDBOX por defecto; define SISTECREDITO_CHECKOUT_BASE_URL ' +
        'con el valor real cuando el contrato esté confirmado.'
      );
    }
  }

  async createCheckoutLink(input: {
    tenantId: string;
    saleId: number;
    amount: number;
    redirectionUrl: string | null;
  }): Promise<string> {
    // Fail-closed: sin credenciales del tenant no se genera link (mismo contrato que Addi).
    const settings = await this.paymentSettings.getForTenant(input.tenantId);
    const credentials = settings ? providerCredentials(settings, 'sistecredito') : null;
    if (!credentials || !credentials.enabled || !credentials.apiKey) {
      throw new BadRequestException(PAYMENT_NOT_CONFIGURED_MESSAGE);
    }

    const payload = buildSistecreditoStubPayload({
      tenantId: input.tenantId,
      saleId: input.saleId,
      amount: input.amount,
      redirectionUrl: input.redirectionUrl
    });
    this.logger.log(`[SISTECREDITO STUB] tenant=${input.tenantId} checkout payload: ${JSON.stringify(payload)}`);
    // TODO: integrar la API real de Sistecrédito cuando se confirme el contrato
    //  (auth con sistecredito_api_key, endpoint de creación del link de pago,
    //  webhook validado con sistecredito_webhook_secret). El pedido se liquida
    //  igual vía SalesService.registerGatewayPayment(orderId, 'Sistecredito').
    return buildSistecreditoStubUrl(this.checkoutBaseUrl, input.saleId);
  }
}