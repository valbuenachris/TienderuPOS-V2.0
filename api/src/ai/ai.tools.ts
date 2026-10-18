import { Injectable } from '@nestjs/common';
import { daysAgoInTimeZone, todayInTimeZone } from '../common/timezone';
import { TenantTimezoneService } from '../common/tenant-timezone.service';
import { DatabaseService } from '../database/database.service';
import { ReportsService } from '../reports/reports.service';

/** Definiciones de herramientas (formato OpenAI function calling). */
export const AI_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_report_summary',
      description:
        'Totales del período: ventas (conteo, subtotal, total, pagado, pendiente), compras, gastos y ganancia neta. Usar para "cuánto vendí/gané". Sin fechas usa los últimos 7 días.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          to: { type: 'string', description: 'Fecha final YYYY-MM-DD (inclusive)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_top_products',
      description: 'Productos más vendidos del período (cantidad y monto vendido). Usar para "producto más vendido".',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (default: últimos 7 días)' },
          to: { type: 'string', description: 'Fecha final YYYY-MM-DD (inclusive)' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Máximo de productos' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_sales_calendar',
      description: 'Ventas, compras, gastos y ganancia agrupados por día o por mes dentro de un rango.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          to: { type: 'string', description: 'Fecha final YYYY-MM-DD (inclusive)' },
          group: { type: 'string', enum: ['day', 'month'], description: 'Agrupación' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_low_stock',
      description: 'Productos con stock bajo o agotado (para sugerir pedidos de reposición).',
      parameters: {
        type: 'object',
        properties: {
          threshold: { type: 'integer', minimum: 0, maximum: 1000000, description: 'Umbral de stock (default 5)' },
          limit: { type: 'integer', minimum: 1, maximum: 30, description: 'Máximo de productos' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_customers',
      description:
        'Busca clientes por nombre, correo o teléfono. Devuelve id, nombre, teléfono, correo, puntos y tienda. Usar SIEMPRE antes de get_customer_summary.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar (mínimo 2 caracteres)' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Máximo de clientes' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_summary',
      description:
        'Ficha de un cliente: puntos, compras históricas pagadas/parciales, DEUDA pendiente (ventas por cobrar) y últimas 5 ventas. Requiere el id que devuelve search_customers.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'integer', minimum: 1, description: 'Id del cliente (de search_customers)' }
        },
        required: ['customer_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_top_customers',
      description:
        'Ranking de clientes por monto comprado en un período (nombre, teléfono, número de compras y total). Usar para "qué cliente compra más". Sin fechas usa los últimos 30 días.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          to: { type: 'string', description: 'Fecha final YYYY-MM-DD (inclusive)' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Máximo de clientes (default 10)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_products',
      description: 'Busca productos por nombre o código. Devuelve precio, costo, stock y categoría. Usar para ubicar un producto antes de get_product_performance.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto a buscar (mínimo 2 caracteres)' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Máximo de productos' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_product_performance',
      description:
        'Desempeño de un producto en un rango: unidades vendidas, ingresos, stock actual y margen unitario (precio − costo). Sin fechas usa los últimos 30 días.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1, description: 'Id del producto (de search_products)' },
          from: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          to: { type: 'string', description: 'Fecha final YYYY-MM-DD (inclusive)' }
        },
        required: ['product_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_sales_by_category',
      description: 'Ventas agrupadas por categoría (unidades y monto). Útil para saber qué líneas de producto rinden más. Sin fechas usa los últimos 30 días.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          to: { type: 'string', description: 'Fecha final YYYY-MM-DD (inclusive)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_sales_by_hour',
      description: 'Ventas e ingresos por hora del día (para identificar horas pico y planear personal). Sin fechas usa los últimos 7 días.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Fecha inicial YYYY-MM-DD' },
          to: { type: 'string', description: 'Fecha final YYYY-MM-DD (inclusive)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_open_accounts',
      description: 'Cuentas abiertas por cobrar (mesas/clientes): etiqueta, total, pagado, pendiente y total global. Usar para "cuánto tengo por cobrar".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Máximo de cuentas (default 20)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_dead_stock',
      description:
        'Productos con stock disponible y CERO ventas en los últimos N días (stock sin movimiento). Usar para "qué no se vende" y liberar inventario. Default 30 días.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 7, maximum: 365, description: 'Días sin ventas (default 30)' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Máximo de productos (default 15)' }
        },
        required: []
      }
    }
  }
];

