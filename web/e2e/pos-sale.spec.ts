import { expect, test } from '@playwright/test';

/**
 * E2E del flujo completo de venta en el POS:
 * login de cajero → escaneo (entrada manual del ProductScanner) → descuento
 * manual del 10% → pago en efectivo con monto recibido mayor al total
 * (verificando el cambio) → la venta aparece en el historial como "Pagada" (paid).
 *
 * Requisitos (variables de entorno):
 *  - E2E_BASE_URL         URL del POS (default http://localhost:5173, dev con proxy /api).
 *  - E2E_CASHIER_USERNAME usuario o email de un CAJERO activo con tienda asignada.
 *  - E2E_CASHIER_PASSWORD contraseña del cajero.
 *  - E2E_PRODUCT_CODE     código (barcode/SKU) exacto de un producto con precio y stock.
 *
 * ⚠️ El test CREA una venta real en el ambiente apuntado: ejecútalo solo contra
 * un ambiente de pruebas, nunca contra producción.
 */

const CASHIER_USERNAME = process.env.E2E_CASHIER_USERNAME ?? '';
const CASHIER_PASSWORD = process.env.E2E_CASHIER_PASSWORD ?? '';
const PRODUCT_CODE = process.env.E2E_PRODUCT_CODE ?? '';

test.skip(
  CASHIER_USERNAME === '' || CASHIER_PASSWORD === '' || PRODUCT_CODE === '',
  'Define E2E_CASHIER_USERNAME, E2E_CASHIER_PASSWORD y E2E_PRODUCT_CODE para ejecutar el E2E de venta.'
);

/** Convierte un monto formateado es-CO ("$ 30.000,00") a número. */
function parseCop(text: string): number {
  const cleaned = text.replace(/[^\d.,]/g, '');
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/\./g, '');
  return Number(normalized);
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

test('venta completa: cajero → escaneo → 10% → efectivo con cambio → historial Pagada', async ({ page }) => {
  // 1) Login con rol cashier
  await page.goto('/');
  await page.getByLabel('Usuario o correo').fill(CASHIER_USERNAME);
  await page.getByLabel('Contraseña').fill(CASHIER_PASSWORD);
  await page.getByRole('button', { name: 'Entrar al POS' }).click();
  await expect(page.getByRole('heading', { name: 'Nueva venta' })).toBeVisible();

  // 2) Escaneo del producto simulando el ProductScanner (entrada manual del modal)
  await page.getByRole('button', { name: 'Escanear código de barras' }).click();
  const scanner = page.getByRole('dialog', { name: 'Escanear código de barras' });
  await scanner.getByPlaceholder('O ingrese el código manualmente').fill(PRODUCT_CODE);
  await scanner.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(scanner).toBeHidden();
  await expect(page.locator('.cart-line')).toHaveCount(1);

  // 3) Confirmación de venta: descuento manual del 10% (tipo porcentaje)
  await page.getByRole('button', { name: 'Registrar venta' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar venta' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Porcentaje' }).click();
  await dialog.getByLabel('Descuento').fill('10');
  await expect(dialog.getByText('Descuento aplicado')).toBeVisible();

  // El 10% se calcula sobre subtotal + impuestos, igual que el backend
  const subtotal = parseCop(await dialog.locator('.confirm-totals > div').nth(0).locator('span').nth(1).innerText());
  const taxes = parseCop(await dialog.locator('.confirm-totals > div').nth(1).locator('span').nth(1).innerText());
  const shownDiscount = parseCop(await dialog.locator('.confirm-discount-line span').nth(1).innerText());
  const total = parseCop(await dialog.locator('.confirm-total strong').innerText());
  const preTotalCents = toCents(subtotal) + toCents(taxes);
  const expectedDiscountCents = Math.round(preTotalCents * 10 / 100);
  const expectedTotalCents = preTotalCents - expectedDiscountCents;
  expect(toCents(shownDiscount)).toBe(expectedDiscountCents);
  expect(toCents(total)).toBe(expectedTotalCents);

  // 4) Pago en efectivo con monto recibido mayor al total (el modo por defecto es cash)
  const received = Math.ceil((total + 50000) / 1000) * 1000;
  await dialog.getByLabel('Monto recibido').fill(String(received));
  const changeLine = dialog.locator('.change-line.positive');
  await expect(changeLine).toContainText('Cambio a devolver');
  const shownChange = parseCop(await changeLine.locator('span').nth(1).innerText());
  expect(toCents(shownChange)).toBe(toCents(received - total));
  await expect(dialog.locator('.sale-status-badge')).toContainText('Pagada');

  // 5) Confirmar la venta y capturar su número
  await dialog.getByRole('button', { name: 'Confirmar venta' }).click();
  const notice = page.getByText(/Venta #\d+ registrada\./);
  await expect(notice).toBeVisible();
  const saleId = Number((await notice.innerText()).match(/#(\d+)/)?.[1]);
  expect(Number.isSafeInteger(saleId)).toBe(true);

  // 6) Historial de ventas: la venta aparece como "Pagada" (paid) por el total
  await page.goto('/ventas');
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: String(saleId), exact: true }) });
  await expect(row).toBeVisible();
  await expect(row.locator('.badge')).toHaveText('Pagada');
  await expect(row.locator('.badge')).toHaveClass(/\bpaid\b/);
  const historyPaid = parseCop(await row.locator('.money-cell').nth(2).innerText());
  expect(toCents(historyPaid)).toBe(toCents(total));
});
