import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PosCustomer } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import {
  PAYMENT_NOT_CONFIGURED_MESSAGE,
  providerCredentials,
  TenantPaymentSettingsService
} from './tenant-payment-settings.service';

const ORDER_REFERENCE_RE = /^ORDER-(\d+)(?:-|$)/i;
const SANDBOX_AUTH_URL = 'https://auth.addi-staging.com/oauth/token';
const SANDBOX_AUDIENCE = 'https://api.staging.addi.com';
const SANDBOX_API_BASE = 'https://api.staging.addi.com';
const DEFAULT_APPLICATIONS_PATH = '/v1/online-applications';
const DEFAULT_CALLBACK_URL = 'https://pos.tienderu.com/api/webhooks/addi';
// Addi exige `redirectionUrl` siempre presente (fallback si el tenant no define return_url).
const DEFAULT_REDIRECTION_URL = 'https://pos.tienderu.com/config?payment=return';
// Dirección de respaldo SOLO en modo sandbox (con ADDI_TEST_DOCUMENT_NUMBER definido).
const DEFAULT_SHIPPING_ADDRESS = 'Calle Falsa 123';
const DEFAULT_SHIPPING_CITY = 'Bogotá';
const REQUEST_TIMEOUT_MS = 12000;

export const ADDI_DOCUMENT_REQUIRED_MESSAGE =
  'Agrega tu cédula (CC) en tu perfil para pagar con Addi.';
export const ADDI_PHONE_REQUIRED_MESSAGE =
  'Agrega un celular de 10 dígitos en tu perfil para pagar con Addi.';
export const ADDI_ADDRESS_REQUIRED_MESSAGE =
  'Agrega una dirección en tu perfil para pagar con Addi.';
export const ADDI_ACTIVE_LOAN_MESSAGE =
  'El cliente ya tiene un crédito activo con Addi. Elige otro medio de pago.';

export type AddiAddress = { lineOne: string; city: string; country: string };

export type AddiItemInput = {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  tax: number;
};

export type AddiPayloadInput = {
  orderId: string;
  amount: number;
  taxAmount: number;
  firstName: string;
  lastName: string;
  email: string;
  cellphone: string;
  documentType: string;
  documentNumber: string;
  callbackUrl: string;
  redirectionUrl: string;
  items: AddiItemInput[];
  address: AddiAddress;
  includeShipping: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Comparación de secretos en tiempo constante (hash primero para ocultar largos). */
export function secureCompare(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** Decodifica `Authorization: Basic base64(user:password)`; null si es inválido. */
export function parseBasicAuthHeader(header: string | undefined): { user: string; password: string } | null {
  if (!header) return null;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!match) return null;
  let decoded = '';
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch (_error: unknown) {
    return null;
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

/** Monto tolerante a number o string (los webhooks de pasarelas alternan tipos). */
export function readAmount(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  const text = readString(value);
  if (text === null) return null;
  return /^\d+(\.\d+)?$/.test(text) ? text : null;
}

/**
 * Acepta `ADDI_AUTH_URL` como base (`https://auth.addi.com`) o URL completa
 * (`https://auth.addi.com/oauth/token`): colapsa `//` internos (sin tocar el
 * esquema), quita slashes finales y agrega `/oauth/token` cuando falta el path.
 * (v0.3.80: la base sin path producía un POST a la raíz → 404 de Auth0.)
 */
export function normalizeAuthUrl(value: string): string {
  const collapsed = value.trim().replace(/([^:])\/{2,}/g, '$1/');
  const trimmed = collapsed.replace(/\/+$/, '');
  if (trimmed === '') return trimmed;
  if (/\/oauth\/token$/i.test(trimmed)) return trimmed;
  return `${trimmed}/oauth/token`;
}

/** Muestra solo prefijo y largo de una credencial en logs (nunca el valor completo). */
export function maskSecret(value: string): string {
  return value.length <= 8 ? `***(${value.length})` : `${value.slice(0, 4)}…(${value.length})`;
}

/** Enmascara email para logs de debug (conserva el dominio). */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return value === '' ? '' : '***';
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

/** Enmascara teléfono para logs de debug (conserva los últimos 4 dígitos). */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length <= 4 ? '***' : `***${digits.slice(-4)}`;
}

/**
 * v0.3.96 (schema oficial): montos y cantidades viajan como STRING con punto
 * decimal ("45000.0", "2"). Los ejemplos del spec usan un decimal.
 */
export function toAddiAmount(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : value.toFixed(2);
}

/**
 * v0.3.96 (schema oficial): `client.cellphone` es el número de 10 dígitos SIN
 * indicativo; el `+57` va aparte en `client.cellphoneCountryCode`.
 */
export function normalizeAddiCellphone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('57') && digits.length > 10) digits = digits.slice(2);
  return digits;
}

