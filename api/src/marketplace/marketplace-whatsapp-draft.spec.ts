import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  buildDraftSummary,
  lineTotals,
  mergeDraftLines,
  parseDraftItems,
  unitPriceWithMarkup
} from './marketplace-whatsapp-draft';

test('marketplace-whatsapp-draft', async (t) => {
  await t.test('unitPriceWithMarkup aplica impuesto y markup con redondeo a 2 decimales', () => {
    assert.equal(unitPriceWithMarkup('10000', '19', '10'), '13090.00');
  });

  await t.test('lineTotals redondea por línea igual que el checkout', () => {
    const clean = lineTotals('10000', '0', '10', 2);
    assert.equal(clean.subtotal, '20000.00');
    assert.equal(clean.total, '22000.00');

    const rounded = lineTotals('3333.33', '19', '10', 3);
    assert.equal(rounded.subtotal, '11899.99');
    assert.equal(rounded.total, '13089.99');
  });

  await t.test('mergeDraftLines fusiona por producto y limita 20 distintos / 999 por línea', () => {
    const first = mergeDraftLines([], [{ product_id: 1, quantity: 2 }]);
    assert.equal(first.error, null);
    assert.deepEqual(first.lines, [{ productId: 1, quantity: 2 }]);

    const merged = mergeDraftLines(first.lines, [
      { product_id: 1, quantity: 3 },
      { product_id: 2, quantity: 1 }
    ]);
    assert.equal(merged.error, null);
    assert.equal(merged.lines.length, 2);
    assert.equal(merged.lines[0].quantity, 5);

    const tooMany = mergeDraftLines(
      [],
      Array.from({ length: 21 }, (_, index) => ({ product_id: index + 1, quantity: 1 }))
    );
    assert.ok(tooMany.error !== null);

    const tooBig = mergeDraftLines([], [{ product_id: 1, quantity: 1000 }]);
    assert.ok(tooBig.error !== null);
  });

  await t.test('parseDraftItems valida forma y rangos', () => {
    assert.equal(parseDraftItems([]), 'items debe traer entre 1 y 20 productos');
    assert.equal(typeof parseDraftItems([{ product_id: 1, quantity: 0 }]), 'string');
    assert.equal(typeof parseDraftItems([{ product_id: 0, quantity: 1 }]), 'string');
    const parsed = parseDraftItems([{ product_id: 7, quantity: 2 }]);
    assert.deepEqual(parsed, [{ product_id: 7, quantity: 2 }]);
  });

  await t.test('buildDraftSummary suma el envío y advierte por stock/faltantes', () => {
    const products = new Map([
      [
        1,
        {
          id: 1,
          name: 'Arroz',
          basePrice: '10000',
          tax: '19',
          markupPercent: '10',
          seller: 'Tienda A',
          stock: 5
        }
      ]
    ]);
    const ok = buildDraftSummary([{ productId: 1, quantity: 2 }], products, '5000');
    assert.equal(ok.lines.length, 1);
    assert.equal(ok.lines[0].seller, 'Tienda A');
    assert.equal(ok.lines[0].unit_price, '13090.00');
    assert.equal(ok.lines[0].subtotal, '26180.00');
    assert.equal(ok.shipping, '5000.00');
    assert.equal(ok.total, '31180.00');
    assert.deepEqual(ok.warnings, []);

    const low = buildDraftSummary([{ productId: 1, quantity: 9 }], products, '0.00');
    assert.equal(low.warnings.length, 1);

    const missing = buildDraftSummary([{ productId: 99, quantity: 1 }], products, '0.00');
    assert.equal(missing.lines.length, 0);
    assert.equal(missing.total, '0.00');
  });
});
