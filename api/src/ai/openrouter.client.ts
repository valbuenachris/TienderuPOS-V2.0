import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OpenRouterToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface OpenRouterMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
}

export interface OpenRouterCompletion {
  message: OpenRouterMessage;
  finishReason: string | null;
  model: string;
  usage: unknown;
}

const PLACEHOLDER_KEYS = new Set(['CHANGE_ME', 'your-key', 'your_openrouter_key']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Cliente HTTP para la API OpenAI-compatible de OpenRouter (la key vive solo en el .env). */
@Injectable()
export class OpenRouterClient {
  private readonly logger = new Logger(OpenRouterClient.name);
  private readonly baseUrl: string;
  private readonly appUrl: string | null;
  private readonly appTitle: string | null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (config.get<string>('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1').trim().replace(/\/+$/, '');
    this.appUrl = config.get<string>('OPENROUTER_APP_URL')?.trim() || null;
    this.appTitle = config.get<string>('OPENROUTER_APP_TITLE')?.trim() || null;
  }

  apiKey(): string | null {
    const key = this.config.get<string>('OPENROUTER_API_KEY')?.trim() ?? '';
    if (key === '' || PLACEHOLDER_KEYS.has(key)) return null;
    return key;
  }

  isConfigured(): boolean {
    return this.apiKey() !== null;
  }

  defaultModel(): string {
    return this.config.get<string>('OPENROUTER_MODEL')?.trim() || 'openai/gpt-oss-20b';
  }

  /** Fallback automático vía el parámetro `models` de OpenRouter (si el primario falla). */
  fallbackModel(): string | null {
    const fallback =
      this.config.get<string>('OPENROUTER_MODEL_FALLBACK')?.trim() || 'deepseek/deepseek-v4.1-flash-1017';
    return fallback === '' ? null : fallback;
  }

  async createChatCompletion(input: {
    key: string;
    model: string;
    fallbackModel?: string | null;
    messages: unknown[];
    tools?: unknown[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<OpenRouterCompletion> {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 800
    };
    if (input.fallbackModel && input.fallbackModel !== input.model) {
      // Failover automático de OpenRouter: primario (`model`) y luego la lista en orden.
      body.models = [input.fallbackModel];
    }
    if (input.tools && input.tools.length > 0) body.tools = input.tools;

    const parsed = await this.request(input.key, 'POST', '/chat/completions', body, input.model);
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const first = isRecord(choices[0]) ? choices[0] : null;
    const message = first && isRecord(first.message) ? first.message : null;
    if (!message) throw new BadRequestException('OpenRouter devolvió una respuesta sin mensaje');

    return {
      message: {
        role: typeof message.role === 'string' ? message.role : 'assistant',
        content: typeof message.content === 'string' ? message.content : null,
        tool_calls: Array.isArray(message.tool_calls)
          ? (message.tool_calls as OpenRouterToolCall[])
          : undefined
      },
      finishReason: first && typeof first.finish_reason === 'string' ? first.finish_reason : null,
      model: typeof parsed.model === 'string' ? parsed.model : input.model,
      usage: parsed.usage
    };
  }

  /** Devuelve los ids del catálogo o null si no se pudo consultar (público, sin key). */
  async listModelIds(key: string): Promise<string[] | null> {
    try {
      const parsed = await this.request(key, 'GET', '/models', undefined, 'models');
      const data = Array.isArray(parsed.data) ? parsed.data : [];
      return data
        .filter(isRecord)
        .map((model) => (typeof model.id === 'string' ? model.id : ''))
        .filter((id) => id !== '');
    } catch (_error: unknown) {
      return null;
    }
  }

  private async request(
    key: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    label?: string
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.appUrl ? { 'HTTP-Referer': this.appUrl } : {}),
          ...(this.appTitle ? { 'X-OpenRouter-Title': this.appTitle } : {})
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
        // Nunca se loggea la key; solo estado y cuerpo recortado.
        this.logger.error(`OpenRouter ${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
        if (response.status === 401 || response.status === 403) {
          throw new BadRequestException('La API key de OpenRouter es inválida o sin permisos (revisa OPENROUTER_API_KEY).');
        }
        if (response.status === 402) {
          throw new BadRequestException('OpenRouter rechazó la petición por falta de crédito.');
        }
        if (response.status === 429) {
          throw new BadRequestException('OpenRouter está limitando las peticiones (429). Intenta en unos segundos.');
        }
        throw new BadRequestException(`OpenRouter respondió ${response.status}${label ? ` (${label})` : ''}.`);
      }
      if (!isRecord(parsed)) throw new BadRequestException('OpenRouter devolvió una respuesta inválida');
      return parsed;
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`OpenRouter ${method} ${path} failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new ServiceUnavailableException('No se pudo contactar a OpenRouter. Intenta de nuevo.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