/**
 * Construye el body EXACTO del contrato oficial (ADDI API · E-commerce CO,
 * POST /v1/online-applications → 301 + Location):
 *  · Requeridos: orderId, totalAmount, shippingAmount, currency, client, allyUrlRedirection, items.
 *  · client.address es OBLIGATORIA (lineOne/city/country).
 *  · Montos/cantidades como strings; ítems con sku/name/quantity/unitPrice (+tax informativo).
 *  · callbackUrl/redirectionUrl van anidados en allyUrlRedirection (camelCase).
 */
export function buildAddiPayload(input: AddiPayloadInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    orderId: input.orderId,
    totalAmount: toAddiAmount(input.amount),
    shippingAmount: toAddiAmount(0),
    totalTaxesAmount: toAddiAmount(input.taxAmount),
    currency: 'COP',
    items: input.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: String(item.quantity),
      unitPrice: toAddiAmount(item.unitPrice),
      tax: toAddiAmount(item.tax)
    })),
    client: {
      idType: input.documentType,
      idNumber: input.documentNumber,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      cellphone: normalizeAddiCellphone(input.cellphone),
      cellphoneCountryCode: '+57',
      address: input.address
    },
    allyUrlRedirection: {
      callbackUrl: input.callbackUrl,
      redirectionUrl: input.redirectionUrl
    }
  };
  if (input.includeShipping) {
    body.shippingAddress = input.address;
    body.billingAddress = input.address;
  }
  return body;
}

/**
 * Política de datos del cliente para Addi (v0.12.5):
 *  · Sandbox (`ADDI_TEST_DOCUMENT_NUMBER` definido): cédula de prueba y dirección de
 *    relleno como fallback (comportamiento histórico).
 *  · Producción (sin la variable): exige cédula real, celular de 10 dígitos y
 *    dirección real del cliente, con mensajes claros para la app.
 */
export type AddiCustomerDataResolution =
  | { ok: true; documentNumber: string; address: AddiAddress; includeShipping: boolean }
  | { ok: false; message: string };

export function resolveAddiCustomerData(input: {
  testDocumentNumber: string;
  documentNumber: string | null;
  cellphone: string;
  address: AddiAddress | null;
  sendShipping: boolean;
}): AddiCustomerDataResolution {
  const sandbox = input.testDocumentNumber.trim() !== '';
  if (input.documentNumber === null && !sandbox) {
    return { ok: false, message: ADDI_DOCUMENT_REQUIRED_MESSAGE };
  }
  if (!sandbox && normalizeAddiCellphone(input.cellphone).length !== 10) {
    return { ok: false, message: ADDI_PHONE_REQUIRED_MESSAGE };
  }
  if (input.address === null && !sandbox) {
    return { ok: false, message: ADDI_ADDRESS_REQUIRED_MESSAGE };
  }
  const address: AddiAddress = input.address ?? {
    lineOne: DEFAULT_SHIPPING_ADDRESS,
    city: DEFAULT_SHIPPING_CITY,
    country: 'CO'
  };
  return {
    ok: true,
    documentNumber: input.documentNumber ?? input.testDocumentNumber,
    address,
    includeShipping: input.sendShipping && input.address !== null
  };
}

