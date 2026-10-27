import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PosCustomer } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { maskSecret, readAmount } from './addi.service';
import {
  PAYMENT_NOT_CONFIGURED_MESSAGE,
  providerCredentials,
  TenantPaymentSettingsService
} from './tenant-payment-settings.service';

const DEFAULT_API_BASE = 'https://api.sistecredito.com';
const DEFAULT_ORIGIN = 'Production';
const DEFAULT_AUDIENCE_URL = 'https://pos.tienderu.com';
/**
 * Endpoints oficiales (plugin WooCommerce `sistecredito` v1.13.0,
 * `GatewayActions::ENDPOINTS` — confirmados contra la instalación de producción):
 *  · Staging: https://api-co-stg.sistecreditocloud.com + SCOrigen=Staging
 *  · Qa:      https://api-co-nop-internal.sistecreditocloud.com + SCOrigen=Qa
 */
const CREATE_TRANSACTION_PATH = '/Spay/PasCheckout/checkout/create/transaction/sistecredito';
const GET_INFO_CREDIT_PATH = '/Spay/PasCheckout/checkout/getInfoCredit?transactionId=';
const REQUEST_TIMEOUT_MS = 12000;
const DOCUMENT_TYPE_RE = /^(CC|CE)$/;
const DOCUMENT_NUMBER_RE = /^[0-9]+$/;

export const SISTECREDITO_ACK_FUNCTION = '/api/webhooks/sistecredito';

export const SISTECREDITO_DOCUMENT_REQUIRED_MESSAGE =
  'Agrega tu cédula (CC) en tu perfil para pagar con Sistecrédito.';
export const SISTECREDITO_CREDIT_IN_PROGRESS_MESSAGE =
  'Ya hay una solicitud de crédito en proceso con Sistecrédito. Intenta de nuevo en unos minutos.';
export const SISTECREDITO_GENERIC_ERROR_MESSAGE =
  'Ocurrió un error al momento de procesar la transacción. Intenta de nuevo o elige otro medio de pago.';
export const SISTECREDITO_NOT_CONFIGURED_SERVER_MESSAGE =
  'Sistecrédito no está disponible por ahora. Elige otro medio de pago.';

/** Catálogo oficial de errores públicos (GatewayActions::ERRORS del plugin v1.13.0). */
export const SISTECREDITO_PUBLIC_ERRORS: Record<string, string> = {
  '801': SISTECREDITO_CREDIT_IN_PROGRESS_MESSAGE,
  '802': 'El valor de tu compra es menor al mínimo permitido para un crédito con Sistecrédito.',
  '805': 'El número de documento no es válido para Sistecrédito. Revisa tu cédula en el perfil.',
  '806': 'El tipo de documento no es válido para Sistecrédito.',
  '813': 'El valor de la compra no es válido para Sistecrédito.',
  '814': SISTECREDITO_NOT_CONFIGURED_SERVER_MESSAGE,
  '815': SISTECREDITO_NOT_CONFIGURED_SERVER_MESSAGE,
  '816': SISTECREDITO_NOT_CONFIGURED_SERVER_MESSAGE,
  '817': SISTECREDITO_NOT_CONFIGURED_SERVER_MESSAGE,
  '818': SISTECREDITO_NOT_CONFIGURED_SERVER_MESSAGE,
  '819': SISTECREDITO_NOT_CONFIGURED_SERVER_MESSAGE,
  '826': 'El valor aprobado no coincide con el total del pedido.'
};

export function mapSistecreditoError(errorCode: string | null): string {
  if (errorCode !== null && Object.prototype.hasOwnProperty.call(SISTECREDITO_PUBLIC_ERRORS, errorCode)) {
    return SISTECREDITO_PUBLIC_ERRORS[errorCode];
  }
  return SISTECREDITO_GENERIC_ERROR_MESSAGE;
}

function formatThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Mensaje público detallado (v0.12.7, certificación productiva): además del catálogo
 * 800–827 traduce el rechazo real de producción `NotValidTransactionValue`
 * ("Value cannot be less than <monto>") al mínimo vigente de la pasarela.
 */
