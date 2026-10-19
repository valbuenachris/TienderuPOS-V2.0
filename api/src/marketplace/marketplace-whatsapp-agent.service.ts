import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouterClient } from '../ai/openrouter.client';
import { todayInTimeZone } from '../common/timezone';
import { DatabaseService } from '../database/database.service';
import { EvolutionClient } from '../whatsapp/evolution.client';
import { MarketplaceCatalogService } from './marketplace-catalog.service';
import { MarketplaceCustomersService } from './marketplace-customers.service';
import { MarketplaceOrdersService } from './marketplace-orders.service';
import { MarketplaceSettingsService } from './marketplace-settings.service';
import {
  MarketplaceDraftLine,
  MarketplaceDraftProduct,
  buildDraftSummary,
  mergeDraftLines,
  parseDraftItems
} from './marketplace-whatsapp-draft';

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

export const MARKETPLACE_WHATSAPP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Busca productos en TODO el marketplace (varias tiendas) por nombre. Devuelve id, nombre, precio final, vendedor, stock y calificación. Usar siempre antes de hablar de precios o disponibilidad.',
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
        'Resumen del marketplace: total de productos, categorías principales y 3 productos de ejemplo (nombre, precio, vendedor). Usar SIEMPRE para "¿qué venden?" y para ofrecer opciones cuando el cliente no sabe qué buscar.',
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
      description:
        'Ficha de un producto del marketplace: precio final, vendedor, stock, categoría y detalles para recomendarlo mejor.',
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
        'Agrega productos al pedido en curso (pueden ser de varias tiendas; el servidor guarda el borrador y calcula el total con envío). Devuelve SIEMPRE el resumen completo. Úsalo cada vez que el cliente pida productos, aunque sea parcial.',
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
      description: 'Quita un producto del pedido en curso y devuelve el resumen actualizado.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'Id del producto' }
        },
        required: ['product_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_order_draft',
      description: 'Resumen actual del pedido en curso (ítems, envío y total). Úsalo para repasar antes de confirmar.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description:
        'Crea el pedido REAL cuando el cliente ya confirmó los ítems y el total. Antes necesitas la dirección de entrega: pide nombre de quien recibe, dirección (calle/número), ciudad y barrio/indicaciones opcionales. Si el cliente pide usar "la misma dirección de siempre", llama SIN street_address y el servidor reutiliza la guardada (si no existe devolverá error y deberás pedirla). Devuelve el número de pedido, el total y el link de pago (o contraentrega).',
      parameters: {
        type: 'object',
        properties: {
          recipient_name: { type: 'string', description: 'Nombre de quien recibe (opcional; default: nombre del cliente)' },
          street_address: { type: 'string', description: 'Dirección de entrega (calle, número, apto). Omitir solo si el cliente pide reusar la guardada.' },
          neighborhood: { type: 'string', description: 'Barrio (opcional)' },
          city: { type: 'string', description: 'Ciudad (default Bogotá)' },
          notes: { type: 'string', description: 'Indicaciones adicionales (opcional)' },
          phone: { type: 'string', description: 'Teléfono de contacto para la entrega (opcional; default: el de esta conversación)' },
          items: {
            type: 'array',
            maxItems: 20,
            description: 'Opcional: ítems a sumar al borrador antes de crear el pedido',
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
        'Pasa la conversación a un asesor humano del marketplace. Usar SOLO si el cliente pide una persona, presenta un reclamo o es un caso irresoluble.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

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

function formatMoneyCOP(value: number | string | null | undefined): string {
  return `$${Number(value ?? 0).toLocaleString('es-CO')}`;
}

type IncomingInput = {
  instanceName: string;
  agentName: string;
  agentTone: string;
  phone: string;
  pushName: string | null;
  text: string | null;
  messageId: string | null;
};

type AgentContext = {
  phone: string;
  pushName: string | null;
  humanRequested: boolean;
};

/**
 * Chatbot de ventas del marketplace (v0.12.0): atiende por la instancia de
 * WhatsApp de la plataforma, busca en TODO el catálogo (multi-vendedor), arma el
 * pedido y lo crea con el checkout real del marketplace (stock, sub-órdenes,
 * envío y link Bold o contraentrega). El comprador se crea/encuentra por teléfono.
 */
@Injectable()
export class MarketplaceWhatsappAgentService {
  private readonly logger = new Logger(MarketplaceWhatsappAgentService.name);
  private readonly busyConversations = new Set<string>();
  private readonly rateWindow = new Map<string, number[]>();
  private readonly orderState = new Map<string, { lines: MarketplaceDraftLine[]; at: number }>();

  constructor(
    private readonly client: EvolutionClient,
    private readonly openRouter: OpenRouterClient,
    private readonly catalog: MarketplaceCatalogService,
    private readonly orders: MarketplaceOrdersService,
    private readonly customers: MarketplaceCustomersService,
    private readonly settings: MarketplaceSettingsService,
    private readonly database: DatabaseService,
    private readonly config: ConfigService
  ) {}

  async handleIncoming(input: IncomingInput): Promise<void> {
    const lockKey = input.phone;
    if (this.busyConversations.has(lockKey)) {
      this.logger.log(`Bot marketplace: conversación ocupada (${lockKey}); mensaje ignorado`);
      return;
    }
    if (!this.withinRateLimit(lockKey)) {
      this.logger.warn(`Bot marketplace: límite de mensajes alcanzado (${lockKey})`);
      return;
    }

    this.busyConversations.add(lockKey);
    try {
      await this.processMessage(input);
    } catch (error: unknown) {
      this.logger.error(
        `Bot marketplace falló (${lockKey}): ${error instanceof Error ? error.message : 'unknown'}`
      );
      try {
        await this.sendReply(
          input,
          'En este momento no puedo procesar tu mensaje, pero un asesor de tienderu.com te contactará muy pronto. 🙌'
        );
        await this.setConversationStatus(input.phone, 'human');
      } catch (notifyError: unknown) {
        this.logger.error(
          `Bot marketplace: tampoco se pudo enviar el fallback: ${notifyError instanceof Error ? notifyError.message : 'unknown'}`
        );
      }
    } finally {
      this.busyConversations.delete(lockKey);
    }
  }

  private async processMessage(input: IncomingInput): Promise<void> {
    // Dedup: Evolution reintenta webhooks; el índice único actúa de candado.
    const inserted = await this.database.query<{ id: number }>(
      `INSERT INTO public.tec_marketplace_whatsapp_messages (phone, direction, message_id, body)
       VALUES ($1, 'in', $2, $3)
       ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [input.phone, input.messageId, input.text]
    );
    if (input.messageId !== null && inserted.rowCount === 0) return;

    const conversation = await this.upsertConversation(input);
    if (conversation.status === 'human') {
      // Auto-retorno: si el personal no responde hace rato (o el cliente pide el bot), el asistente vuelve.
      const idle = await this.staffIdleMs(input.phone);
      const asksForBot = /\b(bot|asistente)\b/i.test(input.text ?? '');
      if (!asksForBot && idle < HANDOFF_IDLE_MS) return; // un humano está atendiendo
      await this.setConversationStatus(input.phone, 'bot');
      this.logger.log(`Bot marketplace: conversación vuelve al bot (${input.phone})`);
    }

    if (input.text === null) {
      await this.sendReply(
        input,
        'Por ahora solo puedo leer mensajes de texto 🙏. ¿Qué producto del marketplace buscas?'
      );
      return;
    }

    const key = this.openRouter.apiKey();
    if (key === null) throw new Error('OPENROUTER_API_KEY no configurada');

    const history = await this.loadHistory(input.phone);
    const system = await this.buildSystemPrompt(input);
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: system },
      ...history.map((message) => ({
        role: message.direction === 'in' ? 'user' : 'assistant',
        content: message.body ?? ''
      }))
    ];

    const context: AgentContext = {
      phone: input.phone,
      pushName: input.pushName,
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
        tools: MARKETPLACE_WHATSAPP_TOOLS,
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
      const summary = await this.buildSummary(context.phone);
      if (summary.lines.length > 0) {
        const lines = summary.lines
          .map((line) => `• ${line.name} × ${line.quantity} = ${formatMoneyCOP(line.subtotal)}`)
          .join('\n');
        reply = `Perdón 🙏, ¿te confirmo el pedido?\n${lines}\nEnvío: ${formatMoneyCOP(summary.shipping)}\n*Total:* ${formatMoneyCOP(summary.total)}`;
      } else {
        reply = 'Perdón 🙏, ¿me repites por favor qué productos buscas?';
      }
    }

    await this.sendReply(input, reply);
    if (context.humanRequested) {
      await this.setConversationStatus(input.phone, 'human');
      this.logger.log(`Bot marketplace: conversación pasa a humano (${input.phone})`);
    }
  }

  private async upsertConversation(input: IncomingInput): Promise<{ status: string; pushName: string | null }> {
    const result = await this.database.query<{ status: string | null; push_name: string | null }>(
      `INSERT INTO public.tec_marketplace_whatsapp_conversations (phone, push_name, status, last_message_at)
       VALUES ($1, $2, 'bot', now())
       ON CONFLICT (phone) DO UPDATE SET
         push_name = COALESCE(EXCLUDED.push_name, public.tec_marketplace_whatsapp_conversations.push_name),
         last_message_at = now()
       RETURNING status, push_name`,
      [input.phone, input.pushName?.slice(0, 120) ?? null]
    );
    return { status: result.rows[0]?.status ?? 'bot', pushName: result.rows[0]?.push_name ?? null };
  }

  private async setConversationStatus(phone: string, status: string): Promise<void> {
    await this.database.query(
      `UPDATE public.tec_marketplace_whatsapp_conversations
       SET status = $2, last_message_at = now()
       WHERE phone = $1`,
      [phone, status]
    );
  }

  /** Milisegundos desde la última respuesta del PERSONAL (fromMe); Infinity si nunca respondió. */
  private async staffIdleMs(phone: string): Promise<number> {
    const result = await this.database.query<{ at_ms: string }>(
      `SELECT (EXTRACT(EPOCH FROM created_at) * 1000)::bigint::text AS at_ms
       FROM public.tec_marketplace_whatsapp_messages
       WHERE phone = $1 AND direction = 'out' AND message_id IS NOT NULL
       ORDER BY id DESC
       LIMIT 1`,
      [phone]
    );
    const last = result.rows[0]?.at_ms;
    if (!last) return Number.POSITIVE_INFINITY;
    const at = Number(last);
    return Number.isFinite(at) ? Date.now() - at : Number.POSITIVE_INFINITY;
  }

  /** Registra un mensaje enviado por el personal desde el teléfono (fromMe) para pausar al bot. */
  async recordStaffMessage(input: {
    phone: string;
    messageId: string | null;
    text: string | null;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO public.tec_marketplace_whatsapp_messages (phone, direction, message_id, body)
       VALUES ($1, 'out', $2, $3)
       ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
      [input.phone, input.messageId, input.text]
    );
    await this.database.query(
      `UPDATE public.tec_marketplace_whatsapp_conversations SET last_message_at = now() WHERE phone = $1`,
      [input.phone]
    );
  }

  private async loadHistory(phone: string): Promise<Array<{ direction: string; body: string | null }>> {
    const result = await this.database.query<{ direction: string; body: string | null }>(
      `SELECT direction, body
       FROM public.tec_marketplace_whatsapp_messages
       WHERE phone = $1
       ORDER BY id DESC
       LIMIT $2`,
      [phone, HISTORY_LIMIT]
    );
    return result.rows.reverse();
  }

  private async buildSystemPrompt(input: IncomingInput): Promise<string> {
    const tz = (this.config.get<string>('POS_TIMEZONE') ?? 'America/Bogota').trim() || 'America/Bogota';
    const today = todayInTimeZone(tz);
    const tone = TONE_INSTRUCTIONS[input.agentTone] ?? TONE_INSTRUCTIONS.amable;

    return [
      `Eres ${input.agentName}, asesor de ventas de tienderu.com (el marketplace en línea donde varias tiendas de la ciudad venden sus productos). Hoy es ${today} (zona horaria ${tz}).`,
      `Estilo: ${tone}`,
      'REGLAS:',
      '1) Respuestas breves (máximo 5 líneas) en texto plano para WhatsApp (usa *negritas* con moderación).',
      '2) Nunca inventes precios, stock, vendedores ni características: usa SIEMPRE las herramientas y responde solo con lo que devuelvan.',
      '2b) Los productos son de VARIOS vendedores: menciona el vendedor cuando aporte contexto (ej. "lo vende X").',
      '2c) Para "¿qué venden?" usa get_catalog_overview (categorías + 3 productos de ejemplo).',
      '2d) NUNCA muestres al cliente ids, códigos internos ni nombres de herramientas. Habla como un asesor humano.',
      '3) El pedido en curso vive en el SERVIDOR: agrega cada producto que pida el cliente con add_to_order (aunque sea parcial) y repasa con get_order_draft. NUNCA calcules totales tú: usa los del servidor (incluyen el envío).',
      '4) Antes de crear el pedido, resume los ítems, el envío y el total EXACTOS devueltos por el servidor y pide confirmación explícita.',
      '5) Solo usa create_order cuando el cliente confirme. Antes necesitas la dirección de entrega: pide nombre de quien recibe, dirección (calle/número/apto), ciudad y barrio o indicaciones si aplica. Si el cliente dice que use "la misma dirección de siempre", llama create_order SIN street_address y el servidor reutilizará la guardada (si no existe devolverá error y deberás pedirla). NUNCA inventes direcciones.',
      '6) Después de create_order comparte el número de pedido y el total. Si el resultado trae link de pago, compártelo tal cual (pago seguro con tarjeta/PSE); si es contraentrega, avisa que paga en efectivo al recibir. El seguimiento del pedido llega por este mismo chat.',
      '7) Usa request_human SOLO si el cliente pide una persona, presenta un reclamo o es un caso que no puedes resolver. Para temas fuera del marketplace, responde breve y redirige al catálogo. Si pasas a humano, avisa que un asesor continuará y que puede escribir *bot* para volver al asistente.',
      '8) Si una herramienta falla o no hay datos, discúlpate y pide reformular; nunca dejes la conversación sin respuesta.'
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
          result = await this.searchProducts(readString(args.query), args.limit);
          break;
        case 'get_catalog_overview':
          result = await this.catalogOverview(args.sample_size);
          break;
        case 'get_product_details':
          result = await this.productDetails(args.product_id);
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
              'Un asesor de tienderu.com continuará la conversación. Si el cliente prefiere seguir con el asistente automático, dile que escriba *bot*.'
          };
          break;
        default:
          result = { error: `Herramienta desconocida: ${name}` };
      }
      this.logger.log(
        `Bot marketplace herramienta ${name} phone=${context.phone} args=${rawArguments.slice(0, 120)} -> ${summarizeToolResult(result)}`
      );
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'La herramienta falló';
      this.logger.warn(`Bot marketplace herramienta ${name} phone=${context.phone} falló: ${message}`);
      return { error: message };
    }
  }

  private async searchProducts(query: string | null, rawLimit: unknown) {
    if (query === null || query.length < 2) return { error: 'query debe tener al menos 2 caracteres' };
    const limit =
      typeof rawLimit === 'number' && Number.isSafeInteger(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), 10)
        : 5;
    const page = await this.catalog.listProducts(
      { q: query.slice(0, 100), sort: 'relevance' },
      { page: 1, limit, offset: 0 }
    );
    if (page.data.length === 0) {
      return {
        products: [],
        hint: 'Sin resultados para esa palabra; intenta en singular/plural o llama get_catalog_overview para ver categorías y productos disponibles.'
      };
    }
    return {
      products: page.data.map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        seller: product.seller.name,
        stock: product.available_quantity,
        rating: product.average_rating
      }))
    };
  }

  /** "¿Qué venden?": total, categorías principales y productos de ejemplo con stock. */
  private async catalogOverview(rawSampleSize: unknown) {
    const sampleSize =
      typeof rawSampleSize === 'number' && Number.isSafeInteger(rawSampleSize)
        ? Math.min(Math.max(rawSampleSize, 3), 5)
        : 3;

    const [totalPage, samplePage, categories] = await Promise.all([
      this.catalog.listProducts({ sort: 'relevance' }, { page: 1, limit: 1, offset: 0 }),
      this.catalog.listProducts({ sort: 'newest' }, { page: 1, limit: sampleSize, offset: 0 }),
      this.catalog.listCategories()
    ]);

    return {
      total_products: totalPage.meta.total,
      categories: categories.slice(0, 12),
      sample_products: samplePage.data.map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        seller: product.seller.name
      }))
    };
  }

  private async productDetails(rawId: unknown) {
    if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId) || rawId < 1) {
      return { error: 'product_id es obligatorio' };
    }
    try {
      const product = await this.catalog.getProduct(rawId);
      return {
        product: {
          id: product.id,
          name: product.name,
          price: product.price,
          details: product.details,
          seller: product.seller.name,
          stock: product.available_quantity,
          rating: product.average_rating,
          category: product.category_name
        }
      };
    } catch (_error: unknown) {
      return { error: 'Producto no encontrado o no disponible en el marketplace' };
    }
  }

  // ===== Pedido en curso (borrador por conversación) =====

  private getDraftLines(phone: string): MarketplaceDraftLine[] {
    const entry = this.orderState.get(phone);
    if (!entry) return [];
    if (Date.now() - entry.at > DRAFT_TTL_MS) {
      this.orderState.delete(phone);
      return [];
    }
    entry.at = Date.now();
    return entry.lines;
  }

  private saveDraftLines(phone: string, lines: MarketplaceDraftLine[]): void {
    if (lines.length === 0) this.orderState.delete(phone);
    else this.orderState.set(phone, { lines, at: Date.now() });
    if (this.orderState.size > 2000) {
      const now = Date.now();
      for (const [entryKey, value] of this.orderState) {
        if (now - value.at > DRAFT_TTL_MS) this.orderState.delete(entryKey);
      }
    }
  }

  /** Productos publicados en el marketplace (por id) con datos de precio/stock/vendedor. */
  private async loadDraftProducts(ids: number[]): Promise<Map<number, MarketplaceDraftProduct>> {
    const map = new Map<number, MarketplaceDraftProduct>();
    if (ids.length === 0) return map;
    const result = await this.database.query<{
      id: number;
      name: string | null;
      base_price: string | null;
      tax: string | null;
      stock: number | null;
      seller: string | null;
      markup_percent: string;
      type: string | null;
    }>(
      `SELECT p.id, p.name, p.price::text AS base_price, p.tax::text AS tax, p.quantity AS stock,
              COALESCE(NULLIF(TRIM(mk.store_display_name), ''), t.name) AS seller,
              mk.markup_percent::text AS markup_percent, p.type
       FROM public.tec_products p
       JOIN public.tec_tenants t ON t.id = p.tenant_id AND t.status = 'active'
       JOIN public.tec_marketplace_settings mk ON mk.tenant_id = p.tenant_id AND mk.enabled = true
       WHERE p.id = ANY($1::int[])`,
      [ids]
    );
    for (const row of result.rows) {
      if (row.type === 'combo' || row.base_price === null) continue;
      map.set(row.id, {
        id: row.id,
        name: row.name,
        basePrice: row.base_price,
        tax: row.tax ?? '0',
        markupPercent: row.markup_percent,
        seller: row.seller ?? 'Tienda',
        stock: row.stock ?? 0
      });
    }
    return map;
  }

  private async buildSummary(phone: string) {
    const lines = this.getDraftLines(phone);
    const products = await this.loadDraftProducts(lines.map((line) => line.productId));
    return buildDraftSummary(lines, products, this.settings.shippingFlatValue());
  }

  private async addToOrder(context: AgentContext, args: Record<string, unknown>) {
    const parsedItems = parseDraftItems(args.items);
    if (typeof parsedItems === 'string') return { error: parsedItems };

    const products = await this.loadDraftProducts([
      ...new Set(parsedItems.map((item) => item.product_id))
    ]);
    for (const item of parsedItems) {
      const product = products.get(item.product_id);
      if (!product) return { error: `El producto ${item.product_id} no está disponible en el marketplace` };
      if (product.stock < item.quantity) {
        return {
          error: `Sin stock suficiente de ${product.name ?? `#${item.product_id}`} (disponibles: ${product.stock})`
        };
      }
    }

    const merged = mergeDraftLines(this.getDraftLines(context.phone), parsedItems);
    if (merged.error !== null) return { error: merged.error };
    this.saveDraftLines(context.phone, merged.lines);

    const summary = buildDraftSummary(merged.lines, products, this.settings.shippingFlatValue());
    return {
      draft: summary.lines,
      shipping: summary.shipping,
      total: summary.total,
      ...(summary.warnings.length > 0 ? { warnings: summary.warnings } : {}),
      message: 'Resumen actualizado del pedido en curso. Pide confirmación al cliente antes de create_order.'
    };
  }

  private async removeFromOrder(context: AgentContext, args: Record<string, unknown>) {
    const productId =
      typeof args.product_id === 'number' && Number.isSafeInteger(args.product_id) && args.product_id > 0
        ? args.product_id
        : null;
    if (productId === null) return { error: 'product_id es obligatorio' };

    const lines = this.getDraftLines(context.phone).filter((line) => line.productId !== productId);
    this.saveDraftLines(context.phone, lines);
    const summary = await this.buildSummary(context.phone);
    return { draft: summary.lines, shipping: summary.shipping, total: summary.total, message: 'Producto quitado del pedido en curso.' };
  }

  private async getOrderDraft(context: AgentContext) {
    const summary = await this.buildSummary(context.phone);
    return { draft: summary.lines, shipping: summary.shipping, total: summary.total, warnings: summary.warnings };
  }

  private async createOrder(context: AgentContext, args: Record<string, unknown>) {
    // Compatibilidad: si el modelo envía items aquí, se suman al borrador primero.
    if (Array.isArray(args.items) && args.items.length > 0) {
      const merged = await this.addToOrder(context, args);
      if (isRecord(merged) && merged.error !== undefined) return merged;
    }

    const summary = await this.buildSummary(context.phone);
    if (summary.lines.length === 0) {
      return { error: 'No hay productos en el pedido; usa add_to_order con los productos que pida el cliente.' };
    }
    if (summary.warnings.length > 0) {
      return { error: `Ajusta el pedido antes de crearlo: ${summary.warnings.join(' ')}` };
    }

    try {
      const customer = await this.customers.ensureWhatsappCustomer(context.phone, context.pushName);

      const street = readString(args.street_address);
      let addressId: number | null = null;
      if (street !== null) {
        if (street.length < 5) {
          return { error: 'La dirección parece incompleta; pide calle/número/apto al cliente.' };
        }
        const recipient = readString(args.recipient_name) ?? customer.name ?? 'Cliente WhatsApp';
        const createdAddress = await this.customers.createAddress(customer.id, {
          recipient_name: recipient.slice(0, 120),
          label: 'Otro',
          street_address: street.slice(0, 200),
          neighborhood: readString(args.neighborhood)?.slice(0, 120),
          city: readString(args.city)?.slice(0, 80),
          phone: readString(args.phone) ?? context.phone,
          additional_notes: readString(args.notes)?.slice(0, 300)
        });
        addressId = createdAddress.id;
      } else {
        const existing = await this.customers.defaultAddress(customer.id);
        if (!existing) {
          return {
            error:
              'Falta la dirección de entrega: pide al cliente nombre de quien recibe, dirección (calle/número/apto) y ciudad; luego vuelve a llamar create_order con esos datos.'
          };
        }
        addressId = existing.id;
      }

      const paymentMethod = this.settings.paymentEnabled() ? 'bold' : 'cash';
      const order = await this.orders.checkout(
        { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
        {
          items: summary.lines.map((line) => ({ product_id: line.product_id, quantity: line.quantity })),
          address_id: addressId,
          payment_method: paymentMethod
        }
      );

      this.saveDraftLines(context.phone, []);
      this.logger.log(`Pedido WhatsApp del marketplace creado: ${order.order_number} (${context.phone})`);

      return {
        order_id: order.id,
        order_number: order.order_number,
        total: order.grand_total,
        payment_method: order.payment_method,
        payment_url: order.payment_url,
        status: order.status,
        items: summary.lines,
        message:
          order.payment_method === 'cash'
            ? 'Pedido creado en contraentrega: el cliente paga en efectivo al recibir. Confirma número de pedido y total.'
            : order.payment_url !== null
              ? 'Pedido creado. Comparte el link de pago TAL CUAL y pide al cliente completar el pago para confirmarlo.'
              : 'Pedido creado pero el link de pago no se pudo generar; avisa que un asesor lo contactará para completar el pago.'
      };
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : 'No se pudo crear el pedido' };
    }
  }

  private async sendReply(input: IncomingInput, text: string): Promise<void> {
    const trimmed = text.trim().slice(0, 2000);
    await this.client.sendText(input.instanceName, input.phone, trimmed);
    await this.database.query(
      `INSERT INTO public.tec_marketplace_whatsapp_messages (phone, direction, message_id, body)
       VALUES ($1, 'out', NULL, $2)`,
      [input.phone, trimmed]
    );
    await this.database.query(
      `UPDATE public.tec_marketplace_whatsapp_conversations SET last_message_at = now() WHERE phone = $1`,
      [input.phone]
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
