import Decimal from 'decimal.js';

const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;

export type MarketplaceDraftLine = { productId: number; quantity: number };

export type MarketplaceDraftProduct = {
  id: number;
  name: string | null;
  basePrice: string;
  tax: string;
  markupPercent: string;
  seller: string;
  stock: number;
};

export type MarketplaceDraftSummary = {
  lines: Array<{
    product_id: number;
    name: string;
    seller: string;
    quantity: number;
    unit_price: string;
    subtotal: string;
  }>;
  shipping: string;
  total: string;
  warnings: string[];
};

/** Precio unitario mostrado (base + impuesto + markup), mismo redondeo del catálogo. */
export function unitPriceWithMarkup(
  basePrice: string | number,
  tax: string | number,
  markupPercent: string | number
): string {
  const base = new Decimal(basePrice);
  const taxRate = new Decimal(tax);
  const markup = new Decimal(markupPercent);
  const baseWithTax = base.plus(base.times(taxRate).dividedBy(100).toDecimalPlaces(2, MONEY_ROUNDING));
  return baseWithTax
    .times(new Decimal(1).plus(markup.dividedBy(100)))
    .toDecimalPlaces(2, MONEY_ROUNDING)
    .toFixed(2);
}

/** Totales de línea EXACTOS del checkout del marketplace (redondeo por línea). */
export function lineTotals(
  basePrice: string | number,
  tax: string | number,
  markupPercent: string | number,
  quantity: number
): { subtotal: string; total: string } {
  const base = new Decimal(basePrice);
  const quantityDecimal = new Decimal(quantity);
  const taxRate = new Decimal(tax);
  const markup = new Decimal(markupPercent);
  const lineBase = base.times(quantityDecimal).toDecimalPlaces(2, MONEY_ROUNDING);
  const lineTax = lineBase.times(taxRate).dividedBy(100).toDecimalPlaces(2, MONEY_ROUNDING);
  const lineSubtotal = lineBase.plus(lineTax);
  const lineTotal = lineSubtotal
    .times(new Decimal(1).plus(markup.dividedBy(100)))
    .toDecimalPlaces(2, MONEY_ROUNDING);
  return { subtotal: lineSubtotal.toFixed(2), total: lineTotal.toFixed(2) };
}

/** Suma ítems al borrador (merge por producto, máx 20 distintos y 999 por línea). */
export function mergeDraftLines(
  lines: MarketplaceDraftLine[],
  items: Array<{ product_id: number; quantity: number }>
): { lines: MarketplaceDraftLine[]; error: string | null } {
  const next = lines.map((line) => ({ ...line }));
  for (const item of items) {
    const existing = next.find((line) => line.productId === item.product_id);
    if (existing) existing.quantity += item.quantity;
    else next.push({ productId: item.product_id, quantity: item.quantity });
  }
  if (next.length > 20) return { lines, error: 'El pedido supera 20 productos distintos' };
  if (next.some((line) => line.quantity > 999)) {
    return { lines, error: 'Cantidad máxima por producto: 999' };
  }
  return { lines: next, error: null };
}

/** Parsea el argumento `items` de la herramienta (1..20 enteros positivos). */
export function parseDraftItems(
  rawItems: unknown
): Array<{ product_id: number; quantity: number }> | string {
  const list = Array.isArray(rawItems) ? rawItems : [];
  if (list.length === 0 || list.length > 20) return 'items debe traer entre 1 y 20 productos';
  const items: Array<{ product_id: number; quantity: number }> = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'Formato de items inválido';
    const record = raw as Record<string, unknown>;
    const productId =
      typeof record.product_id === 'number' && Number.isSafeInteger(record.product_id) && record.product_id > 0
        ? record.product_id
        : null;
    const quantity =
      typeof record.quantity === 'number' &&
      Number.isSafeInteger(record.quantity) &&
      record.quantity > 0 &&
      record.quantity <= 999
        ? record.quantity
        : null;
    if (productId === null || quantity === null) {
      return 'Cada item necesita product_id y quantity (enteros positivos)';
    }
    items.push({ product_id: productId, quantity });
  }
  return items;
}

/**
 * Resumen del borrador con precios/stock ACTUALES; el servidor es la fuente del
 * total (productos con impuesto+markup + envío una sola vez).
 */
export function buildDraftSummary(
  lines: MarketplaceDraftLine[],
  products: Map<number, MarketplaceDraftProduct>,
  shippingFlat: string
): MarketplaceDraftSummary {
  const outLines: MarketplaceDraftSummary['lines'] = [];
  const warnings: string[] = [];
  let productsTotal = new Decimal(0);

  for (const line of lines) {
    const product = products.get(line.productId);
    if (!product) {
      warnings.push(`El producto #${line.productId} ya no está disponible; quítalo del pedido.`);
      continue;
    }
    if (product.stock < line.quantity) {
      warnings.push(
        `Sin stock suficiente de ${product.name ?? `#${line.productId}`} (disponibles: ${product.stock}).`
      );
    }
    const totals = lineTotals(product.basePrice, product.tax, product.markupPercent, line.quantity);
    productsTotal = productsTotal.plus(totals.total);
    outLines.push({
      product_id: product.id,
      name: product.name ?? `#${product.id}`,
      seller: product.seller,
      quantity: line.quantity,
      unit_price: unitPriceWithMarkup(product.basePrice, product.tax, product.markupPercent),
      subtotal: totals.total
    });
  }

  const shipping = new Decimal(shippingFlat);
  const total = productsTotal.plus(shipping).toDecimalPlaces(2, MONEY_ROUNDING);
  return { lines: outLines, shipping: shipping.toFixed(2), total: total.toFixed(2), warnings };
}
