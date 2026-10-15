import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface BoldLinkStatus {
  id: string | null;
  status: string | null;
  transactionId: string | null;
  reference: string | null;
}

export interface BoldWebhookEvent {
  id?: string;
  type?: string;
  subject?: string;
  data?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// Misma heurística que el proyecto de referencia (educolEditores): sin regex.
function isPlaceholderKey(value: string): boolean {
  const key = value.trim();
  return key.length <= 10 || key === 'change_me' || key.includes('tu_api_key');
}

const DEFAULT_PAYMENT_METHODS = ['CREDIT_CARD', 'PSE', 'BOTON_BANCOLOMBIA', 'NEQUI'];

@Injectable()
export class BoldService {
  private readonly logger = new Logger(BoldService.name);
  private readonly enabled: boolean;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly sandbox: boolean;
  private readonly apiBase: string;
  private readonly callbackUrl: string;
  private readonly expirationMinutes: number;
  private readonly paymentMethods: string[];

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('BOLD_API_KEY')?.trim() ?? '';
    // Bold firma los webhooks con la LLAVE DE IDENTIDAD (BOLD_API_KEY), no un secreto aparte.
    const explicitSecret = config.get<string>('BOLD_WEBHOOK_SECRET')?.trim() ?? '';
    this.apiBase = (
      config.get<string>('BOLD_LINKS_BASE_URL')
      ?? config.get<string>('BOLD_API_BASE')
      ?? 'https://integrations.api.bold.co'
    ).replace(/\/+$/, '');
    this.sandbox = config.get<string>('BOLD_SANDBOX') === 'true' || this.apiBase.includes('sandbox');
    this.webhookSecret = explicitSecret !== '' ? explicitSecret : this.apiKey;
    this.callbackUrl = config.get<string>('BOLD_CALLBACK_URL') ?? 'https://pos.tienderu.com/config?payment=return';
    this.expirationMinutes = Number(config.get('BOLD_LINK_EXPIRATION_MINUTES') ?? 30);
    const configuredMethods = (config.get<string>('BOLD_PAYMENT_METHODS') ?? '')
      .split(',')
      .map((method) => method.trim())
      .filter(Boolean);
    this.paymentMethods = configuredMethods.length > 0 ? configuredMethods : DEFAULT_PAYMENT_METHODS;

    const placeholder = isPlaceholderKey(this.apiKey);
    this.enabled = config.get<string>('BOLD_ENABLED') !== 'false' && !placeholder;
    if (!this.enabled) {
      this.logger.warn(
        placeholder
          ? 'BOLD_API_KEY vacía o placeholder; Bold deshabilitado (usa la llave real de integración)'
          : 'Bold deshabilitado (BOLD_ENABLED=false)'
      );
    } else if (this.sandbox) {
      this.logger.log('Bold en modo sandbox (firma con secreto vacío)');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async createPaymentLink(input: {
    amount: number;
    description: string;
    reference: string;
    payerEmail?: string | null;
    callbackUrl?: string | null;
  }): Promise<{ paymentLink: string; url: string }> {
    if (!this.enabled) throw new ServiceUnavailableException('Bold no está configurado (revisa BOLD_API_KEY)');
    const body: Record<string, unknown> = {
      amount_type: 'CLOSE',
      amount: { currency: 'COP', total_amount: Math.round(input.amount), tip_amount: 0 },
      reference: input.reference.slice(0, 60),
      description: input.description.slice(0, 100),
      expiration_date: (Date.now() + Math.max(5, this.expirationMinutes) * 60 * 1000) * 1e6,
      callback_url: input.callbackUrl ?? this.callbackUrl,
      payment_methods: this.paymentMethods
    };
    if (input.payerEmail) body.payer_email = input.payerEmail;

    const response = await this.request('POST', '/online/link/v1', body);
    const payload = isRecord(response.payload) ? response.payload : null;
    const paymentLink = readString(payload?.payment_link);
    const url = readString(payload?.url);
    if (!paymentLink || !url) {
      this.logger.error('Bold devolvió una respuesta sin payment_link/url');
      throw new ServiceUnavailableException('Respuesta inválida de Bold');
    }
    return { paymentLink, url };
  }

  async getPaymentLinkStatus(paymentLink: string): Promise<BoldLinkStatus> {
    if (!this.enabled) throw new ServiceUnavailableException('Bold no está configurado (revisa BOLD_API_KEY)');
    const response = await this.request('GET', `/online/link/v1/${encodeURIComponent(paymentLink)}`);
    const payload = isRecord(response.payload) ? response.payload : response;
    return {
      id: readString(payload.id),
      status: readString(payload.status),
      transactionId: readString(payload.transaction_id),
      reference: readString(payload.reference)
    };
  }

  verifySignature(rawBody: Buffer | string, signature?: string): boolean {
    if (!signature) return false;
    // En sandbox Bold firma con secreto vacío; fuera de sandbox exigimos llave (fail-closed).
    if (this.webhookSecret === '' && !this.sandbox) {
      this.logger.error('Webhook Bold sin secreto de firma configurado (fail-closed)');
      return false;
    }
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const encoded = Buffer.from(body, 'utf8').toString('base64');
    const hashed = createHmac('sha256', this.webhookSecret).update(encoded).digest('hex');
    const expected = Buffer.from(hashed, 'utf8');
    const received = Buffer.from(signature.trim(), 'utf8');
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private async request(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${this.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `x-api-key ${this.apiKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (_error: unknown) {
        parsed = null;
      }
      if (!response.ok) {
        this.logger.error(`Bold ${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
        throw new ServiceUnavailableException(`Bold respondió ${response.status}`);
      }
      if (!isRecord(parsed)) throw new ServiceUnavailableException('Respuesta inválida de Bold');
      const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
      if (errors.length > 0) {
        const detail = errors
          .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join(' · ')
          .slice(0, 300);
        this.logger.error(`Bold ${method} ${path} errors: ${detail}`);
        throw new BadRequestException(`Bold rechazó la solicitud: ${detail}`);
      }
      return parsed;
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) throw error;
      this.logger.error(`Bold ${method} ${path} failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new ServiceUnavailableException('No se pudo contactar a Bold');
    } finally {
      clearTimeout(timeout);
    }
  }
}