const CACHE_MS = 30000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDate(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function readInt(record: Record<string, unknown>, key: string, min: number, max: number, fallback: number): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

type Range = { from: string; to: string; tz: string };

@Injectable()
export class AiToolsService {
  private readonly cache = new Map<string, { value: unknown; at: number }>();

  constructor(
    private readonly database: DatabaseService,
    private readonly reports: ReportsService,
    private readonly timezone: TenantTimezoneService
  ) {}

  /** Caché corta para agregados pesados (evita golpear la BD si el modelo repite la consulta). */
  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
    const value = await loader();
    if (this.cache.size > 200) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  private async resolveRange(
    tenantId: string,
    args: Record<string, unknown>,
    defaultDaysAgo: number
  ): Promise<Range> {
    const tz = await this.timezone.forTenant(tenantId);
    const to = readDate(args, 'to') ?? todayInTimeZone(tz);
    const from = readDate(args, 'from') ?? daysAgoInTimeZone(tz, defaultDaysAgo);
    return { from, to, tz };
  }

  /** Ejecuta una herramienta del modelo con scope SIEMPRE del tenant del token. */
  async execute(tenantId: string, name: string, rawArguments: string): Promise<unknown> {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(rawArguments || '{}');
      if (isRecord(parsed)) args = parsed;
    } catch (_error: unknown) {
      args = {};
    }

    try {
      switch (name) {
        case 'get_report_summary': {
          const from = readDate(args, 'from');
          const to = readDate(args, 'to');
          return await this.cached(`summary:${tenantId}:${from ?? ''}:${to ?? ''}`, () =>
            this.reports.summary(tenantId, from, to)
          );
        }
        case 'get_top_products': {
          const from = readDate(args, 'from');
          const to = readDate(args, 'to');
          const limit = readInt(args, 'limit', 1, 20, 10);
          return await this.cached(`top:${tenantId}:${from ?? ''}:${to ?? ''}:${limit}`, () =>
            this.reports.topProducts(tenantId, from, to, limit)
          );
        }
        case 'get_sales_calendar': {
          const from = readDate(args, 'from');
          const to = readDate(args, 'to');
          return await this.reports.calendar(tenantId, from, to, args.group === 'month' ? 'month' : 'day');
        }
        case 'get_low_stock':
          return await this.lowStock(
            tenantId,
            readInt(args, 'threshold', 0, 1000000, 5),
            readInt(args, 'limit', 1, 30, 10)
          );
        case 'search_customers':
          return await this.searchCustomers(
            tenantId,
            readString(args, 'query'),
            readInt(args, 'limit', 1, 20, 10)
          );
        case 'get_customer_summary':
          return await this.customerSummary(tenantId, readInt(args, 'customer_id', 1, 2147483647, 0));
        case 'get_top_customers': {
          const range = await this.resolveRange(tenantId, args, 30);
          if (range.from > range.to) return { error: 'La fecha inicial es mayor que la final' };
          const limit = readInt(args, 'limit', 1, 20, 10);
          return await this.cached(`topcustomers:${tenantId}:${range.from}:${range.to}:${limit}`, () =>
            this.topCustomers(tenantId, range, limit)
          );
        }
        case 'search_products':
          return await this.searchProducts(
            tenantId,
            readString(args, 'query'),
            readInt(args, 'limit', 1, 20, 15)
          );
        case 'get_product_performance':
          return await this.productPerformance(
            tenantId,
            readInt(args, 'product_id', 1, 2147483647, 0),
            args
          );
        case 'get_sales_by_category': {
          const range = await this.resolveRange(tenantId, args, 30);
          if (range.from > range.to) return { error: 'La fecha inicial es mayor que la final' };
          return await this.cached(`category:${tenantId}:${range.from}:${range.to}`, () =>
            this.salesByCategory(tenantId, range)
          );
        }
        case 'get_sales_by_hour': {
          const range = await this.resolveRange(tenantId, args, 7);
          if (range.from > range.to) return { error: 'La fecha inicial es mayor que la final' };
          return await this.cached(`hour:${tenantId}:${range.from}:${range.to}`, () =>
            this.salesByHour(tenantId, range)
          );
        }
        case 'get_open_accounts':
          return await this.openAccounts(tenantId, readInt(args, 'limit', 1, 50, 20));
        case 'get_dead_stock':
          return await this.deadStock(
            tenantId,
            readInt(args, 'days', 7, 365, 30),
            readInt(args, 'limit', 1, 50, 15)
          );
        default:
          return { error: `Herramienta desconocida: ${name}` };
      }
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : 'La herramienta falló' };
    }
  }

  private async lowStock(tenantId: string, threshold: number, limit: number) {
    const result = await this.database.query<{
      id: number;
      code: string | null;
      name: string | null;
      quantity: number | null;
      price: string | null;
    }>(
      `SELECT id, code, name, COALESCE(quantity, 0) AS quantity, price::text AS price
       FROM public.tec_products
       WHERE tenant_id = $1 AND COALESCE(quantity, 0) <= $2
       ORDER BY COALESCE(quantity, 0) ASC, name ASC
       LIMIT $3`,
      [tenantId, threshold, limit]
    );
    return result.rows;
  }

  private async searchCustomers(tenantId: string, query: string | null, limit: number) {
    if (query === null || query.length < 2) return { error: 'query debe tener al menos 2 caracteres' };
    const pattern = `%${escapeLike(query.slice(0, 100))}%`;
    const result = await this.database.query<{
      id: number;
      name: string | null;
      phone: string | null;
      email: string | null;
      points_balance: number;
      store_id: number | null;
    }>(
      `SELECT id, name, phone, email, COALESCE(points_balance, 0) AS points_balance, store_id
       FROM public.tec_customers
       WHERE tenant_id = $1 AND (name ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
       ORDER BY name ASC
       LIMIT $3`,
      [tenantId, pattern, limit]
    );
    return result.rows;
  }

  private async customerSummary(tenantId: string, customerId: number) {
    if (customerId === 0) return { error: 'customer_id es obligatorio' };

    const customer = await this.database.query<{
      id: number;
      name: string | null;
      phone: string | null;
      email: string | null;
      points_balance: number;
    }>(
      `SELECT id, name, phone, email, COALESCE(points_balance, 0) AS points_balance
       FROM public.tec_customers
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [tenantId, customerId]
    );
    if (!customer.rows[0]) return { error: 'Cliente no encontrado en esta tienda' };

    const [purchases, pending, lastSales] = await Promise.all([
      this.database.query<{ purchases_count: number; total: string; last_purchase: string | null }>(
        `SELECT COUNT(*)::integer AS purchases_count,
                COALESCE(SUM(grand_total), 0)::text AS total,
                MAX(created_at)::text AS last_purchase
         FROM public.tec_sales
         WHERE tenant_id = $1 AND customer_id = $2 AND status IN ('paid', 'partial')`,
        [tenantId, customerId]
      ),
      this.database.query<{ pending_count: number; pending_total: string }>(
        `SELECT COUNT(*)::integer AS pending_count,
                COALESCE(SUM(grand_total - COALESCE(paid, 0)), 0)::text AS pending_total
         FROM public.tec_sales
         WHERE tenant_id = $1 AND customer_id = $2 AND status IN ('due', 'partial')`,
        [tenantId, customerId]
      ),
      this.database.query<{ id: number; grand_total: string | null; status: string | null; created_at: string | null }>(
        `SELECT id, grand_total::text AS grand_total, status, created_at::text AS created_at
         FROM public.tec_sales
         WHERE tenant_id = $1 AND customer_id = $2
         ORDER BY created_at DESC, id DESC
         LIMIT 5`,
        [tenantId, customerId]
      )
    ]);

    return {
      customer: customer.rows[0],
      purchases: purchases.rows[0] ?? null,
      pending: pending.rows[0] ?? null,
      last_sales: lastSales.rows
    };
  }

  private async topCustomers(tenantId: string, range: Range, limit: number) {
    const result = await this.database.query<{
      id: number;
      name: string | null;
      phone: string | null;
      sales_count: number;
      total: string;
    }>(
      `SELECT c.id, c.name, c.phone,
              COUNT(s.id)::integer AS sales_count,
              COALESCE(SUM(s.grand_total), 0)::text AS total
       FROM public.tec_sales s
       JOIN public.tec_customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1 AND s.customer_id IS NOT NULL
         AND s.created_at >= ($2::date::timestamp AT TIME ZONE $4)
         AND s.created_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE $4)
       GROUP BY c.id, c.name, c.phone
       ORDER BY SUM(s.grand_total) DESC NULLS LAST
       LIMIT $5`,
      [tenantId, range.from, range.to, range.tz, limit]
    );
    return { range: { from: range.from, to: range.to }, customers: result.rows };
  }

  private async searchProducts(tenantId: string, query: string | null, limit: number) {
    if (query === null || query.length < 2) return { error: 'query debe tener al menos 2 caracteres' };
    const pattern = `%${escapeLike(query.slice(0, 100))}%`;
    const result = await this.database.query<{
      id: number;
      code: string | null;
      name: string | null;
      price: string | null;
      cost: string | null;
      quantity: number | null;
      category: string | null;
    }>(
      `SELECT p.id, p.code, p.name, p.price::text AS price, p.cost::text AS cost,
              COALESCE(p.quantity, 0) AS quantity, c.name AS category
       FROM public.tec_products p
       LEFT JOIN public.tec_categories c
         ON c.tenant_id = p.tenant_id AND c.id::text = p.category_id::text
       WHERE p.tenant_id = $1 AND (p.name ILIKE $2 OR p.code ILIKE $2)
       ORDER BY p.name ASC
       LIMIT $3`,
      [tenantId, pattern, limit]
    );
    return result.rows;
  }

  private async productPerformance(tenantId: string, productId: number, args: Record<string, unknown>) {
    if (productId === 0) return { error: 'product_id es obligatorio' };

    const product = await this.database.query<{
      id: number;
      code: string | null;
      name: string | null;
      price: string | null;
      cost: string | null;
      quantity: number | null;
    }>(
      `SELECT id, code, name, price::text AS price, cost::text AS cost, COALESCE(quantity, 0) AS quantity
       FROM public.tec_products
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [tenantId, productId]
    );
    const row = product.rows[0];
    if (!row) return { error: 'Producto no encontrado en esta tienda' };

    const range = await this.resolveRange(tenantId, args, 30);
    if (range.from > range.to) return { error: 'La fecha inicial es mayor que la final' };

    const perf = await this.database.query<{ units: string; revenue: string; sales_count: number }>(
      `SELECT COALESCE(SUM(si.quantity), 0)::text AS units,
              COALESCE(SUM(si.subtotal), 0)::text AS revenue,
              COUNT(DISTINCT si.sale_id)::integer AS sales_count
       FROM public.tec_sale_items si
       JOIN public.tec_sales s ON s.id = si.sale_id AND s.tenant_id = si.tenant_id
       WHERE si.tenant_id = $1 AND si.product_id = $2
         AND s.created_at >= ($3::date::timestamp AT TIME ZONE $5)
         AND s.created_at < (($4::date + INTERVAL '1 day')::timestamp AT TIME ZONE $5)`,
      [tenantId, productId, range.from, range.to, range.tz]
    );

    const price = Number(row.price ?? 0);
    const cost = Number(row.cost ?? 0);
    return {
      product: row,
      range: { from: range.from, to: range.to },
      performance: perf.rows[0] ?? null,
      margin_per_unit: (price - cost).toFixed(2)
    };
  }

  private async salesByCategory(tenantId: string, range: Range) {
    const result = await this.database.query<{ category: string; units: string; revenue: string }>(
      `SELECT COALESCE(c.name, 'Sin categoría') AS category,
              COALESCE(SUM(si.quantity), 0)::text AS units,
              COALESCE(SUM(si.subtotal), 0)::text AS revenue
       FROM public.tec_sale_items si
       JOIN public.tec_sales s ON s.id = si.sale_id AND s.tenant_id = si.tenant_id
       LEFT JOIN public.tec_products p ON p.id = si.product_id AND p.tenant_id = si.tenant_id
       LEFT JOIN public.tec_categories c ON c.tenant_id = p.tenant_id AND c.id::text = p.category_id::text
       WHERE si.tenant_id = $1
         AND s.created_at >= ($2::date::timestamp AT TIME ZONE $4)
         AND s.created_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE $4)
       GROUP BY 1
       ORDER BY SUM(si.subtotal) DESC NULLS LAST
       LIMIT 15`,
      [tenantId, range.from, range.to, range.tz]
    );
    return { range: { from: range.from, to: range.to }, categories: result.rows };
  }

  private async salesByHour(tenantId: string, range: Range) {
    const result = await this.database.query<{ hour: string; sales_count: number; total: string }>(
      `SELECT TO_CHAR(created_at AT TIME ZONE $4, 'HH24') AS hour,
              COUNT(*)::integer AS sales_count,
              COALESCE(SUM(grand_total), 0)::text AS total
       FROM public.tec_sales
       WHERE tenant_id = $1
         AND created_at >= ($2::date::timestamp AT TIME ZONE $4)
         AND created_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE $4)
       GROUP BY 1
       ORDER BY 1`,
      [tenantId, range.from, range.to, range.tz]
    );
    return { range: { from: range.from, to: range.to }, hours: result.rows };
  }

  private async openAccounts(tenantId: string, limit: number) {
    const [list, totals] = await Promise.all([
      this.database.query<{
        id: number;
        customer_name: string | null;
        grand_total: string | null;
        paid: string | null;
        pending: string;
        status: string | null;
        created_at: string | null;
      }>(
        `SELECT id, customer_name, grand_total::text AS grand_total, paid::text AS paid,
                (grand_total - COALESCE(paid, 0))::text AS pending, status, created_at::text AS created_at
         FROM public.tec_sales
         WHERE tenant_id = $1 AND status IN ('due', 'partial')
         ORDER BY created_at ASC, id ASC
         LIMIT $2`,
        [tenantId, limit]
      ),
      this.database.query<{ accounts_count: number; pending_total: string }>(
        `SELECT COUNT(*)::integer AS accounts_count,
                COALESCE(SUM(grand_total - COALESCE(paid, 0)), 0)::text AS pending_total
         FROM public.tec_sales
         WHERE tenant_id = $1 AND status IN ('due', 'partial')`,
        [tenantId]
      )
    ]);
    return { accounts: list.rows, totals: totals.rows[0] ?? null };
  }

  private async deadStock(tenantId: string, days: number, limit: number) {
    const tz = await this.timezone.forTenant(tenantId);
    const from = daysAgoInTimeZone(tz, days);
    const result = await this.database.query<{
      id: number;
      code: string | null;
      name: string | null;
      quantity: number | null;
      price: string | null;
    }>(
      `SELECT p.id, p.code, p.name, COALESCE(p.quantity, 0) AS quantity, p.price::text AS price
       FROM public.tec_products p
       WHERE p.tenant_id = $1 AND COALESCE(p.quantity, 0) > 0
         AND NOT EXISTS (
           SELECT 1
           FROM public.tec_sale_items si
           JOIN public.tec_sales s ON s.id = si.sale_id AND s.tenant_id = si.tenant_id
           WHERE si.tenant_id = p.tenant_id AND si.product_id = p.id
             AND s.created_at >= ($2::date::timestamp AT TIME ZONE $4)
         )
       ORDER BY COALESCE(p.quantity, 0) DESC, p.name ASC
       LIMIT $3`,
      [tenantId, from, limit, tz]
    );
    return { since: from, days, products: result.rows };
  }
}
