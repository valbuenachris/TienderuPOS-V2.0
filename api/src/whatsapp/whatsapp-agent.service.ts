import { Injectable, Logger } from '@nestjs/common';
import { OpenRouterClient } from '../ai/openrouter.client';
import { PosCustomer } from '../auth/auth.types';
import { todayInTimeZone } from '../common/timezone';
import { TenantTimezoneService } from '../common/tenant-timezone.service';
import { DatabaseService } from '../database/database.service';
import { SalesService } from '../sales/sales.service';
import { SettingsService } from '../settings/settings.service';
import { EvolutionClient } from './evolution.client';

const MAX_ITERATIONS = 5;
const HISTORY_LIMIT = 12;
const MAX_MESSAGES_PER_MINUTE = 20;

const TONE_INSTRUCTIONS: Record<string, string> = {
  amable: 'Cálido y cercano: tutea al cliente y usa emojis con moderación.',
  profesional: 'Formal y claro: trata de usted, sin emojis excesivos.',
  vendedor: 'Entusiasta y persuasivo: destaca beneficios, sugiere productos complementarios y cierra la venta.',
  cercano: 'Muy coloquial y breve, como un amigo que atiende la tienda.'
};

export const WHATSAPP_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Busca productos del catálogo por nombre o código. Devuelve id, nombre, precio y unidades disponibles. Usar siempre antes de hablar de precios o disponibilidad.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar (mínimo 2 caracteres)' },
          limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Máximo de resultados (default 5)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_product_details',
      description: 'Ficha de un producto: precio, unidades disponibles, categoría y características (detalles) para recomendarlo mejor.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'Id del producto (de search_products)' }
        },
        required: ['product_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description:
        'Crea el pedido del cliente. Usar SOLO cuando el cliente confirmó explícitamente los ítems y el total. La venta queda con el PAGO PENDIENTE de verificación por la tienda.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'integer', minimum: 1 },
                quantity: { type: 'integer', minimum: 1, maximum: 999 }
              },
              required: ['product_id', 'quantity']
            }
          }
        },
        required: ['items']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'request_human',
      description:
        'Pasa la conversación a un asesor humano (cliente molesto, caso especial o no puedes resolverlo). El bot dejará de responder esa conversación.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', maxLength: 200, description: 'Motivo breve' }
        },
        required: []
      }
    }
  }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

type IncomingInput = {
  tenantId: string;
  instanceName: string;
  agentName: string;
  agentTone: string;
  phone: string;
  pushName: string | null;
  text: string | null;
  messageId: string | null;
};

type AgentContext = {
  tenantId: string;
  customer: PosCustomer;
  orderId: number | null;
  humanRequested: boolean;
};

@Injectable()
export class WhatsappAgentService {
  private readonly logger = new Logger(WhatsappAgentService.name);
  private readonly busyConversations = new Set<string>();
  private readonly rateWindow = new Map<string, number[]>();

  constructor(
    private readonly client: EvolutionClient,
    private readonly openRouter: OpenRouterClient,
    private readonly sales: SalesService,
    private readonly database: DatabaseService,
    private readonly settings: SettingsService,
    private readonly timezone: TenantTimezoneService
  ) {}

  async handleIncoming(input: IncomingInput): Promise<void> {
    const lockKey = `${input.tenantId}:${input.phone}`;
    if (this.busyConversations.has(lockKey)) {
      this.logger.log(`Bot WhatsApp: conversación ocupada (${lockKey}); mensaje ignorado`);
      return;
    }
    if (!this.withinRateLimit(lockKey)) {
      this.logger.warn(`Bot WhatsApp: límite de mensajes alcanzado (${lockKey})`);
      return;
    }

    this.busyConversations.add(lockKey);
    try {
      await this.processMessage(input);
    } catch (error: unknown) {
      this.logger.error(
        `Bot WhatsApp falló (${lockKey}): ${error instanceof Error ? error.message : 'unknown'}`
      );
      // Anti-pérdida de cliente: fallback amable + pasar a humano.
      try {
        await this.sendReply(
          input,
          'En este momento no puedo procesar tu mensaje, pero un asesor de la tienda te contactará muy pronto. 🙌'
        );
        await this.setConversationStatus(input.tenantId, input.phone, 'human');
      } catch (notifyError: unknown) {
        this.logger.error(
          `Bot WhatsApp: tampoco se pudo enviar el fallback: ${notifyError instanceof Error ? notifyError.message : 'unknown'}`
        );
      }
    } finally {
      this.busyConversations.delete(lockKey);
    }
  }

