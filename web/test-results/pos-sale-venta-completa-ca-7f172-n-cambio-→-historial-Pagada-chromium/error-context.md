# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pos-sale.spec.ts >> venta completa: cajero → escaneo → 10% → efectivo con cambio → historial Pagada
- Location: e2e/pos-sale.spec.ts:41:5

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8096/
Call log:
  - navigating to "http://127.0.0.1:8096/", waiting until "load"

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * E2E del flujo completo de venta en el POS:
  5   |  * login de cajero → escaneo (entrada manual del ProductScanner) → descuento
  6   |  * manual del 10% → pago en efectivo con monto recibido mayor al total
  7   |  * (verificando el cambio) → la venta aparece en el historial como "Pagada" (paid).
  8   |  *
  9   |  * Requisitos (variables de entorno):
  10  |  *  - E2E_BASE_URL         URL del POS (default http://localhost:5173, dev con proxy /api).
  11  |  *  - E2E_CASHIER_USERNAME usuario o email de un CAJERO activo con tienda asignada.
  12  |  *  - E2E_CASHIER_PASSWORD contraseña del cajero.
  13  |  *  - E2E_PRODUCT_CODE     código (barcode/SKU) exacto de un producto con precio y stock.
  14  |  *
  15  |  * ⚠️ El test CREA una venta real en el ambiente apuntado: ejecútalo solo contra
  16  |  * un ambiente de pruebas, nunca contra producción.
  17  |  */
  18  | 
  19  | const CASHIER_USERNAME = process.env.E2E_CASHIER_USERNAME ?? '';
  20  | const CASHIER_PASSWORD = process.env.E2E_CASHIER_PASSWORD ?? '';
  21  | const PRODUCT_CODE = process.env.E2E_PRODUCT_CODE ?? '';
  22  | 
  23  | test.skip(
  24  |   CASHIER_USERNAME === '' || CASHIER_PASSWORD === '' || PRODUCT_CODE === '',
  25  |   'Define E2E_CASHIER_USERNAME, E2E_CASHIER_PASSWORD y E2E_PRODUCT_CODE para ejecutar el E2E de venta.'
  26  | );
  27  | 
  28  | /** Convierte un monto formateado es-CO ("$ 30.000,00") a número. */
  29  | function parseCop(text: string): number {
  30  |   const cleaned = text.replace(/[^\d.,]/g, '');
  31  |   const normalized = cleaned.includes(',')
  32  |     ? cleaned.replace(/\./g, '').replace(',', '.')
  33  |     : cleaned.replace(/\./g, '');
  34  |   return Number(normalized);
  35  | }
  36  | 
  37  | function toCents(value: number): number {
  38  |   return Math.round(value * 100);
  39  | }
  40  | 
  41  | test('venta completa: cajero → escaneo → 10% → efectivo con cambio → historial Pagada', async ({ page }) => {
  42  |   // 1) Login con rol cashier
> 43  |   await page.goto('/');
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8096/
  44  |   await page.getByLabel('Usuario o correo').fill(CASHIER_USERNAME);
  45  |   await page.getByLabel('Contraseña').fill(CASHIER_PASSWORD);
  46  |   await page.getByRole('button', { name: 'Entrar al POS' }).click();
  47  |   await expect(page.getByRole('heading', { name: 'Nueva venta' })).toBeVisible();
  48  | 
  49  |   // 2) Escaneo del producto simulando el ProductScanner (entrada manual del modal)
  50  |   await page.getByRole('button', { name: 'Escanear código de barras' }).click();
  51  |   const scanner = page.getByRole('dialog', { name: 'Escanear código de barras' });
  52  |   await scanner.getByPlaceholder('O ingrese el código manualmente').fill(PRODUCT_CODE);
  53  |   await scanner.getByRole('button', { name: 'Agregar', exact: true }).click();
  54  |   await expect(scanner).toBeHidden();
  55  |   await expect(page.locator('.cart-line')).toHaveCount(1);
  56  | 
  57  |   // 3) Confirmación de venta: descuento manual del 10% (tipo porcentaje)
  58  |   await page.getByRole('button', { name: 'Registrar venta' }).click();
  59  |   const dialog = page.getByRole('dialog', { name: 'Confirmar venta' });
  60  |   await expect(dialog).toBeVisible();
  61  |   await dialog.getByRole('button', { name: 'Porcentaje' }).click();
  62  |   await dialog.getByLabel('Descuento').fill('10');
  63  |   await expect(dialog.getByText('Descuento aplicado')).toBeVisible();
  64  | 
  65  |   // El 10% se calcula sobre subtotal + impuestos, igual que el backend
  66  |   const subtotal = parseCop(await dialog.locator('.confirm-totals > div').nth(0).locator('span').nth(1).innerText());
  67  |   const taxes = parseCop(await dialog.locator('.confirm-totals > div').nth(1).locator('span').nth(1).innerText());
  68  |   const shownDiscount = parseCop(await dialog.locator('.confirm-discount-line span').nth(1).innerText());
  69  |   const total = parseCop(await dialog.locator('.confirm-total strong').innerText());
  70  |   const preTotalCents = toCents(subtotal) + toCents(taxes);
  71  |   const expectedDiscountCents = Math.round(preTotalCents * 10 / 100);
  72  |   const expectedTotalCents = preTotalCents - expectedDiscountCents;
  73  |   expect(toCents(shownDiscount)).toBe(expectedDiscountCents);
  74  |   expect(toCents(total)).toBe(expectedTotalCents);
  75  | 
  76  |   // 4) Pago en efectivo con monto recibido mayor al total (el modo por defecto es cash)
  77  |   const received = Math.ceil((total + 50000) / 1000) * 1000;
  78  |   await dialog.getByLabel('Monto recibido').fill(String(received));
  79  |   const changeLine = dialog.locator('.change-line.positive');
  80  |   await expect(changeLine).toContainText('Cambio a devolver');
  81  |   const shownChange = parseCop(await changeLine.locator('span').nth(1).innerText());
  82  |   expect(toCents(shownChange)).toBe(toCents(received - total));
  83  |   await expect(dialog.locator('.sale-status-badge')).toContainText('Pagada');
  84  | 
  85  |   // 5) Confirmar la venta y capturar su número
  86  |   await dialog.getByRole('button', { name: 'Confirmar venta' }).click();
  87  |   const notice = page.getByText(/Venta #\d+ registrada\./);
  88  |   await expect(notice).toBeVisible();
  89  |   const saleId = Number((await notice.innerText()).match(/#(\d+)/)?.[1]);
  90  |   expect(Number.isSafeInteger(saleId)).toBe(true);
  91  | 
  92  |   // 6) Historial de ventas: la venta aparece como "Pagada" (paid) por el total
  93  |   await page.goto('/ventas');
  94  |   const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: String(saleId), exact: true }) });
  95  |   await expect(row).toBeVisible();
  96  |   await expect(row.locator('.badge')).toHaveText('Pagada');
  97  |   await expect(row.locator('.badge')).toHaveClass(/\bpaid\b/);
  98  |   const historyPaid = parseCop(await row.locator('.money-cell').nth(2).innerText());
  99  |   expect(toCents(historyPaid)).toBe(toCents(total));
  100 | });
  101 | 
```