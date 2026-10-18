import { defineConfig, devices } from '@playwright/test';

// E2E del POS (v0.3.x). Apunta al ambiente con `E2E_BASE_URL`
// (default: Vite dev en http://localhost:5173, que proxya /api → 127.0.0.1:3000).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