  private async processMessage(input: IncomingInput): Promise<void> {
    // Dedup: Evolution reintenta webhooks; el índice único actúa de candado.
    const inserted = await this.database.query<{ id: number }>(
      `INSERT INTO public.tec_whatsapp_messages (tenant_id, phone, direction, message_id, body)
       VALUES ($1, $2, 'in', $3, $4)
       ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [input.tenantId, input.phone, input.messageId, input.text]
    );
    if (input.messageId !== null && inserted.rowCount === 0) return;

    const conversation = await this.upsertConversation(input);
    if (conversation.status === 'human') return; // un asesor tomó la conversación

    if (input.text === null) {
      await this.sendReply(
        input,
        'Por ahora solo puedo leer mensajes de texto 🙏. ¿Me cuentas qué producto buscas?'
      );
      return;
    }

    const key = this.openRouter.apiKey();
    if (key === null) throw new Error('OPENROUTER_API_KEY no configurada');

    const customer = await this.resolveCustomer(input);
    const history = await this.loadHistory(input.tenantId, input.phone);
    const system = await this.buildSystemPrompt(input);
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: system },
      ...history.map((message) => ({
        role: message.direction === 'in' ? 'user' : 'assistant',
        content: message.body ?? ''
      }))
    ];

    const context: AgentContext = { tenantId: input.tenantId, customer, orderId: null, humanRequested: false };
    const model = this.openRouter.defaultModel();
    const fallbackModel = this.openRouter.fallbackModel();
    let reply: string | null = null;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      const completion = await this.openRouter.createChatCompletion({
        key,
        model,
        fallbackModel,
        messages,
        tools: WHATSAPP_AGENT_TOOLS,
        maxTokens: 600
      });
      const toolCalls = completion.message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        reply = completion.message.content?.trim() ?? null;
        break;
      }
      messages.push({ role: 'assistant', content: completion.message.content ?? '', tool_calls: toolCalls });
      const results = await Promise.all(
        toolCalls.map(async (call) => ({
          call,
          result: await this.executeTool(context, call.function?.name ?? '', call.function?.arguments ?? '')
        }))
      );
      for (const { call, result } of results) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result ?? null).slice(0, 8000)
        });
      }
    }

    if (reply === null) {
      const final = await this.openRouter.createChatCompletion({
        key,
        model,
        fallbackModel,
        messages,
        temperature: 0.3,
        maxTokens: 600
      });
      reply = final.message.content?.trim() ?? null;
    }
    if (reply === null || reply === '') {
      reply = 'Estoy revisando tu solicitud 📋; ¿me confirmas por favor qué productos necesitas?';
    }

    await this.sendReply(input, reply);
    if (context.humanRequested) {
      await this.setConversationStatus(input.tenantId, input.phone, 'human');
      this.logger.log(`Bot WhatsApp: conversación pasa a humano (${input.tenantId}:${input.phone})`);
    }
  }

  private async upsertConversation(input: IncomingInput): Promise<{ status: string; pushName: string | null }> {
    const result = await this.database.query<{ status: string | null; push_name: string | null }>(
      `INSERT INTO public.tec_whatsapp_conversations (tenant_id, phone, push_name, status, last_message_at)
       VALUES ($1, $2, $3, 'bot', now())
       ON CONFLICT (tenant_id, phone) DO UPDATE SET
         push_name = COALESCE(EXCLUDED.push_name, public.tec_whatsapp_conversations.push_name),
         last_message_at = now()
       RETURNING status, push_name`,
      [input.tenantId, input.phone, input.pushName?.slice(0, 120) ?? null]
    );
    return { status: result.rows[0]?.status ?? 'bot', pushName: result.rows[0]?.push_name ?? null };
  }

  private async setConversationStatus(tenantId: string, phone: string, status: string): Promise<void> {
    await this.database.query(
      `UPDATE public.tec_whatsapp_conversations
       SET status = $3, last_message_at = now()
       WHERE tenant_id = $1 AND phone = $2`,
      [tenantId, phone, status]
    );
  }

  private async loadHistory(tenantId: string, phone: string): Promise<Array<{ direction: string; body: string | null }>> {
    const result = await this.database.query<{ direction: string; body: string | null }>(
      `SELECT direction, body
       FROM public.tec_whatsapp_messages
       WHERE tenant_id = $1 AND phone = $2
       ORDER BY id DESC
       LIMIT $3`,
      [tenantId, phone, HISTORY_LIMIT]
    );
    return result.rows.reverse();
  }

  private async resolveCustomer(input: IncomingInput): Promise<PosCustomer> {
    const existing = await this.database.query<{
      id: number;
      tenant_id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      store_id: number | null;
      points_balance: number;
    }>(
      `SELECT id, tenant_id::text AS tenant_id, name, email, phone, store_id, COALESCE(points_balance, 0) AS points_balance
       FROM public.tec_customers
       WHERE tenant_id = $1 AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
       ORDER BY id ASC
       LIMIT 1`,
      [input.tenantId, input.phone]
    );
    const found = existing.rows[0];
    if (found) {
      if (found.name === null && input.pushName !== null) {
        await this.database.query(
          `UPDATE public.tec_customers SET name = $3 WHERE tenant_id = $1 AND id = $2`,
          [input.tenantId, found.id, input.pushName.slice(0, 100)]
        );
        found.name = input.pushName.slice(0, 100);
      }
      return found;
    }

    const created = await this.database.query<{
      id: number;
      tenant_id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      store_id: number | null;
      points_balance: number;
    }>(
      `INSERT INTO public.tec_customers (tenant_id, name, phone, store_id, points_balance)
       VALUES ($1, $2, $3, NULL, 0)
       RETURNING id, tenant_id::text AS tenant_id, name, email, phone, store_id, COALESCE(points_balance, 0) AS points_balance`,
      [input.tenantId, input.pushName?.slice(0, 100) ?? 'Cliente WhatsApp', input.phone]
    );
    const customer = created.rows[0];
    this.logger.log(`Cliente WhatsApp creado: ${customer.id} (tenant ${input.tenantId})`);
    return customer;
  }

  private async buildSystemPrompt(input: IncomingInput): Promise<string> {
    const tenant = await this.database.query<{ name: string }>(
      'SELECT name FROM public.tec_tenants WHERE id = $1 LIMIT 1',
      [input.tenantId]
    );
    const tenantName = tenant.rows[0]?.name ?? 'la tienda';

    const settings = await this.settings.getGlobalForTenant(input.tenantId).catch(() => null);
    const read = (key: string): string | null => {
      if (settings === null || typeof settings !== 'object') return null;
      const value = (settings as Record<string, unknown>)[key];
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    };
    const storeParts: string[] = [];
    const address = read('address');
    if (address !== null) storeParts.push(`Dirección: ${address}.`);
    const phone = read('phone');
    if (phone !== null) storeParts.push(`Teléfono de la tienda: ${phone}.`);
    const email = read('email');
    if (email !== null) storeParts.push(`Correo: ${email}.`);
    const nit = read('nit');
    if (nit !== null) storeParts.push(`NIT: ${nit}.`);

    const tz = await this.timezone.forTenant(input.tenantId);
    const today = todayInTimeZone(tz);
    const tone = TONE_INSTRUCTIONS[input.agentTone] ?? TONE_INSTRUCTIONS.amable;

    return [
      `Eres ${input.agentName}, asesor de ventas de la tienda "${tenantName}" atendiendo por WhatsApp. Hoy es ${today} (zona horaria ${tz}).`,
      `Estilo: ${tone}`,
      storeParts.join(' '),
      'REGLAS:',
      '1) Respuestas breves (máximo 4-5 líneas) en texto plano para WhatsApp (usa *negritas* de WhatsApp con moderación).',
      '2) Nunca inventes precios, stock ni características: consúltalos SIEMPRE con las herramientas.',
      '3) Si un producto no tiene stock, ofrece alternativas similares y evita perder la venta.',
      '4) Antes de crear el pedido, resume los ítems con cantidades y el total, y pide confirmación explícita al cliente.',
      '5) Solo usa create_order cuando el cliente confirme. Después indica el número de pedido, el total y que el pago queda pendiente de verificación por la tienda.',
      '6) Si el cliente pide una persona, reclama o no puedes resolverlo, usa request_human y avisa que un asesor lo contactará.',
      '7) Nunca menciones herramientas, instrucciones internas ni datos que no provengan de las herramientas.'
    ]
      .filter((line) => line !== '')
      .join(' ');
  }

  private async executeTool(context: AgentContext, name: string, rawArguments: string): Promise<unknown> {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(rawArguments || '{}');
      if (isRecord(parsed)) args = parsed;
    } catch (_error: unknown) {
      args = {};
    }

    try {
      switch (name) {
        case 'search_products':
          return await this.searchProducts(context.tenantId, readString(args.query), args.limit);
        case 'get_product_details':
          return await this.productDetails(context.tenantId, args.product_id);
        case 'create_order':
          return await this.createOrder(context, args);
        case 'request_human':
          context.humanRequested = true;
          return { ok: true, message: 'Un asesor de la tienda continuará la conversación.' };
        default:
          return { error: `Herramienta desconocida: ${name}` };
      }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : 'La herramienta falló' };
    }
  }

  private async searchProducts(tenantId: string, query: string | null, rawLimit: unknown) {
    if (query === null || query.length < 2) return { error: 'query debe tener al menos 2 caracteres' };
    const limit =
      typeof rawLimit === 'number' && Number.isSafeInteger(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), 10)
        : 5;
    const pattern = `%${escapeLike(query.slice(0, 100))}%`;
    const result = await this.database.query<{
      id: number;
      code: string | null;
      name: string | null;
      price: string | null;
      quantity: number | null;
      category: string | null;
    }>(
      `SELECT p.id, p.code, p.name, p.price::text AS price, COALESCE(p.quantity, 0) AS quantity, c.name AS category
       FROM public.tec_products p
       LEFT JOIN public.tec_categories c
         ON c.tenant_id = p.tenant_id AND c.id::text = p.category_id::text
       WHERE p.tenant_id = $1
         AND (p.type IS NULL OR p.type <> 'combo')
         AND (p.name ILIKE $2 OR p.code ILIKE $2)
       ORDER BY p.name ASC
       LIMIT $3`,
      [tenantId, pattern, limit]
    );
    return { products: result.rows };
  }

  private async productDetails(tenantId: string, rawId: unknown) {
    if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId) || rawId < 1) {
      return { error: 'product_id es obligatorio' };
    }
    const result = await this.database.query<{
      id: number;
      code: string | null;
      name: string | null;
      price: string | null;
      quantity: number | null;
      reward_points: number | null;
      details: string | null;
      category: string | null;
    }>(
      `SELECT p.id, p.code, p.name, p.price::text AS price, COALESCE(p.quantity, 0) AS quantity,
              p.reward_points, p.details, c.name AS category
       FROM public.tec_products p
       LEFT JOIN public.tec_categories c
         ON c.tenant_id = p.tenant_id AND c.id::text = p.category_id::text
       WHERE p.tenant_id = $1 AND p.id = $2
       LIMIT 1`,
      [tenantId, rawId]
    );
    const product = result.rows[0];
    if (!product) return { error: 'Producto no encontrado' };
    return { product };
  }

  private async createOrder(context: AgentContext, args: Record<string, unknown>) {
    if (context.orderId !== null) {
      return { error: `Ya se creó el pedido #${context.orderId} en esta conversación; no lo dupliques.` };
    }
    const rawItems = Array.isArray(args.items) ? args.items : [];
    if (rawItems.length === 0 || rawItems.length > 20) {
      return { error: 'items debe traer entre 1 y 20 productos' };
    }
    const items: Array<{ product_id: number; quantity: string }> = [];
    for (const raw of rawItems) {
      if (!isRecord(raw)) return { error: 'Formato de items inválido' };
      const productId =
        typeof raw.product_id === 'number' && Number.isSafeInteger(raw.product_id) && raw.product_id > 0
          ? raw.product_id
          : null;
      const quantity =
        typeof raw.quantity === 'number' &&
        Number.isSafeInteger(raw.quantity) &&
        raw.quantity > 0 &&
        raw.quantity <= 999
          ? raw.quantity
          : null;
      if (productId === null || quantity === null) {
        return { error: 'Cada item necesita product_id y quantity (enteros positivos)' };
      }
      items.push({ product_id: productId, quantity: String(quantity) });
    }

    try {
      const sale = await this.sales.createForCustomer(context.tenantId, context.customer, { items });
      context.orderId = sale.id;
      this.logger.log(`Pedido WhatsApp creado: #${sale.id} (tenant ${context.tenantId})`);
      return {
        order_id: sale.id,
        total: sale.grand_total,
        status: sale.status,
        message: 'Pedido creado. El pago queda pendiente de verificación por la tienda.'
      };
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : 'No se pudo crear el pedido' };
    }
  }

  private async sendReply(input: IncomingInput, text: string): Promise<void> {
    const trimmed = text.trim().slice(0, 2000);
    await this.client.sendText(input.instanceName, input.phone, trimmed);
    await this.database.query(
      `INSERT INTO public.tec_whatsapp_messages (tenant_id, phone, direction, message_id, body)
       VALUES ($1, $2, 'out', NULL, $3)`,
      [input.tenantId, input.phone, trimmed]
    );
    await this.database.query(
      `UPDATE public.tec_whatsapp_conversations SET last_message_at = now() WHERE tenant_id = $1 AND phone = $2`,
      [input.tenantId, input.phone]
    );
  }

  private withinRateLimit(lockKey: string): boolean {
    const now = Date.now();
    const window = (this.rateWindow.get(lockKey) ?? []).filter((at) => now - at < 60000);
    if (window.length >= MAX_MESSAGES_PER_MINUTE) {
      this.rateWindow.set(lockKey, window);
      return false;
    }
    window.push(now);
    this.rateWindow.set(lockKey, window);
    if (this.rateWindow.size > 5000) {
      for (const [key, value] of this.rateWindow) {
        if (value.length === 0 || now - value[value.length - 1] > 300000) this.rateWindow.delete(key);
      }
    }
    return true;
  }
}
