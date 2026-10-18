import { Injectable, Logger } from '@nestjs/common';
import { OpenRouterClient } from '../ai/openrouter.client';
import { PosCustomer, PosUser } from '../auth/auth.types';
import { todayInTimeZone } from '../common/timezone';
import { TenantTimezoneService } from '../common/tenant-timezone.service';
import { DatabaseService } from '../database/database.service';
import { SalesService } from '../sales/sales.service';
import { SettingsService } from '../settings/settings.service';
import { EvolutionClient } from './evolution.client';

const MAX_ITERATIONS = 5;
const HISTORY_LIMIT = 16;
const DRAFT_TTL_MS = 6 * 60 * 60 * 1000;
/** Sin actividad del personal, el bot retoma la conversación tras este tiempo. */
const HANDOFF_IDLE_MS = 15 * 60 * 1000;
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
      name: 'get_catalog_overview',
      description:
        'Resumen del catálogo: total de productos, categorías con su conteo y 3 productos aleatorios de ejemplo (nombre, precio, categoría). Usar SIEMPRE para "¿qué vendes?" y para ofrecer productos cuando el cliente no sabe qué buscar.',
      parameters: {
        type: 'object',
        properties: {
          sample_size: {
            type: 'integer',
            minimum: 3,
            maximum: 5,
            description: 'Cantidad de productos de ejemplo (default 3)'
          }
        },
        required: []
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
      name: 'add_to_order',
      description:
        'Agrega productos al pedido en curso (el servidor guarda el borrador y calcula el total). Devuelve SIEMPRE el resumen completo. Úsalo cada vez que el cliente pida productos, aunque sea parcial; nunca esperes a tener la lista completa.',
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
      name: 'remove_from_order',
      description: 'Quita un producto del pedido en curso (borrador) y devuelve el resumen actualizado.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'Id del producto (de search_products/get_product_details)' }
        },
        required: ['product_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_order_draft',
      description:
        'Muestra el pedido en curso con cantidades y total calculados por el servidor. Usar para repasar o cuando el cliente pregunte por "el pedido".',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description:
        'Crea el pedido con TODO el borrador actual (si envías items, se suman primero al borrador). Usar SOLO cuando el cliente confirme el resumen. La venta queda con el PAGO PENDIENTE de verificación.',
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
        required: []
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

/** Resumen compacto del resultado de una herramienta para los logs del bot. */
function summarizeToolResult(result: unknown): string {
  if (!isRecord(result)) return 'ok';
  if (result.error !== undefined) return `error: ${String(result.error).slice(0, 140)}`;
  if (Array.isArray(result.products)) return `productos: ${result.products.length}`;
  if (Array.isArray(result.categories)) return `categorias: ${result.categories.length}`;
  if (Array.isArray(result.draft)) return `borrador: ${result.draft.length}`;
  if (result.order_id !== undefined) return `pedido #${String(result.order_id)}`;
  if (result.ok === true) return 'ok';
  return 'ok';
}

type DraftLine = { productId: number; quantity: number };

/** Actor de sistema: el bot opera con permisos de administrador a nivel de servicio
 *  (no hay usuario humano en la conversación). Las ventas del bot siguen con created_by NULL. */
function systemBotUser(tenantId: string): PosUser {
  return {
    id: 0,
    tenant_id: tenantId,
    username: 'whatsapp-bot',
    email: null,
    first_name: null,
    last_name: null,
    group_id: null,
    group_name: 'admin',
    store_id: null,
    active: 1
  };
}

function formatMoneyCOP(value: number | string | null | undefined): string {
  return `$${Number(value ?? 0).toLocaleString('es-CO')}`;
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
  phone: string;
  customer: PosCustomer;
  orderId: number | null;
  humanRequested: boolean;
};

@Injectable()
export class WhatsappAgentService {
  private readonly logger = new Logger(WhatsappAgentService.name);
  private readonly busyConversations = new Set<string>();
  private readonly rateWindow = new Map<string, number[]>();
  /** Pedido en curso por conversación: borrador + pedido ya creado (persiste entre mensajes, TTL 6 h). */
  private readonly orderState = new Map<string, { lines: DraftLine[]; orderId: number | null; at: number }>();

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
    if (conversation.status === 'human') {
      // Auto-retorno: si el personal no responde hace rato (o el cliente pide el bot), el asistente vuelve.
      const idle = await this.staffIdleMs(input.tenantId, input.phone);
      const asksForBot = /\b(bot|asistente)\b/i.test(input.text ?? '');
      if (!asksForBot && idle < HANDOFF_IDLE_MS) return; // un humano está atendiendo
      await this.setConversationStatus(input.tenantId, input.phone, 'bot');
      this.logger.log(`Bot WhatsApp: conversación vuelve al bot (${input.tenantId}:${input.phone})`);
    }

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

    const state = this.getOrderState(input.tenantId, input.phone);
    const context: AgentContext = {
      tenantId: input.tenantId,
      phone: input.phone,
      customer,
      orderId: state.orderId,
      humanRequested: false
    };
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
      const summary = context.orderId === null ? await this.buildDraftSummary(context) : null;
      if (summary !== null && summary.lines.length > 0) {
        const lines = summary.lines
          .map((line) => `• ${line.name} × ${line.quantity} = ${formatMoneyCOP(line.subtotal)}`)
          .join('\n');
        reply = `Perdón 🙏, ¿te confirmo el pedido?\n${lines}\n*Total:* ${formatMoneyCOP(summary.total)}`;
      } else {
        reply = 'Perdón 🙏, ¿me repites por favor qué productos necesitas?';
      }
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

  /** Milisegundos desde la última respuesta del PERSONAL (fromMe); Infinity si nunca respondió. */
  private async staffIdleMs(tenantId: string, phone: string): Promise<number> {
    const result = await this.database.query<{ at_ms: string }>(
      `SELECT (EXTRACT(EPOCH FROM created_at) * 1000)::bigint::text AS at_ms
       FROM public.tec_whatsapp_messages
       WHERE tenant_id = $1 AND phone = $2 AND direction = 'out' AND message_id IS NOT NULL
       ORDER BY id DESC
       LIMIT 1`,
      [tenantId, phone]
    );
    const last = result.rows[0]?.at_ms;
    if (!last) return Number.POSITIVE_INFINITY;
    const at = Number(last);
    return Number.isFinite(at) ? Date.now() - at : Number.POSITIVE_INFINITY;
  }

  /** Registra un mensaje enviado por el personal desde el teléfono (fromMe) para pausar al bot. */
  async recordStaffMessage(input: {
    tenantId: string;
    phone: string;
    messageId: string | null;
    text: string | null;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO public.tec_whatsapp_messages (tenant_id, phone, direction, message_id, body)
       VALUES ($1, $2, 'out', $3, $4)
       ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
      [input.tenantId, input.phone, input.messageId, input.text]
    );
    await this.database.query(
      `UPDATE public.tec_whatsapp_conversations SET last_message_at = now() WHERE tenant_id = $1 AND phone = $2`,
      [input.tenantId, input.phone]
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
      '1) Respuestas breves (máximo 5 líneas) en texto plano para WhatsApp (usa *negritas* con moderación).',
      '2) Nunca inventes precios, stock, categorías ni características: usa SIEMPRE las herramientas y responde solo con lo que devuelvan.',
      '2b) Para "¿qué vendes?" usa get_catalog_overview y menciona 3 productos de ejemplo (nombre y precio) + las categorías principales.',
      '2c) Nunca digas que un producto no existe o no está disponible sin llamar antes search_products; si no hay resultados intenta singular/plural y ofrece alternativas.',
      '2d) NUNCA muestres al cliente ids, códigos internos ni nombres de herramientas. Habla como un asesor humano.',
      '3) El pedido en curso vive en el SERVIDOR: agrega cada producto que pida el cliente con add_to_order (aunque sea parcial) y usa get_order_draft para repasar. NUNCA calcules totales tú: usa los que devuelven las herramientas.',
      '4) Antes de crear el pedido, resume los ítems y el total EXACTOS devueltos por el servidor y pide confirmación explícita.',
      '5) Solo usa create_order cuando el cliente diga que sí/confirmo. Si el pedido YA fue creado y el cliente agrega más, usa add_to_order (se suman al MISMO pedido, sin crear otro). Después indica el número, el total y que el pago queda pendiente de verificación.',
      '6) Usa request_human SOLO si el cliente pide una persona, presenta un reclamo o es un caso que no puedes resolver. Para temas fuera de la tienda (charla, chistes), responde breve y redirige al catálogo; NO pases a humano por eso. Si pasas a humano, avisa que un asesor continuará y que puede escribir *bot* para volver al asistente.',
      '7) Si una herramienta falla o no hay datos, discúlpate y pide reformular; nunca dejes la conversación sin respuesta.'
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
      let result: unknown;
      switch (name) {
        case 'search_products':
          result = await this.searchProducts(context.tenantId, readString(args.query), args.limit);
          break;
        case 'get_catalog_overview':
          result = await this.catalogOverview(context.tenantId, args.sample_size);
          break;
        case 'get_product_details':
          result = await this.productDetails(context.tenantId, args.product_id);
          break;
        case 'add_to_order':
          result = await this.addToOrder(context, args);
          break;
        case 'remove_from_order':
          result = await this.removeFromOrder(context, args);
          break;
        case 'get_order_draft':
          result = await this.getOrderDraft(context);
          break;
        case 'create_order':
          result = await this.createOrder(context, args);
          break;
        case 'request_human':
          context.humanRequested = true;
          result = {
            ok: true,
            message:
              'Un asesor de la tienda continuará la conversación. Si el cliente prefiere seguir con el asistente automático, dile que escriba *bot*.'
          };
          break;
        default:
          result = { error: `Herramienta desconocida: ${name}` };
      }
      this.logger.log(
        `Bot herramienta ${name} tenant=${context.tenantId} args=${rawArguments.slice(0, 120)} -> ${summarizeToolResult(result)}`
      );
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'La herramienta falló';
      this.logger.warn(`Bot herramienta ${name} tenant=${context.tenantId} falló: ${message}`);
      return { error: message };
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
         AND (p.name ILIKE $2 OR p.code ILIKE $2 OR c.name ILIKE $2)
       ORDER BY p.name ASC
       LIMIT $3`,
      [tenantId, pattern, limit]
    );
    if (result.rows.length === 0) {
      return {
        products: [],
        hint: 'Sin resultados para esa palabra; intenta en singular/plural o llama get_catalog_overview para ver las categorías y productos disponibles.'
      };
    }
    return { products: result.rows };
  }

  /** Catálogo para "¿qué vendes?": total, categorías y 3 productos aleatorios con stock y precio. */
  private async catalogOverview(tenantId: string, rawSampleSize: unknown) {
    const sampleSize =
      typeof rawSampleSize === 'number' && Number.isSafeInteger(rawSampleSize)
        ? Math.min(Math.max(rawSampleSize, 3), 5)
        : 3;

    const [total, categories, sample] = await Promise.all([
      this.database.query<{ total: number }>(
        `SELECT COUNT(*)::integer AS total
         FROM public.tec_products
         WHERE tenant_id = $1 AND (type IS NULL OR type <> 'combo') AND COALESCE(quantity, 0) > 0`,
        [tenantId]
      ),
      this.database.query<{ category: string; products: number }>(
        `SELECT COALESCE(c.name, 'Sin categoría') AS category, COUNT(p.id)::integer AS products
         FROM public.tec_products p
         LEFT JOIN public.tec_categories c
           ON c.tenant_id = p.tenant_id AND c.id::text = p.category_id::text
         WHERE p.tenant_id = $1 AND (p.type IS NULL OR p.type <> 'combo')
         GROUP BY 1
         ORDER BY COUNT(p.id) DESC
         LIMIT 30`,
        [tenantId]
      ),
      this.database.query<{
        id: number;
        code: string | null;
        name: string | null;
        price: string | null;
        category: string | null;
      }>(
        `SELECT p.id, p.code, p.name, p.price::text AS price, c.name AS category
         FROM public.tec_products p
         LEFT JOIN public.tec_categories c
           ON c.tenant_id = p.tenant_id AND c.id::text = p.category_id::text
         WHERE p.tenant_id = $1
           AND (p.type IS NULL OR p.type <> 'combo')
           AND COALESCE(p.quantity, 0) > 0
           AND p.price IS NOT NULL
         ORDER BY random()
         LIMIT $2`,
        [tenantId, sampleSize]
      )
    ]);

    return {
      total_products: total.rows[0]?.total ?? 0,
      categories: categories.rows,
      sample_products: sample.rows
    };
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

  // ===== Pedido en curso (borrador + pedido creado, por conversación) =====

  private getOrderState(tenantId: string, phone: string): { lines: DraftLine[]; orderId: number | null } {
    const key = `${tenantId}:${phone}`;
    const entry = this.orderState.get(key);
    if (!entry) return { lines: [], orderId: null };
    if (Date.now() - entry.at > DRAFT_TTL_MS) {
      this.orderState.delete(key);
      return { lines: [], orderId: null };
    }
    entry.at = Date.now();
    return { lines: entry.lines, orderId: entry.orderId };
  }

  private saveOrderState(
    tenantId: string,
    phone: string,
    patch: { lines?: DraftLine[]; orderId?: number | null }
  ): void {
    const key = `${tenantId}:${phone}`;
    const current = this.getOrderState(tenantId, phone);
    const next = {
      lines: patch.lines ?? current.lines,
      orderId: patch.orderId === undefined ? current.orderId : patch.orderId,
      at: Date.now()
    };
    if (next.lines.length === 0 && next.orderId === null) this.orderState.delete(key);
    else this.orderState.set(key, next);
    if (this.orderState.size > 2000) {
      const now = Date.now();
      for (const [entryKey, value] of this.orderState) {
        if (now - value.at > DRAFT_TTL_MS) this.orderState.delete(entryKey);
      }
    }
  }

  /** Valida ítems contra el catálogo actual (existe, precio, stock). Devuelve mensaje de error o null. */
  private async validateItemsForOrder(
    tenantId: string,
    items: Array<{ product_id: number; quantity: number }>
  ): Promise<string | null> {
    const ids = [...new Set(items.map((item) => item.product_id))];
    const products = await this.database.query<{
      id: number;
      name: string | null;
      price: string | null;
      quantity: number | null;
      type: string | null;
    }>(
      `SELECT id, name, price::text AS price, COALESCE(quantity, 0) AS quantity, type
       FROM public.tec_products
       WHERE tenant_id = $1 AND id = ANY($2::int[])`,
      [tenantId, ids]
    );
    const byId = new Map(products.rows.map((row) => [row.id, row]));
    for (const item of items) {
      const product = byId.get(item.product_id);
      if (!product || product.type === 'combo' || product.price === null) {
        return `El producto ${item.product_id} no está disponible`;
      }
      if (Number(product.quantity ?? 0) < item.quantity) {
        return `Sin stock suficiente de ${product.name ?? `#${item.product_id}`} (disponibles: ${product.quantity ?? 0})`;
      }
    }
    return null;
  }

  /** Resumen del borrador con precios/stock ACTUALES; el servidor es la fuente del total. */
  private async buildDraftSummary(context: AgentContext): Promise<{
    lines: Array<{ product_id: number; name: string; quantity: number; unit_price: string; subtotal: string }>;
    total: string;
    warnings: string[];
  }> {
    const draft = this.getOrderState(context.tenantId, context.phone).lines;
    if (draft.length === 0) return { lines: [], total: '0.00', warnings: [] };

    const ids = draft.map((line) => line.productId);
    const products = await this.database.query<{
      id: number;
      name: string | null;
      price: string | null;
      quantity: number | null;
    }>(
      `SELECT id, name, price::text AS price, COALESCE(quantity, 0) AS quantity
       FROM public.tec_products
       WHERE tenant_id = $1 AND id = ANY($2::int[])`,
      [context.tenantId, ids]
    );
    const byId = new Map(products.rows.map((row) => [row.id, row]));

    const lines: Array<{ product_id: number; name: string; quantity: number; unit_price: string; subtotal: string }> = [];
    const warnings: string[] = [];
    let total = 0;
    for (const line of draft) {
      const product = byId.get(line.productId);
      if (!product || product.price === null) {
        warnings.push(`El producto ${line.productId} ya no está disponible; quítalo del pedido.`);
        continue;
      }
      if (Number(product.quantity ?? 0) < line.quantity) {
        warnings.push(`Sin stock suficiente de ${product.name ?? `#${line.productId}`} (disponibles: ${product.quantity ?? 0}).`);
      }
      const subtotal = Number(product.price) * line.quantity;
      total += subtotal;
      lines.push({
        product_id: line.productId,
        name: product.name ?? `#${line.productId}`,
        quantity: line.quantity,
        unit_price: product.price,
        subtotal: subtotal.toFixed(2)
      });
    }
    return { lines, total: total.toFixed(2), warnings };
  }

  private parseOrderItems(rawItems: unknown): Array<{ product_id: number; quantity: number }> | string {
    const list = Array.isArray(rawItems) ? rawItems : [];
    if (list.length === 0 || list.length > 20) return 'items debe traer entre 1 y 20 productos';
    const items: Array<{ product_id: number; quantity: number }> = [];
    for (const raw of list) {
      if (!isRecord(raw)) return 'Formato de items inválido';
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
        return 'Cada item necesita product_id y quantity (enteros positivos)';
      }
      items.push({ product_id: productId, quantity });
    }
    return items;
  }

  private async addToOrder(context: AgentContext, args: Record<string, unknown>) {
    const parsedItems = this.parseOrderItems(args.items);
    if (typeof parsedItems === 'string') return { error: parsedItems };

    const validationError = await this.validateItemsForOrder(context.tenantId, parsedItems);
    if (validationError !== null) return { error: validationError };

    // Si el pedido ya fue creado, los productos se agregan al MISMO pedido (append, sin venta nueva).
    if (context.orderId !== null) {
      try {
        const detail = (await this.sales.appendItems(
          context.tenantId,
          systemBotUser(context.tenantId),
          context.orderId,
          { items: parsedItems.map((item) => ({ product_id: item.product_id, quantity: String(item.quantity) })) }
        )) as { grand_total?: string | null; status?: string | null };
        return {
          order_id: context.orderId,
          total: detail.grand_total ?? null,
          status: detail.status ?? null,
          message: 'Se agregaron al MISMO pedido ya creado; este es el total actualizado.'
        };
      } catch (error: unknown) {
        return { error: error instanceof Error ? error.message : 'No se pudo agregar al pedido' };
      }
    }

    const draft = this.getOrderState(context.tenantId, context.phone).lines;
    for (const item of parsedItems) {
      const existing = draft.find((line) => line.productId === item.product_id);
      if (existing) existing.quantity += item.quantity;
      else draft.push({ productId: item.product_id, quantity: item.quantity });
    }
    if (draft.length > 20) return { error: 'El pedido supera 20 productos distintos' };
    this.saveOrderState(context.tenantId, context.phone, { lines: draft });

    const summary = await this.buildDraftSummary(context);
    return {
      draft: summary.lines,
      total: summary.total,
      ...(summary.warnings.length > 0 ? { warnings: summary.warnings } : {}),
      message: 'Resumen actualizado del pedido en curso. Pide confirmación al cliente antes de create_order.'
    };
  }

  private async removeFromOrder(context: AgentContext, args: Record<string, unknown>) {
    if (context.orderId !== null) {
      return { error: 'El pedido ya fue creado; para quitarlo debe gestionarlo la tienda. Puedes agregar más con add_to_order.' };
    }
    const productId =
      typeof args.product_id === 'number' && Number.isSafeInteger(args.product_id) && args.product_id > 0
        ? args.product_id
        : null;
    if (productId === null) return { error: 'product_id es obligatorio' };

    const draft = this.getOrderState(context.tenantId, context.phone).lines.filter(
      (line) => line.productId !== productId
    );
    this.saveOrderState(context.tenantId, context.phone, { lines: draft });
    const summary = await this.buildDraftSummary(context);
    return { draft: summary.lines, total: summary.total, message: 'Producto quitado del pedido en curso.' };
  }

  private async getOrderDraft(context: AgentContext) {
    if (context.orderId !== null) {
      const detail = (await this.sales.detail(
        context.tenantId,
        systemBotUser(context.tenantId),
        context.orderId
      )) as {
        grand_total?: string | null;
        status?: string | null;
        items?: Array<{ name?: string | null; code?: string | null; quantity?: string | null; subtotal?: string | null }>;
      };
      return {
        order_id: context.orderId,
        total: detail.grand_total ?? null,
        status: detail.status ?? null,
        items: (detail.items ?? []).map((item) => ({
          name: item.name ?? item.code ?? null,
          quantity: item.quantity ?? null,
          subtotal: item.subtotal ?? null
        })),
        message: 'Pedido ya creado (pendiente de pago). Usa add_to_order para agregar productos a ESTE pedido.'
      };
    }
    const summary = await this.buildDraftSummary(context);
    return { draft: summary.lines, total: summary.total, warnings: summary.warnings };
  }

  private async createOrder(context: AgentContext, args: Record<string, unknown>) {
    if (context.orderId !== null) {
      return { error: `Ya se creó el pedido #${context.orderId}; usa add_to_order para agregar productos al MISMO pedido.` };
    }

    // Compatibilidad: si el modelo envía items aquí, se suman al borrador primero.
    if (Array.isArray(args.items) && args.items.length > 0) {
      const merged = await this.addToOrder(context, args);
      if (isRecord(merged) && merged.error !== undefined) return merged;
    }

    const summary = await this.buildDraftSummary(context);
    if (summary.lines.length === 0) {
      return { error: 'No hay productos en el pedido; usa add_to_order con los productos que pida el cliente.' };
    }
    if (summary.warnings.length > 0) {
      return { error: `Ajusta el pedido antes de crearlo: ${summary.warnings.join(' ')}` };
    }

    try {
      const sale = await this.sales.createForCustomer(context.tenantId, context.customer, {
        items: summary.lines.map((line) => ({ product_id: line.product_id, quantity: String(line.quantity) }))
      });
      context.orderId = sale.id;
      this.saveOrderState(context.tenantId, context.phone, { lines: [], orderId: sale.id });
      this.logger.log(`Pedido WhatsApp creado: #${sale.id} (tenant ${context.tenantId})`);
      return {
        order_id: sale.id,
        total: sale.grand_total,
        status: sale.status,
        items: summary.lines,
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
