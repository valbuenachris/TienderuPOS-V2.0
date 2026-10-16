import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { CatalogService } from '../catalog/catalog.service';
import { DatabaseService, SqlExecutor } from '../database/database.service';
import { ComboItemResponse, ComboLineInput, ComboResponse } from './combo.dto';

const PROBE_CACHE_MS = 60_000;
const MAX_COMBO_LINES = 20;
const MAX_COMBO_QUANTITY = 99;
const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;
const MIGRATION_HINT = 'Los combos no están disponibles: ejecuta la migración v0.3.76-add-combos.sql';

type ComboRow = {
  id: number;
  name: string;
  description: string | null;
  combo_price: string;
  original_price: string | null;
};

type ActiveComboRow = {
  id: number;
  is_active: boolean | null;
  combo_price: string;
};

type ComboItemRow = {
  combo_id: number;
  product_id: number;
  quantity: number | null;
  name: string | null;
  image: string | null;
};

type ComboItemLockRow = {
  combo_id: number;
  product_id: number;
  quantity: number | null;
};

export type ResolvedCombos = {
  components: Array<{ product_id: number; quantity: string }>;
  comboTotal: Decimal;
};

@Injectable()
export class CombosService {
  private readonly logger = new Logger(CombosService.name);
  private probe: { exists: boolean; at: number } | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly catalog: CatalogService
  ) {}

  private async tableProbe(executor: SqlExecutor): Promise<boolean> {
    const result = await executor.query<{ combos: string | null; items: string | null }>(
      `SELECT to_regclass('public.tec_combos')::text AS combos,
              to_regclass('public.tec_customer_combo_items')::text AS items`
    );
    const row = result.rows[0];
    return Boolean(row?.combos) && Boolean(row?.items);
  }

  private async tablesExist(): Promise<boolean> {
    const now = Date.now();
    if (this.probe && now - this.probe.at < PROBE_CACHE_MS) return this.probe.exists;
    const exists = await this.tableProbe(this.database);
    this.probe = { exists, at: now };
    return exists;
  }

  private formatMoney(value: string): string {
    return new Decimal(value).toDecimalPlaces(2, MONEY_ROUNDING).toFixed(2);
  }

  async listActive(tenantId: string): Promise<ComboResponse[]> {
    if (!(await this.tablesExist())) return [];

    const combos = await this.database.query<ComboRow>(
      `SELECT id, name, description, combo_price::text AS combo_price,
              original_price::text AS original_price
       FROM public.tec_combos
       WHERE tenant_id = $1 AND COALESCE(is_active, true) = true
       ORDER BY name ASC, id ASC
       LIMIT 100`,
      [tenantId]
    );
    if (combos.rows.length === 0) return [];

    const items = await this.database.query<ComboItemRow>(
      `SELECT ci.combo_id, ci.product_id, ci.quantity, p.name, p.image
       FROM public.tec_customer_combo_items ci
       JOIN public.tec_products p ON p.id = ci.product_id AND p.tenant_id = $2
       WHERE ci.combo_id = ANY($1::int[])
       ORDER BY ci.combo_id ASC, ci.id ASC`,
      [combos.rows.map((combo) => combo.id), tenantId]
    );

    const itemsByCombo = new Map<number, ComboItemResponse[]>();
    for (const item of items.rows) {
      const quantity = Math.trunc(Number(item.quantity ?? 1));
      if (!Number.isSafeInteger(quantity) || quantity < 1) continue;
      const list = itemsByCombo.get(item.combo_id) ?? [];
      list.push({
        product_id: item.product_id,
        name: item.name,
        image_url: this.catalog.resolveProductImageUrl(item.image),
        quantity
      });
      itemsByCombo.set(item.combo_id, list);
    }

    const response: ComboResponse[] = [];
    for (const combo of combos.rows) {
      const comboItems = itemsByCombo.get(combo.id);
      if (!comboItems || comboItems.length === 0) continue;
      response.push({
        id: combo.id,
        name: combo.name,
        description: combo.description,
        combo_price: this.formatMoney(combo.combo_price),
        original_price: combo.original_price === null ? null : this.formatMoney(combo.original_price),
        items: comboItems
      });
    }
    return response;
  }

  /**
   * Expande las líneas de combos de un checkout en sus productos componentes.
   * Se ejecuta dentro de la transacción de la venta; las cantidades quedan
   * agregadas por producto para reutilizar el pipeline de stock de SalesService.
   */
  async resolveCheckoutCombos(
    client: SqlExecutor,
    tenantId: string,
    lines: ComboLineInput[] | undefined
  ): Promise<ResolvedCombos | null> {
    if (!lines || lines.length === 0) return null;
    if (lines.length > MAX_COMBO_LINES) {
      throw new BadRequestException(`No se pueden pedir más de ${MAX_COMBO_LINES} combos por pedido`);
    }
    if (!(await this.tableProbe(client))) throw new ServiceUnavailableException(MIGRATION_HINT);

    const requested = new Map<number, number>();
    for (const line of lines) {
      const quantity = new Decimal(line.quantity);
      if (!quantity.isFinite() || !quantity.isInteger() || quantity.lte(0)) {
        throw new BadRequestException('La cantidad de un combo debe ser un entero positivo');
      }
      if (quantity.gt(MAX_COMBO_QUANTITY)) {
        throw new BadRequestException(`La cantidad máxima por combo es ${MAX_COMBO_QUANTITY}`);
      }
      const qty = quantity.toNumber();
      requested.set(line.combo_id, (requested.get(line.combo_id) ?? 0) + qty);
    }

    const comboIds = [...requested.keys()];
    const combos = await client.query<ActiveComboRow>(
      `SELECT id, COALESCE(is_active, true) AS is_active, combo_price::text AS combo_price
       FROM public.tec_combos
       WHERE tenant_id = $1 AND id = ANY($2::int[])
       FOR SHARE`,
      [tenantId, comboIds]
    );
    const byId = new Map(combos.rows.map((row) => [row.id, row]));
    for (const comboId of comboIds) {
      const combo = byId.get(comboId);
      if (!combo) throw new NotFoundException(`Combo ${comboId} no encontrado en esta tienda`);
      if (combo.is_active !== true) throw new BadRequestException(`El combo ${comboId} no está disponible`);
    }

    const items = await client.query<ComboItemLockRow>(
      `SELECT ci.combo_id, ci.product_id, ci.quantity
       FROM public.tec_customer_combo_items ci
       JOIN public.tec_products p ON p.id = ci.product_id AND p.tenant_id = $1
       WHERE ci.combo_id = ANY($2::int[])
       ORDER BY ci.combo_id ASC, ci.id ASC`,
      [tenantId, comboIds]
    );

    const componentQty = new Map<number, number>();
    const combosWithItems = new Set<number>();
    for (const item of items.rows) {
      const perCombo = Math.trunc(Number(item.quantity ?? 1));
      if (!Number.isSafeInteger(perCombo) || perCombo < 1) {
        throw new BadRequestException(`El combo ${item.combo_id} tiene una cantidad de producto inválida`);
      }
      combosWithItems.add(item.combo_id);
      const multiplier = requested.get(item.combo_id) ?? 0;
      const total = (componentQty.get(item.product_id) ?? 0) + perCombo * multiplier;
      if (!Number.isSafeInteger(total)) throw new BadRequestException('La cantidad del combo está fuera de rango');
      componentQty.set(item.product_id, total);
    }
    for (const comboId of comboIds) {
      if (!combosWithItems.has(comboId)) {
        throw new BadRequestException(`El combo ${comboId} no tiene productos configurados`);
      }
    }

    let comboTotal = new Decimal(0);
    for (const comboId of comboIds) {
      const combo = byId.get(comboId);
      if (!combo) continue;
      const price = new Decimal(combo.combo_price);
      if (!price.isFinite() || price.isNegative()) {
        throw new BadRequestException(`El combo ${comboId} tiene un precio inválido`);
      }
      comboTotal = comboTotal.plus(price.times(requested.get(comboId) ?? 0));
    }
    comboTotal = comboTotal.toDecimalPlaces(2, MONEY_ROUNDING);

    const components = [...componentQty.entries()]
      .filter(([, quantity]) => quantity > 0)
      .sort(([a], [b]) => a - b)
      .map(([productId, quantity]) => ({ product_id: productId, quantity: String(quantity) }));

    this.logger.log(
      `Combos resolved: tenant=${tenantId} combos=${comboIds.length} components=${components.length} total=${comboTotal.toFixed(2)}`
    );
    return { components, comboTotal };
  }
}
