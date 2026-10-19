import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// E2E smoke de la tienda pública (v0.11.5). Apunta al ambiente con
// `E2E_STORE_BASE_URL` (default: Vite dev en http://localhost:5174, proxy /api).
// El smoke es de solo lectura (home, búsqueda, ficha y carrito local): no crea
// pedidos ni requiere credenciales.
//
// En entornos musl (Alpine) el chromium de Playwright no corre; se usa
// /usr/bin/chromium si existe (o `E2E_CHROMIUM_PATH`).
const systemChromium = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
const executablePath = process.env.E2E_CHROMIUM_PATH ?? systemChromium;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_STORE_BASE_URL ?? 'http://localhost:5174',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} }
    }
  ]
});