/** Extrae el saleId de la referencia `ORDER-<saleId>[-<ts>]` ecoada por Addi. */
export function extractSaleIdFromWebhook(payload: Record<string, unknown>): number | null {
  // El callback oficial (OnlineLoanApplicationCallbackRequest) trae `orderId`.
  // Se aceptan variantes y objetos anidados (order/application/data) por robustez.
  const keys = ['orderId', 'order_id', 'external_id', 'externalId', 'reference', 'merchant_order_id'];
  const scan = (record: Record<string, unknown>): number | null => {
    for (const key of keys) {
      const value = record[key];
      const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : readString(value);
      if (text === null) continue;
      const match = ORDER_REFERENCE_RE.exec(text);
      if (match) {
        const saleId = Number(match[1]);
        if (Number.isSafeInteger(saleId) && saleId > 0) return saleId;
      }
      // Robustez: un orderId puramente numérico se interpreta como saleId.
      if (/^\d+$/.test(text)) {
        const saleId = Number(text);
        if (Number.isSafeInteger(saleId) && saleId > 0) return saleId;
      }
    }
    return null;
  };
  const direct = scan(payload);
  if (direct !== null) return direct;
  for (const nestedKey of ['order', 'application', 'data']) {
    const nested = payload[nestedKey];
    if (isRecord(nested)) {
      const found = scan(nested);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * Addi "Custom Integrations" para la tienda virtual de cada tenant (v0.3.79).
 * OAuth2 client-credentials: client_id = addi_api_key, client_secret = addi_webhook_secret
 * (ambos del tenant en tec_tenant_payment_settings). v0.3.96: token nuevo por
 * transacción (recomendación oficial; evita expiraciones cruzadas).
 */
@Injectable()
export class AddiService {
  private readonly logger = new Logger(AddiService.name);
  private readonly authUrl: string;
  private readonly audience: string;
  private readonly apiBase: string;
  private readonly applicationsPath: string;
  private readonly callbackUrl: string;
  private readonly testDocumentNumber: string;
  private readonly sendShipping: boolean;
  private readonly debugPayload: boolean;

  constructor(
    config: ConfigService,
    private readonly paymentSettings: TenantPaymentSettingsService,
    private readonly database: DatabaseService
  ) {
    this.authUrl = normalizeAuthUrl(config.get<string>('ADDI_AUTH_URL') ?? SANDBOX_AUTH_URL);
    this.audience = config.get<string>('ADDI_AUDIENCE') ?? SANDBOX_AUDIENCE;
    this.apiBase = (
      config.get<string>('ADDI_API_BASE_URL')
      ?? config.get<string>('ADDI_CHECKOUT_BASE_URL')
      ?? SANDBOX_API_BASE
    ).trim().replace(/\/+$/, '');
    const rawPath = (config.get<string>('ADDI_APPLICATIONS_PATH') ?? DEFAULT_APPLICATIONS_PATH).trim().replace(/\/+$/, '');
    this.applicationsPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    this.callbackUrl = config.get<string>('ADDI_CALLBACK_URL') ?? DEFAULT_CALLBACK_URL;
    this.testDocumentNumber = (config.get<string>('ADDI_TEST_DOCUMENT_NUMBER') ?? '').trim();
    if (this.testDocumentNumber !== '') {
      this.logger.warn(
        'ADDI_TEST_DOCUMENT_NUMBER configurado: modo SANDBOX (cédula de prueba y dirección de relleno como ' +
        'fallback). Quita esa variable en producción para exigir la cédula real del cliente.'
      );
    }
    this.sendShipping = (config.get<string>('ADDI_SEND_SHIPPING') ?? 'true').trim().toLowerCase() !== 'false';
    this.debugPayload = (config.get<string>('ADDI_DEBUG_PAYLOAD') ?? 'false').trim().toLowerCase() === 'true';
    if (!config.get('ADDI_AUTH_URL') || !config.get('ADDI_API_BASE_URL')) {
      this.logger.warn(
        'Addi usando URLs de SANDBOX por defecto (auth.addi-staging.com / api.staging.addi.com). ' +
        'Define ADDI_AUTH_URL, ADDI_AUDIENCE y ADDI_API_BASE_URL con los valores de producción.'
      );
    }
  }

  async getAccessToken(tenantId: string): Promise<string> {
    const credentials = await this.requireCredentials(tenantId);
    const issued = await this.requestToken(credentials.apiKey, credentials.webhookSecret);
    return issued.token;
  }

  async createCheckoutLink(input: {
    tenantId: string;
    saleId: number;
    amount: number;
    customer: PosCustomer;
    redirectionUrl: string | null;
  }): Promise<string> {
    const accessToken = await this.getAccessToken(input.tenantId);
    // El orderId acepta cualquier formato pero debe ser único por intento.
    const orderId = `ORDER-${input.saleId}-${Date.now().toString(36)}`;
    const nameParts = (input.customer.name ?? '').trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ');
    const email = input.customer.email ?? '';
    const items = await this.loadSaleItems(input.saleId, input.tenantId);
    const taxAmount = await this.loadSaleTax(input.saleId, input.tenantId);
    const customerDocument = await this.loadCustomerDocument(input.customer.id);
    const address = await this.loadCustomerAddress(input.customer.id);
    const resolved = resolveAddiCustomerData({
      testDocumentNumber: this.testDocumentNumber,
      documentNumber: customerDocument,
      cellphone: input.customer.phone ?? '',
      address,
      sendShipping: this.sendShipping
    });
    if (!resolved.ok) throw new BadRequestException(resolved.message);
    const body = buildAddiPayload({
      orderId,
      amount: input.amount,
      taxAmount,
      firstName,
      lastName,
      email,
      cellphone: input.customer.phone ?? '',
      documentType: 'CC',
      documentNumber: resolved.documentNumber,
      callbackUrl: this.callbackUrl,
      redirectionUrl: input.redirectionUrl ?? DEFAULT_REDIRECTION_URL,
      items,
      address: resolved.address,
      // shipping/billing solo con dirección real (son opcionales en el contrato).
      includeShipping: resolved.includeShipping
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // El request REAL viaja sin máscara (JSON.stringify(body) en el fetch);
      // esta copia es SOLO para el log y enmascara email/celular del client.
      const client = body.client as Record<string, unknown>;
      const debugBody: Record<string, unknown> = {
        ...body,
        client: {
          ...client,
          email: maskEmail(String(client.email ?? '')),
          cellphone: maskPhone(String(client.cellphone ?? ''))
        }
      };
      const debugLine =
        `Addi create request (schema v0.3.96): POST ${this.apiBase}${this.applicationsPath} ` +
        `body(debug; PII enmascarada solo aquí, el request real va sin máscara)=${JSON.stringify(debugBody)}`;
      if (this.debugPayload) {
        this.logger.warn(
          `${debugLine} | headers: Authorization=Bearer <redacted len=${accessToken.length}>, ` +
          'Accept=application/json, Content-Type=application/json'
        );
      } else {
        this.logger.debug(debugLine);
      }
      const response = await fetch(`${this.apiBase}${this.applicationsPath}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      // Contrato oficial: 301 con `Location` = URL de checkout (sin seguir el redirect).
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        return new URL(location, this.apiBase).toString();
      }

      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (_error: unknown) {
        parsed = null;
      }

      // Fallback defensivo: algunos ambientes devuelven 2xx con la URL en el body.
      if (response.ok && isRecord(parsed)) {
        const direct = readString(parsed.checkout_url)
          ?? readString(parsed.checkoutUrl)
          ?? readString(parsed.url)
          ?? readString(parsed.payment_url)
          ?? readString(parsed.redirect_url)
          ?? readString(parsed.redirectUrl);
        if (direct) return direct;
        const data = isRecord(parsed.data) ? parsed.data : null;
        const nested = data
          ? readString(data.checkout_url) ?? readString(data.checkoutUrl) ?? readString(data.url)
          : null;
        if (nested) return nested;
      }

      // Cuerpo COMPLETO + `errors[]` + `x-trace-id` (para soporte de Addi).
      const traceId = response.headers.get('x-trace-id') ?? response.headers.get('trace-id');
      const traceSuffix = traceId ? ` [trace-id ${traceId}]` : '';
      this.logger.error(`Addi POST ${this.apiBase}${this.applicationsPath} -> ${response.status}${traceSuffix}: ${text}`);
      let detail = text.slice(0, 300);
      if (isRecord(parsed) && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
        const errors = parsed.errors
          .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join(' · ')
          .slice(0, 600);
        this.logger.error(`Addi errors${traceSuffix}: ${errors}`);
        detail = errors.slice(0, 300);
      }
      if (response.status === 409) {
        // Spec oficial: el cliente ya cuenta con crédito en Addi.
        throw new BadRequestException(ADDI_ACTIVE_LOAN_MESSAGE);
      }
      throw new BadRequestException(`Addi no pudo crear la solicitud (status ${response.status}${traceSuffix}): ${detail}`);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Addi POST ${this.applicationsPath} failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new BadRequestException('No se pudo contactar a Addi para esta tienda');
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Ítems de la venta para el payload de Addi (sku desde `code`; tax informativo). */
  private async loadSaleItems(saleId: number, tenantId: string): Promise<AddiItemInput[]> {
    const result = await this.database.query<{
      product_id: number | null;
      code: string | null;
      name: string | null;
      quantity: string | number;
      unit_price: string;
      subtotal: string | null;
      tax_rate: string | null;
    }>(
      `SELECT si.product_id, p.code, p.name, si.quantity, si.unit_price::text AS unit_price,
              si.subtotal::text AS subtotal, p.tax::text AS tax_rate
       FROM public.tec_sale_items si
       LEFT JOIN public.tec_products p ON p.id = si.product_id
       WHERE si.sale_id = $1 AND si.tenant_id = $2
       ORDER BY si.id ASC`,
      [saleId, tenantId]
    );
    return result.rows.map((row) => {
      const quantity = Math.max(1, Math.round(Number(row.quantity) || 1));
      const unitPrice = Math.round(Number(row.unit_price) || 0);
      const subtotal = Math.round(Number(row.subtotal) || unitPrice * quantity);
      const taxRate = Number(row.tax_rate ?? 0);
      return {
        sku: readString(row.code) ?? `PROD-${row.product_id ?? 0}`,
        name: readString(row.name) ?? 'Producto',
        quantity,
        unitPrice,
        tax: Number.isFinite(taxRate) && taxRate > 0 ? Math.round((subtotal * taxRate) / 100) : 0
      };
    });
  }

  /** IVA total de la venta (informativo en el payload: `totalTaxesAmount`). */
  private async loadSaleTax(saleId: number, tenantId: string): Promise<number> {
    const result = await this.database.query<{ tax: string | null }>(
      `SELECT COALESCE(total_tax, 0)::text AS tax
       FROM public.tec_sales
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [saleId, tenantId]
    );
    const tax = Number(result.rows[0]?.tax ?? 0);
    return Number.isFinite(tax) ? tax : 0;
  }

  /** Cédula real del cliente (tec_customers.document_number, v0.12.5). */
  private async loadCustomerDocument(customerId: number): Promise<string | null> {
    try {
      const result = await this.database.query<{ document_number: string | null }>(
        `SELECT document_number
         FROM public.tec_customers
         WHERE id = $1
         LIMIT 1`,
        [customerId]
      );
      return readString(result.rows[0]?.document_number);
    } catch (_error: unknown) {
      // La columna puede no existir antes de la migración v0.12.5.
      return null;
    }
  }

  /** Dirección por defecto del cliente (customer_addresses) para `client.address`. */
  private async loadCustomerAddress(customerId: number): Promise<AddiAddress | null> {
    try {
      const result = await this.database.query<{ street_address: string | null; city: string | null }>(
        `SELECT street_address, city
         FROM public.customer_addresses
         WHERE customer_id = $1
         ORDER BY is_default DESC, id ASC
         LIMIT 1`,
        [customerId]
      );
      const row = result.rows[0];
      const lineOne = readString(row?.street_address);
      if (row === undefined || lineOne === null) return null;
      return {
        lineOne,
        city: readString(row.city) ?? DEFAULT_SHIPPING_CITY,
        country: 'CO'
      };
    } catch (_error: unknown) {
      // La tabla puede no existir en entornos viejos: fallback a la dirección por defecto.
      return null;
    }
  }

  private async requireCredentials(tenantId: string): Promise<{ apiKey: string; webhookSecret: string }> {
    const settings = await this.paymentSettings.getForTenant(tenantId);
    const credentials = settings ? providerCredentials(settings, 'addi') : null;
    if (!credentials || !credentials.enabled || !credentials.apiKey || !credentials.webhookSecret) {
      throw new BadRequestException(PAYMENT_NOT_CONFIGURED_MESSAGE);
    }
    return { apiKey: credentials.apiKey, webhookSecret: credentials.webhookSecret };
  }

  private async requestToken(clientId: string, clientSecret: string): Promise<{ token: string; expiresIn: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // Auth0 espera form-urlencoded en /oauth/token. El debug registra la
      // URL final EXACTA y los headers; nunca imprime client_secret (solo su largo).
      const form = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: this.audience
      });
      this.logger.debug(
        `Addi token request: POST ${this.authUrl} | Content-Type: application/x-www-form-urlencoded | ` +
        `client_id=${maskSecret(clientId)} | client_secret=[REDACTED len=${clientSecret.length}] | audience=${this.audience}`
      );
      const response = await fetch(this.authUrl, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: controller.signal
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (_error: unknown) {
        parsed = null;
      }
      if (!response.ok || !isRecord(parsed)) {
        // Nunca loggear credenciales; solo URL final, estado y cuerpo recortado.
        this.logger.error(`Addi token POST ${this.authUrl} -> ${response.status}: ${text.slice(0, 300)}`);
        throw new BadRequestException(
          `No se pudo autenticar con Addi (status ${response.status} en ${this.authUrl}; revisa addi_api_key/addi_webhook_secret)`
        );
      }
      const token = readString(parsed.access_token);
      if (!token) {
        this.logger.error('Addi token: respuesta sin access_token');
        throw new BadRequestException('No se pudo autenticar con Addi');
      }
      const expiresIn = typeof parsed.expires_in === 'number' && Number.isFinite(parsed.expires_in)
        ? parsed.expires_in
        : 3600;
      return { token, expiresIn };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Addi token failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new BadRequestException('No se pudo contactar a Addi para autenticación');
    } finally {
      clearTimeout(timeout);
    }
  }
}