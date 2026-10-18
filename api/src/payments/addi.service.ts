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
// TODO: CAMPO_REAL_DE_ADDI — confirmar el path real de creación de solicitud online.
const DEFAULT_APPLICATIONS_PATH = '/v1/online-applications';
const DEFAULT_CALLBACK_URL = 'https://pos.tienderu.com/api/webhooks/addi';
// Addi exige `redirection_url` siempre presente (fallback si el tenant no define return_url).
const DEFAULT_REDIRECTION_URL = 'https://pos.tienderu.com/config?payment=return';
// CC de prueba para sandbox; env ADDI_TEST_DOCUMENT_NUMBER lo sobreescribe.
const DEFAULT_TEST_DOCUMENT_NUMBER = '1001234567';
// Shipping de prueba mientras el checkout de la app no envíe dirección (ver customer_addresses).
const DEFAULT_SHIPPING_ADDRESS = 'Calle Falsa 123';
const DEFAULT_SHIPPING_CITY = 'Bogotá';
const TOKEN_SAFETY_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 12000;

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

/** Normaliza teléfonos colombianos al formato que espera Addi: 57XXXXXXXXXX (sin signo +). */
export function normalizePhoneForAddi(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits === '') return '';
  if (digits.length > 10) return digits;
  return `57${digits}`;
}