export function mapSistecreditoErrorDetail(errorCode: string | null, apiMessage: string | null): string {
  if (errorCode !== null && Object.prototype.hasOwnProperty.call(SISTECREDITO_PUBLIC_ERRORS, errorCode)) {
    return SISTECREDITO_PUBLIC_ERRORS[errorCode];
  }
  const detail = (apiMessage ?? '').trim();
  if (/NotValidTransactionValue/i.test(detail)) {
    const match = /cannot be less than\s+(\d+(?:\.\d+)?)/i.exec(detail);
    if (match) {
      const minimum = Number(match[1]);
      if (Number.isFinite(minimum) && minimum > 0) {
        return `El mínimo para financiar con Sistecrédito es $${formatThousands(Math.round(minimum))}.`;
      }
    }
  }
  return SISTECREDITO_GENERIC_ERROR_MESSAGE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Monto en centavos para comparaciones exactas (ValueToPay vs grand_total). */
export function toCents(value: string | number | null | undefined): number | null {
  const text = typeof value === 'number' ? String(value) : readString(value ?? null);
  if (text === null) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

function base64Url(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Token de firma determinista por venta: HMAC-SHA256(secreto del servidor, `ORDER-<saleId>`).
 * Reemplaza el `uniqid` aleatorio del plugin (que persiste en BD) por un valor recomputable
 * en el webhook, sin DDL ni estado: mismo rol criptográfico (firmar el JWT del checkout y
 * verificar el JWT de la confirmación).
 */
export function buildSistecreditoToken(jwtSecret: string, saleId: number): string {
  return createHmac('sha256', jwtSecret).update(`ORDER-${saleId}`).digest('hex');
}

/**
 * JWT HS256 del checkout, contrato del plugin: payload `{iss, aud, iat, nbf: iat+30}` con
 * `iss`/`aud` = URL pública del comercio (el webhook valida `aud` al confirmar).
 */
export function buildSistecreditoJwt(token: string, audienceUrl: string, nowSeconds?: number): string {
  const iat = nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iss: audienceUrl, aud: audienceUrl, iat, nbf: iat + 30 }));
  const signature = base64Url(createHmac('sha256', token).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

/** Verifica firma HS256 (tiempo constante) y `aud` del JWT de la confirmación. */
export function verifySistecreditoJwt(jwt: string, token: string, audienceUrl: string): boolean {
  const parts = jwt.trim().split('.');
  if (parts.length !== 3 || parts.some((part) => part === '')) return false;
  const [header, payload, signature] = parts;
  const expected = createHmac('sha256', token).update(`${header}.${payload}`).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch (_error: unknown) {
    return false;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as Record<string, unknown>;
    return decoded.aud === audienceUrl;
  } catch (_error: unknown) {
    return false;
  }
}

/** Fecha ISO-8601 con offset local, mismo formato del plugin (`Y-m-d\TH:i:sP`). */
export function formatSistecreditoDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

export function normalizeSistecreditoDocumentType(value: string | null | undefined): 'CC' | 'CE' | null {
  const normalized = (value ?? '').trim().toUpperCase();
  return DOCUMENT_TYPE_RE.test(normalized) ? (normalized as 'CC' | 'CE') : null;
}

export function normalizeSistecreditoDocumentNumber(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim();
  return DOCUMENT_NUMBER_RE.test(normalized) ? normalized : null;
}

export type SistecreditoCreateInput = {
  saleId: number;
  amount: number;
  documentType: string;
  documentNumber: string;
  vendorId: string;
  storeId: string;
  responseUrl: string;
  transactionDate?: string;
};

/**
 * Body EXACTO del checkout (valores de referencia del plugin:
 * `getParamsPost` + `Helper::createJwtToken`). `valueToPaid` viaja numérico.
 */
export function buildSistecreditoCreatePayload(input: SistecreditoCreateInput): Record<string, unknown> {
  return {
    typeDocument: input.documentType,
    idDocument: input.documentNumber,
    transactionDate: input.transactionDate ?? formatSistecreditoDate(new Date()),
    valueToPaid: toCents(input.amount) === null ? 0 : (toCents(input.amount) ?? 0) / 100,
    vendorId: input.vendorId,
    storeId: input.storeId,
    orderId: input.saleId,
    responseUrl: input.responseUrl
  };
}

export type SistecreditoAck = {
  function: string;
  errorCode: number | null;
  message: string;
  country: 'co';
  data: {
    orderId: string | number | null;
    transactionId: string | null;
    status: 'VALID' | 'ERROR';
    errors: string[];
  };
};

/** Acuse HTTP 200 con el JSON que espera Sistecrédito (espejo de `confirm_payment()`). */
export function buildSistecreditoAck(input: {
  errorCode: number | null;
  message: string;
  orderId: string | number | null;
  transactionId: string | null;
  status: 'VALID' | 'ERROR';
  errors: string[];
}): SistecreditoAck {
  return {
    function: SISTECREDITO_ACK_FUNCTION,
    errorCode: input.errorCode,
    message: input.message,
    country: 'co',
    data: {
      orderId: input.orderId,
      transactionId: input.transactionId,
      status: input.status,
      errors: input.errors
    }
  };
}

export type SistecreditoTransactionInfo = {
  approved: boolean;
  creditNumber: string | null;
  valueToPaid: string | null;
};

/**
 * Sistecrédito para la tienda virtual (v0.12.6, contrato real capturado del plugin
 * WooCommerce v1.13.0): crea la transacción server-to-server con las credenciales DEL
 * TENANT (Vendor ID + Store ID + Subscription Key) y devuelve la URL de redirección
 * (`data.urlToRedirect?transactionId=...`). El JWT del checkout se firma con un token
 * determinista (HMAC del secreto + venta) para poder validar la confirmación del webhook
 * sin persistir estado.
 */
@Injectable()
export class SistecreditoService {
  private readonly logger = new Logger(SistecreditoService.name);
  private readonly apiBase: string;
  private readonly origin: string;
  private readonly jwtSecret: string;
  private readonly audienceUrl: string;
  private readonly callbackUrl: string;

  constructor(
    config: ConfigService,
    private readonly paymentSettings: TenantPaymentSettingsService,
    private readonly database: DatabaseService
  ) {
    this.apiBase = (config.get<string>('SISTECREDITO_API_BASE_URL') ?? DEFAULT_API_BASE).trim().replace(/\/+$/, '');
    this.origin = (config.get<string>('SISTECREDITO_ORIGIN') ?? DEFAULT_ORIGIN).trim();
    this.jwtSecret = (config.get<string>('SISTECREDITO_JWT_SECRET') ?? '').trim();
    this.audienceUrl = (
      config.get<string>('SISTECREDITO_AUDIENCE_URL')
      ?? config.get<string>('PUBLIC_API_URL')
      ?? DEFAULT_AUDIENCE_URL
    ).trim().replace(/\/+$/, '');
    this.callbackUrl = (
      config.get<string>('SISTECREDITO_CALLBACK_URL') ?? `${this.audienceUrl}/api/webhooks/sistecredito`
    ).trim();
    if (this.jwtSecret === '') {
      this.logger.warn(
        'SISTECREDITO_JWT_SECRET vacío: los checkouts de Sistecrédito fallarán cerrados. ' +
        'Genera el secreto (openssl rand -hex 32) y reinicia el API.'
      );
    }
    if (!config.get('SISTECREDITO_API_BASE_URL')) {
      this.logger.warn(
        `Sistecrédito usando API de PRODUCCIÓN por defecto (${DEFAULT_API_BASE}). ` +
        'Para certificar define SISTECREDITO_API_BASE_URL (https://api-co-stg.sistecreditocloud.com) ' +
        'y SISTECREDITO_ORIGIN=Staging.'
      );
    }
  }

  /** true cuando el servidor tiene el secreto para firmar/validar JWT. */
  isServerConfigured(): boolean {
    return this.jwtSecret !== '';
  }

  /** Valida el JWT de una confirmación contra el token determinista de la venta. */
  verifyConfirmationJwt(saleId: number, authentication: string): boolean {
    if (this.jwtSecret === '') return false;
    const jwt = readString(authentication);
    if (jwt === null) return false;
    return verifySistecreditoJwt(jwt, buildSistecreditoToken(this.jwtSecret, saleId), this.audienceUrl);
  }

  async createCheckoutLink(input: {
    tenantId: string;
    saleId: number;
    amount: number;
    customer: PosCustomer;
  }): Promise<string> {
    const credentials = await this.requireCredentials(input.tenantId);
    if (this.jwtSecret === '') {
      throw new BadRequestException(SISTECREDITO_NOT_CONFIGURED_SERVER_MESSAGE);
    }

    // Sistecrédito exige el documento del comprador (CC/CE), igual que Addi en producción.
    const document = await this.loadCustomerDocument(input.customer.id);
    const documentType = normalizeSistecreditoDocumentType(document?.documentType);
    const documentNumber = normalizeSistecreditoDocumentNumber(document?.documentNumber);
    if (documentType === null || documentNumber === null) {
      throw new BadRequestException(SISTECREDITO_DOCUMENT_REQUIRED_MESSAGE);
    }

    const token = buildSistecreditoToken(this.jwtSecret, input.saleId);
    const authentication = buildSistecreditoJwt(token, this.audienceUrl);
    const body = buildSistecreditoCreatePayload({
      saleId: input.saleId,
      amount: input.amount,
      documentType,
      documentNumber,
      vendorId: credentials.vendorId,
      storeId: credentials.storeId,
      responseUrl: this.callbackUrl
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      this.logger.debug(
        `Sistecrédito create request: POST ${this.apiBase}${CREATE_TRANSACTION_PATH} ` +
        `body=${JSON.stringify(body)} | headers: Ocp-Apim-Subscription-Key=${maskSecret(credentials.apiKey)}, ` +
        `SCLocation=0,0, country=co, SCOrigen=${this.origin}, Authentication=<JWT len=${authentication.length}>`
      );
      const response = await fetch(`${this.apiBase}${CREATE_TRANSACTION_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': credentials.apiKey,
          SCLocation: '0,0',
          country: 'co',
          SCOrigen: this.origin,
          Authentication: authentication
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (_error: unknown) {
        parsed = null;
      }

      const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : null;
      const redirectUrl = data
        ? readString(data.urlToRedirect) ?? readString(data.urlRedirect)
        : null;
      const transactionId = data ? readString(data.transactionId) ?? readString(data.transactionID) : null;
      if (response.ok && redirectUrl !== null && transactionId !== null) {
        this.logger.log(
          `Sistecrédito transacción creada tenant=${input.tenantId} sale=${input.saleId} ` +
          `transactionId=${transactionId}`
        );
        return `${redirectUrl}?transactionId=${encodeURIComponent(transactionId)}`;
      }

      const errorCode = isRecord(parsed)
        ? readString(parsed.errorCode) ?? (typeof parsed.errorCode === 'number' ? String(parsed.errorCode) : null)
        : null;
      const apiMessage = isRecord(parsed) ? readString(parsed.message) : null;
      this.logger.error(
        `Sistecrédito POST create-transaction -> ${response.status} sale=${input.saleId} ` +
        `errorCode=${errorCode ?? 'n/a'}: ${text.slice(0, 600)}`
      );
      const publicMessage = mapSistecreditoErrorDetail(errorCode, apiMessage);
      // El código se anexa solo cuando el mensaje es genérico (ayuda a soporte);
      // los mensajes traducidos del catálogo/mínimo ya son claros para el comprador.
      const codeSuffix =
        publicMessage === SISTECREDITO_GENERIC_ERROR_MESSAGE && errorCode !== null ? ` (código ${errorCode})` : '';
      throw new BadRequestException(`${publicMessage}${codeSuffix}`);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(
        `Sistecrédito create-transaction failed sale=${input.saleId}: ` +
        `${error instanceof Error ? error.message : 'unknown'}`
      );
      throw new BadRequestException('No se pudo contactar a Sistecrédito para esta tienda');
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Consulta el estado real de una transacción (`getInfoCredit`): usado al volver el
   * usuario del checkout como respaldo del webhook. `transactionStatus === 3` = aprobada.
   */
  async verifyTransaction(tenantId: string, transactionId: string): Promise<SistecreditoTransactionInfo | null> {
    const credentials = await this.requireCredentials(tenantId);
    const url = `${this.apiBase}${GET_INFO_CREDIT_PATH}${encodeURIComponent(transactionId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': credentials.apiKey,
          SCLocation: '0,0',
          country: 'co',
          SCOrigen: this.origin
        },
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        this.logger.warn(`Sistecrédito getInfoCredit -> ${response.status}: ${text.slice(0, 300)}`);
        return null;
      }
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (_error: unknown) {
        return null;
      }
      const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : null;
      if (data === null) return null;
      const approved = data.transactionStatus === 3 || data.transactionStatus === '3';
      const credit = isRecord(data.credit) ? data.credit : null;
      const creditNumberRaw = credit ? credit.creditNumber : null;
      const creditNumber = typeof creditNumberRaw === 'number'
        ? String(creditNumberRaw)
        : readString(creditNumberRaw);
      return {
        approved,
        creditNumber,
        valueToPaid: readAmount(data.valueToPaid)
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Sistecrédito getInfoCredit failed transactionId=${transactionId}: ` +
        `${error instanceof Error ? error.message : 'unknown'}`
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Credenciales DEL TENANT (fail-closed): enabled + Subscription Key + Vendor ID + Store ID. */
  private async requireCredentials(
    tenantId: string
  ): Promise<{ apiKey: string; vendorId: string; storeId: string }> {
    const settings = await this.paymentSettings.getForTenant(tenantId);
    const credentials = settings ? providerCredentials(settings, 'sistecredito') : null;
    if (
      !credentials
      || !credentials.enabled
      || !credentials.apiKey
      || !settings?.sistecreditoVendorId
      || !settings?.sistecreditoStoreId
    ) {
      throw new BadRequestException(PAYMENT_NOT_CONFIGURED_MESSAGE);
    }
    return { apiKey: credentials.apiKey, vendorId: settings.sistecreditoVendorId, storeId: settings.sistecreditoStoreId };
  }

  /** Documento del cliente para el crédito (tec_customers.document_type/document_number, v0.12.5). */
  private async loadCustomerDocument(
    customerId: number
  ): Promise<{ documentType: string | null; documentNumber: string | null } | null> {
    try {
      const result = await this.database.query<{ document_type: string | null; document_number: string | null }>(
        `SELECT document_type, document_number
         FROM public.tec_customers
         WHERE id = $1
         LIMIT 1`,
        [customerId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return { documentType: row.document_type, documentNumber: row.document_number };
    } catch (_error: unknown) {
      // La columna puede no existir antes de la migración v0.12.5.
      return null;
    }
  }
}
