import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PosUser } from '../auth/auth.types';
import { todayInTimeZone } from '../common/timezone';
import { TenantTimezoneService } from '../common/tenant-timezone.service';
import { DatabaseService } from '../database/database.service';
import { AiChatDto, UpdateAiSettingsDto } from './ai.dto';
import { AI_TOOL_DEFINITIONS, AiToolsService } from './ai.tools';
import { OpenRouterClient } from './openrouter.client';
import { TenantAiSettingsService } from './tenant-ai-settings.service';

const MAX_TOOL_ITERATIONS = 5;

/** Lista curada (modelos con soporte de tools); se cruza con el catálogo real de OpenRouter. */
const CANDIDATE_MODELS: Array<{ id: string; label: string }> = [
  { id: 'openai/gpt-oss-20b', label: 'OpenAI GPT OSS 20B (por defecto)' },
  { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek v4.1 Flash (fallback)' },
  { id: '~openai/gpt-sol-latest', label: 'OpenAI GPT (alias latest)' },
  { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o mini' },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Anthropic Claude Sonnet 4.5' },
  { id: 'google/gemini-2.5-flash', label: 'Google Gemini 2.5 Flash' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Meta Llama 3.3 70B' }
];

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly busyUsers = new Set<number>();
  private readonly dailyUsage = new Map<string, { day: string; count: number }>();

  constructor(
    private readonly client: OpenRouterClient,
    private readonly tools: AiToolsService,
    private readonly settings: TenantAiSettingsService,
    private readonly database: DatabaseService,
    private readonly timezone: TenantTimezoneService,
    private readonly config: ConfigService
  ) {}

  async settingsView(tenantId: string) {
    const row = await this.settings.getForTenant(tenantId);
    return {
      enabled: row?.enabled ?? true,
      model: row?.model ?? null,
      default_model: this.client.defaultModel(),
      has_api_key: this.client.isConfigured(),
      key_hint: this.keyHint(),
      source: row?.model ? 'tenant' : 'platform',
      table_ready: await this.settings.isReady()
    };
  }

  async updateSettings(tenantId: string, input: UpdateAiSettingsDto) {
    await this.settings.update(tenantId, input);
    return this.settingsView(tenantId);
  }

  async models() {
    const key = this.client.apiKey();
    if (key) {
      const ids = await this.client.listModelIds(key);
      if (ids !== null) {
        const available = new Set(ids);
        const present = CANDIDATE_MODELS.filter((model) => available.has(model.id));
        if (present.length > 0) return { models: present, source: 'openrouter' as const };
      }
    }
    return { models: CANDIDATE_MODELS, source: 'curated' as const };
  }

  async chat(tenantId: string, user: PosUser, dto: AiChatDto) {
    const key = this.client.apiKey();
    if (!key) {
      throw new BadRequestException(
        'El Asistente IA no está disponible: falta OPENROUTER_API_KEY en el servidor (.env).'
      );
    }
    this.enforceDailyLimit(tenantId);
    if (this.busyUsers.has(user.id)) {
      throw new BadRequestException('Ya hay una consulta del asistente en curso; espera la respuesta.');
    }
    this.busyUsers.add(user.id);
    try {
      // v0.4.2: el modelo lo administra la plataforma desde el .env (sin UI por tenant).
      const model = this.client.defaultModel();
      const fallbackModel = this.client.fallbackModel();
      const messages = await this.buildMessages(tenantId, dto);

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        const completion = await this.client.createChatCompletion({
          key,
          model,
          fallbackModel,
          messages,
          tools: AI_TOOL_DEFINITIONS
        });
        const toolCalls = completion.message.tool_calls ?? [];

        if (toolCalls.length === 0) {
          const reply = completion.message.content?.trim() ?? '';
          if (!reply) break;
          this.logger.log(`AI chat tenant=${tenantId} user=${user.id} model=${completion.model}`);
          return { reply, model: completion.model, tools_used: iteration };
        }

        messages.push({
          role: 'assistant',
          content: completion.message.content ?? '',
          tool_calls: toolCalls
        });
        // v0.4.3: herramientas en paralelo (menos latencia).
        const results = await Promise.all(
          toolCalls.map(async (call) => ({
            call,
            result: await this.tools.execute(tenantId, call.function?.name ?? '', call.function?.arguments ?? '')
          }))
        );
        for (const { call, result } of results) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result ?? null).slice(0, 12000)
          });
        }
      }

      // Iteraciones agotadas o respuesta vacía: última llamada sin herramientas para forzar texto.
      const finalCompletion = await this.client.createChatCompletion({ key, model, fallbackModel, messages, temperature: 0.2 });
      const reply = finalCompletion.message.content?.trim();
      if (!reply) {
        throw new BadRequestException('El asistente no pudo completar la respuesta. Intenta reformular la pregunta.');
      }
      this.logger.log(`AI chat (final sin tools) tenant=${tenantId} user=${user.id} model=${finalCompletion.model}`);
      return { reply, model: finalCompletion.model, tools_used: MAX_TOOL_ITERATIONS };
    } finally {
      this.busyUsers.delete(user.id);
    }
  }

  private keyHint(): string | null {
    const key = this.client.apiKey();
    return key ? `…${key.slice(-4)}` : null;
  }

  /** Límite diario por tenant (controla el gasto de la cuenta OpenRouter de la plataforma). */
  private enforceDailyLimit(tenantId: string): void {
    const configured = Number(this.config.get<string>('AI_DAILY_MESSAGES_LIMIT') ?? '100');
    const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 100;
    const day = new Date().toISOString().slice(0, 10);
    const usage = this.dailyUsage.get(tenantId);
    const count = usage && usage.day === day ? usage.count : 0;
    if (count >= limit) {
      throw new BadRequestException(
        `Límite diario del asistente alcanzado (${limit} mensajes por tienda). Intenta de nuevo mañana.`
      );
    }
    this.dailyUsage.set(tenantId, { day, count: count + 1 });
    if (this.dailyUsage.size > 5000) {
      for (const [key, value] of this.dailyUsage) {
        if (value.day !== day) this.dailyUsage.delete(key);
      }
    }
  }

  private async buildMessages(tenantId: string, dto: AiChatDto): Promise<Array<Record<string, unknown>>> {
    const tenant = await this.database.query<{ name: string }>(
      'SELECT name FROM public.tec_tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    const tenantName = tenant.rows[0]?.name ?? 'la tienda';
    const timezone = await this.timezone.forTenant(tenantId);
    const today = todayInTimeZone(timezone);

    const system = [
      `Eres el asistente de negocio de "${tenantName}" en Tienderu POS.`,
      `Hoy es ${today} (zona horaria ${timezone}).`,
      'Responde en español, claro y breve (máximo ~10 líneas o una tabla corta de hasta 10 filas).',
      'Usa SIEMPRE las herramientas para obtener cifras reales; nunca inventes datos ni montos. Si no hay datos, dilo.',
      'Capacidades: resumen financiero por rango (ventas/compras/gastos/ganancia/pagado/pendiente); ventas por día, mes, hora y categoría; productos más vendidos, búsqueda, desempeño con margen, stock bajo y productos sin movimiento (para sugerir pedidos); clientes: ranking por monto comprado, búsqueda, puntos y deuda pendiente; cuentas abiertas por cobrar.',
      'Si piden un cliente por nombre o teléfono, usa primero search_customers y luego get_customer_summary con el id encontrado. Para un producto, usa search_products antes de get_product_performance.',
      'Si el usuario no da fechas: resumen y ventas → últimos 7 días; categorías y desempeño de producto → últimos 30 días; stock sin movimiento → 30 días.',
      'Presenta los montos en pesos colombianos con separador de miles.'
    ].join(' ');

    return [
      { role: 'system', content: system },
      ...dto.messages.slice(-20).map((message) => ({ role: message.role, content: message.content.trim() }))
    ];
  }
}
