import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const DEFAULT_PAYMENT_METHODS = ['CREDIT_CARD', 'PSE', 'BOTON_BANCOLOMBIA', 'NEQUI'];

/**
 * Bold para la tienda virtual de cada tenant: usa la llave de identidad del
 * tenant (tec_tenant_payment_settings) en vez del .env del SaaS.
 * El billing de la plataforma (api/src/billing) sigue con sus propias llaves.
 */
@Injectable()
export class TenantBoldService {
  private readonly logger = new Logger(TenantBoldService.name);
  private readonly apiBase: string;
  private readonly expirationMinutes: number;
  private readonly paymentMethods: string[];

  constructor(config: ConfigService) {
    this.apiBase = (
      config.get<string>('BOLD_LINKS_BASE_URL')
      ?? config.get<string>('BOLD_API_BASE')
      ?? 'https://integrations.api.bold.co'
    ).replace(/\/+$/, '');
    this.expirationMinutes = Number(config.get('BOLD_LINK_EXPIRATION_MINUTES') ?? 30);
    const configured = (config.get<string>('BOLD_PAYMENT_METHODS') ?? '')
      .split(',')
      .map((method) => method.trim())
      .filter(Boolean);
    this.paymentMethods = configured.length > 0 ? configured : DEFAULT_PAYMENT_METHODS;
  }

  async createLink(input: {
    apiKey: string;
    amount: number;
    description: string;
    reference: string;
    payerEmail?: string | null;
    callbackUrl?: string | null;
  }): Promise<{ paymentLink: string; url: string }> {
    const body: Record<string, unknown> = {
      amount_type: 'CLOSE',
      amount: { currency: 'COP', total_amount: Math.round(input.amount), tip_amount: 0 },
      reference: input.reference.slice(0, 60),
      description: input.description.slice(0, 100),
      expiration_date: (Date.now() + Math.max(5, this.expirationMinutes) * 60 * 1000) * 1e6,
      payment_methods: this.paymentMethods
    };
    if (input.callbackUrl) body.callback_url = input.callbackUrl;
    if (input.payerEmail) body.payer_email = input.payerEmail;

    const response = await this.request(input.apiKey, 'POST', '/online/link/v1', body);
    const payload = isRecord(response.payload) ? response.payload : null;
    const paymentLink = readString(payload?.payment_link);
    const url = readString(payload?.url);
    if (!paymentLink || !url) {
      this.logger.error('Bold (tenant) devolvió una respuesta sin payment_link/url');
      throw new BadRequestException('Bold no pudo crear el link de pago de esta tienda');
    }
    return { paymentLink, url };
  }

  verifySignature(rawBody: Buffer | string, signature: string | undefined, secret: string): boolean {
    if (!signature) return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const encoded = Buffer.from(body, 'utf8').toString('base64');
    const hashed = createHmac('sha256', secret).update(encoded).digest('hex');
    const expected = Buffer.from(hashed, 'utf8');
    const received = Buffer.from(signature.trim(), 'utf8');
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private async request(
    apiKey: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${this.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `x-api-key ${apiKey}`,
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
        this.logger.error(`Bold (tenant) ${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
        throw new BadRequestException(`Bold respondió ${response.status} al crear el pago`);
      }
      if (!isRecord(parsed)) throw new BadRequestException('Respuesta inválida de Bold');
      const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
      if (errors.length > 0) {
        const detail = errors
          .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join(' · ')
          .slice(0, 300);
        this.logger.error(`Bold (tenant) ${method} ${path} errors: ${detail}`);
        throw new BadRequestException(`Bold rechazó el pago: ${detail}`);
      }
      return parsed;
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Bold (tenant) ${method} ${path} failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new BadRequestException('No se pudo contactar a Bold para esta tienda');
    } finally {
      clearTimeout(timeout);
    }
  }
}
