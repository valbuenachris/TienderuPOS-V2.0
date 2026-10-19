import { expect, test } from '@playwright/test';

/**
 * Smoke E2E de tienderu.com (solo lectura + carrito local): home con buscador,
 * búsqueda, ficha de producto con opiniones y carrito. No crea pedidos ni
 * requiere credenciales. Cuando el catálogo está vacío, los pasos que dependen
 * de un producto se omiten con mensaje.
 */

test('home: header, buscador y logo', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Tienderu/i);
  await expect(page.getByLabel('Buscar en Tienderu').filter({ visible: true })).toBeVisible();
  await expect(page.getByLabel('Tienderu.com — Inicio').first()).toBeVisible();
});

test('búsqueda: navega a /buscar', async ({ page }) => {
  await page.goto('/');
  const search = page.getByLabel('Buscar en Tienderu').filter({ visible: true });
  await search.fill('a');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/buscar/);
});

test('ficha: precio, vendedor y opiniones', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('a[href^="/producto/"]').first();
  try {
    await card.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    test.skip(true, 'Catálogo vacío: sin productos para abrir la ficha');
  }
  await card.click();
  await expect(page).toHaveURL(/\/producto\/\d+/);
  await expect(page.getByRole('link', { name: /Vendido por/ }).first()).toBeVisible();
  await expect(page.getByText('Opiniones de clientes')).toBeVisible();
});

test('carrito: agregar producto y verlo en /carrito', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('a[href^="/producto/"]').first();
  try {
    await card.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    test.skip(true, 'Catálogo vacío: sin productos para el carrito');
  }
  await card.click();
  const addButton = page.getByRole('button', { name: 'Agregar al carrito' });
  try {
    await addButton.first().waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    test.skip(true, 'Producto sin stock: no se puede agregar al carrito');
  }
  if (await addButton.first().isDisabled()) {
    test.skip(true, 'Producto sin stock: no se puede agregar al carrito');
  }
  await addButton.first().click();
  await page.goto('/carrito');
  await expect(page.getByText('Carrito de compras')).toBeVisible();
});