/** Extrae el saleId de la referencia `ORDER-<saleId>[-<ts>]` ecoada por Addi. */
export function extractSaleIdFromWebhook(payload: Record<string, unknown>): number | null {
  // TODO: CAMPO_REAL_DE_ADDI — confirmar el campo exacto del callback; se aceptan
  // variantes conocidas y objetos anidados (order/application/data) por robustez.
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

type CachedToken = { token: string; expiresAt: number };

/**
 * Addi "Custom Integrations" para la tienda virtual de cada tenant (v0.3.79).
 * OAuth2 client-credentials: client_id = addi_api_key, client_secret = addi_webhook_secret
 * (ambos del tenant en tec_tenant_payment_settings). El JWT se cachea por tenant.
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
  private readonly tokens = new Map<string, CachedToken>();

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
    this.testDocumentNumber = config.get<string>('ADDI_TEST_DOCUMENT_NUMBER') ?? DEFAULT_TEST_DOCUMENT_NUMBER;
    this.sendShipping = (config.get<string>('ADDI_SEND_SHIPPING') ?? 'true').trim().toLowerCase() !== 'false';
    if (!config.get('ADDI_AUTH_URL') || !config.get('ADDI_API_BASE_URL')) {
      this.logger.warn(
        'Addi usando URLs de SANDBOX por defecto (auth.addi-staging.com / api.staging.addi.com). ' +
        'Define ADDI_AUTH_URL, ADDI_AUDIENCE y ADDI_API_BASE_URL con los valores de producción.'
      );
    }
  }

  async getAccessToken(tenantId: string): Promise<string> {
    const cached = this.tokens.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const credentials = await this.requireCredentials(tenantId);
    const issued = await this.requestToken(credentials.apiKey, credentials.webhookSecret);
    const ttl = Math.max(issued.expiresIn - TOKEN_SAFETY_SECONDS, 60);
    this.tokens.set(tenantId, { token: issued.token, expiresAt: Date.now() + ttl * 1000 });
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
    // Referencia única por intento; el webhook la resuelve con ORDER_REFERENCE_RE.
    const orderId = `ORDER-${input.saleId}-${Date.now().toString(36)}`;
    const nameParts = (input.customer.name ?? '').trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ');
    const email = input.customer.email ?? '';
    // v0.3.84: Addi espera el teléfono como 57XXXXXXXXXX (indicativo, sin signo +).
    // Fuente: input.customer.phone (PosCustomer del token, digits-only desde v0.3.59).
    const phone = normalizePhoneForAddi(input.customer.phone ?? '');
    const items = await this.loadSaleItems(input.saleId, input.tenantId);
    // TODO: CAMPO_REAL_DE_ADDI — estructura snake_case con `customer`/`shipping`/`items`
    // (v0.3.82: Addi exige `redirection_url` SIEMPRE y algunas integraciones requieren
    // `shipping`); verificar nombres finales contra la doc.
    // TODO: CAMPO_REAL_DE_ADDI — tec_customers no guarda documento: se envía el CC de
    // prueba (env ADDI_TEST_DOCUMENT_NUMBER); mapear el campo real cuando exista.
    // TODO: CAMPO_REAL_DE_ADDI — shipping con dirección de prueba; cuando el checkout
    // de la app envíe dirección, tomarla de customer_addresses.
    // TODO: opcional minAmount/maxAmount vía GET /allies/{ally_slug}/config
    // (requiere ally_slug, hoy no está en tec_tenant_payment_settings).
    const body: Record<string, unknown> = {
      // Tipos estrictos: amount/quantity/price siempre enteros (Math.round), nunca strings.
      order_id: orderId,
      amount: Math.round(input.amount),
      currency: 'COP',
      customer: {
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        document_type: 'CC',
        document_number: this.testDocumentNumber
      },
      callback_url: this.callbackUrl,
      redirection_url: input.redirectionUrl ?? DEFAULT_REDIRECTION_URL,
      items
    };
    // v0.3.84: `shipping` con `country: 'CO'`. Desactivable con ADDI_SEND_SHIPPING=false
    // para aislar si Addi lo rechaza (fallback de depuración).
    if (this.sendShipping) {
      body.shipping = {
        first_name: firstName,
        last_name: lastName,
        phone,
        address: DEFAULT_SHIPPING_ADDRESS,
        city: DEFAULT_SHIPPING_CITY,
        country: 'CO'
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // v0.3.83: el request REAL viaja sin máscara (JSON.stringify(body) en el fetch);
      // esta copia es SOLO para el log y enmascara AMBAS ocurrencias (customer y shipping).
      const debugBody: Record<string, unknown> = {
        ...body,
        customer: { ...(body.customer as Record<string, unknown>), email: maskEmail(email), phone: maskPhone(phone) },
        ...(body.shipping
          ? { shipping: { ...(body.shipping as Record<string, unknown>), phone: maskPhone(phone) } }
          : {})
      };
      this.logger.debug(
        `Addi create request: POST ${this.apiBase}${this.applicationsPath} ` +
        `body(debug; PII enmascarada solo aquí, el request real va sin máscara)=${JSON.stringify(debugBody)}`
      );
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

      // Contrato confirmado: 301 con `Location` = URL de checkout (sin seguir el redirect).
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

      if (response.status === 401) this.tokens.delete(input.tenantId);

      // v0.3.84: cuerpo COMPLETO + `errors[]` + `x-trace-id` (para soporte de Addi).
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
      throw new BadRequestException(`Addi no pudo crear la solicitud (status ${response.status}${traceSuffix}): ${detail}`);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Addi POST ${this.applicationsPath} failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new BadRequestException('No se pudo contactar a Addi para esta tienda');
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Ítems de la venta para el payload de Addi (sku desde `code`, precio unitario entero). */
  private async loadSaleItems(
    saleId: number,
    tenantId: string
  ): Promise<Array<{ sku: string; name: string; quantity: number; price: number }>> {
    const result = await this.database.query<{
      product_id: number | null;
      code: string | null;
      name: string | null;
      quantity: string | number;
      unit_price: string;
    }>(
      `SELECT si.product_id, p.code, p.name, si.quantity, si.unit_price::text AS unit_price
       FROM public.tec_sale_items si
       LEFT JOIN public.tec_products p ON p.id = si.product_id
       WHERE si.sale_id = $1 AND si.tenant_id = $2
       ORDER BY si.id ASC`,
      [saleId, tenantId]
    );
    return result.rows.map((row) => ({
      sku: readString(row.code) ?? `PROD-${row.product_id ?? 0}`,
      name: readString(row.name) ?? 'Producto',
      quantity: Math.max(1, Math.round(Number(row.quantity) || 1)),
      price: Math.round(Number(row.unit_price) || 0)
    }));
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
      // v0.3.80: Auth0 espera form-urlencoded en /oauth/token. El debug registra la
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
