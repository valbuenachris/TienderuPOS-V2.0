import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Evolution devuelve el QR en distintas formas según versión/endpoint. */
function extractQr(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const candidates: unknown[] = [
    data.base64,
    isRecord(data.qrcode) ? data.qrcode.base64 : null,
    isRecord(data.qr) ? data.qr.base64 : null
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return null;
}

function extractState(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const instance = isRecord(data.instance) ? data.instance : null;
  const candidates: unknown[] = [
    instance?.state,
    instance?.status,
    data.state,
    data.status
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim().toLowerCase();
  }
  return null;
}

export interface EvolutionCreateResult {
  alreadyExists: boolean;
  instanceName: string;
  state: string | null;
  qr: string | null;
}

type RequestResult = { status: number; data: Record<string, unknown> | null; text: string };

/** Cliente HTTP para Evolution API (v2). La key vive solo en el .env del API. */
@Injectable()
export class EvolutionClient {
  private readonly logger = new Logger(EvolutionClient.name);
  private readonly config: ConfigService;
  private readonly baseUrl: string | null;

  constructor(config: ConfigService) {
    this.config = config;
    const url = config.get<string>('EVOLUTION_API_URL')?.trim() ?? '';
    this.baseUrl = url === '' || url.includes('your-evolution') ? null : url.replace(/\/+$/, '');
  }

  private apiKey(): string | null {
    const key = this.config.get<string>('EVOLUTION_API_KEY')?.trim() ?? '';
    if (key === '' || key === 'change_me') return null;
    return key;
  }

  isConfigured(): boolean {
    return this.baseUrl !== null && this.apiKey() !== null;
  }

  private requireConfig(): { url: string; key: string } {
    const key = this.apiKey();
    if (this.baseUrl === null || key === null) {
      throw new BadRequestException(
        'El servidor de WhatsApp (Evolution) no está configurado: define EVOLUTION_API_URL y EVOLUTION_API_KEY en el .env.'
      );
    }
    return { url: this.baseUrl, key };
  }

  async createInstance(instanceName: string): Promise<EvolutionCreateResult> {
    const { key } = this.requireConfig();
    const result = await this.request(key, 'POST', '/instance/create', {
      instanceName,
      token: key,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS'
    });
    if (result.status >= 400) {
      const lowered = result.text.toLowerCase();
      if (
        result.status === 409 ||
        lowered.includes('already') ||
        lowered.includes('in use') ||
        lowered.includes('exists')
      ) {
        // La instancia ya existe en Evolution (reintento o recreación de la fila): continuar.
        return { alreadyExists: true, instanceName, state: null, qr: null };
      }
      this.logger.error(`Evolution create -> ${result.status}: ${result.text.slice(0, 200)}`);
      throw new BadRequestException(`Evolution respondió ${result.status} al crear la instancia.`);
    }
    return {
      alreadyExists: false,
      instanceName,
      state: extractState(result.data),
      qr: extractQr(result.data)
    };
  }

  async connect(instanceName: string): Promise<{ state: string | null; qr: string | null }> {
    const { key } = this.requireConfig();
    const result = await this.request(key, 'GET', `/instance/connect/${encodeURIComponent(instanceName)}`);
    if (result.status === 404) {
      throw new BadRequestException('La instancia no existe en Evolution; créala primero.');
    }
    if (result.status >= 400) {
      this.logger.error(`Evolution connect -> ${result.status}: ${result.text.slice(0, 200)}`);
      throw new BadRequestException(`Evolution respondió ${result.status} al conectar la instancia.`);
    }
    return { state: extractState(result.data), qr: extractQr(result.data) };
  }

  /** Estado de conexión o null si la instancia no existe en Evolution. */
  async connectionState(instanceName: string): Promise<string | null> {
    const { key } = this.requireConfig();
    const result = await this.request(key, 'GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    if (result.status === 404) return null;
    if (result.status >= 400) {
      this.logger.error(`Evolution state -> ${result.status}: ${result.text.slice(0, 200)}`);
      throw new BadRequestException(`Evolution respondió ${result.status} al consultar el estado.`);
    }
    return extractState(result.data);
  }

  /** Desconecta (logout) conservando la instancia para poder reconectar. */
  async logout(instanceName: string): Promise<void> {
    const { key } = this.requireConfig();
    const result = await this.request(key, 'DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`);
    if (result.status === 404) {
      throw new BadRequestException('La instancia no existe en Evolution.');
    }
    if (result.status >= 400) {
      this.logger.error(`Evolution logout -> ${result.status}: ${result.text.slice(0, 200)}`);
      throw new BadRequestException(`Evolution respondió ${result.status} al desconectar.`);
    }
  }

  /** Envía un mensaje de texto por la instancia (usado por el bot de ventas). */
  async sendText(instanceName: string, number: string, text: string): Promise<void> {
    const { key } = this.requireConfig();
    const result = await this.request(key, 'POST', `/message/sendText/${encodeURIComponent(instanceName)}`, {
      number,
      text
    });
    if (result.status >= 400) {
      this.logger.error(`Evolution sendText -> ${result.status}: ${result.text.slice(0, 200)}`);
      throw new BadRequestException(`Evolution respondió ${result.status} al enviar el mensaje.`);
    }
  }

  /** Registra/actualiza el webhook de la instancia (al activar el bot de ventas). */
  async setWebhook(instanceName: string, url: string): Promise<void> {
    const { key } = this.requireConfig();
    const result = await this.request(key, 'POST', `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: {
        enabled: true,
        url,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE']
      }
    });
    if (result.status >= 400) {
      this.logger.error(`Evolution webhook/set -> ${result.status}: ${result.text.slice(0, 200)}`);
      throw new BadRequestException(`Evolution respondió ${result.status} al registrar el webhook.`);
    }
  }

  private async request(
    key: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<RequestResult> {
    const url = this.baseUrl;
    if (url === null) {
      throw new BadRequestException('El servidor de WhatsApp (Evolution) no está configurado.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(`${url}${path}`, {
        method,
        // La key de Evolution viaja en `apikey`; nunca se loggea.
        headers: { apikey: key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
      return { status: response.status, data: isRecord(parsed) ? parsed : null, text };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Evolution ${method} ${path} failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new ServiceUnavailableException('No se pudo contactar al servidor de WhatsApp (Evolution). Intenta de nuevo.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
