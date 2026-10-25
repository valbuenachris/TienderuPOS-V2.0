/**
 * Prueba manual del checkout de Addi — schema oficial v0.3.96
 * (ADDI API · Integración con un E-commerce CO: POST /v1/online-applications → 301 + Location).
 *
 * Uso (desde la carpeta `api/`):
 *   npx tsx src/scripts/test-addi-integration.ts --dry-run --synthetic
 *   npx tsx src/scripts/test-addi-integration.ts --tenant <uuid> [--sale <id>] [--amount 45000]
 *   npx tsx src/scripts/test-addi-integration.ts --tenant <uuid> --dry-run --sale 123
 *
 * Flags:
 *   --tenant <uuid>       Tenant a probar (default: Princess Skin / env ADDI_TEST_TENANT_ID).
 *   --sale <id>           Usa los ítems y totales reales de esa venta (requiere BD).
 *   --synthetic           Fuerza datos de ejemplo (default si no hay --sale).
 *   --amount <n>          Override del totalAmount (solo modo sintético).
 *   --dry-run             Imprime payload/URL sin llamar a Addi.
 *   --database-url <url>  Override de DATABASE_URL (p. ej. localhost:5432 desde el host del VPS).
 *   --auth-url <url>      Override de ADDI_AUTH_URL.
 *   --audience <value>    Override de ADDI_AUDIENCE.
 *   --base-url <url>      Override de ADDI_API_BASE_URL.
 *   --path <path>         Override de ADDI_APPLICATIONS_PATH.
 *
 * Lee `.env` local de `api/` y `../.env` (raíz del repo). Nunca imprime secretos;
 * email/teléfono se enmascaran en el payload logueado.
 */
import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import {
  buildAddiPayload,
  maskEmail,
  maskPhone,
  maskSecret,
  normalizeAuthUrl
} from '../payments/addi.service';
import type { AddiAddress, AddiItemInput } from '../payments/addi.service';

dotenv.config({ path: '../.env' });
dotenv.config();

const args = process.argv.slice(2);

function argValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value !== undefined && !value.startsWith('--') ? value : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

const TENANT_ID = argValue('--tenant') ?? process.env.ADDI_TEST_TENANT_ID ?? 'ac344fcc-d3bf-4c0d-b8ab-135c985ce8df';
const SALE_ID = argValue('--sale') !== undefined ? Number(argValue('--sale')) : null;
const AMOUNT_OVERRIDE = argValue('--amount') !== undefined ? Number(argValue('--amount')) : null;
const DRY_RUN = hasFlag('--dry-run');
const SYNTHETIC = hasFlag('--synthetic') || SALE_ID === null;
const DATABASE_URL = argValue('--database-url') ?? process.env.DATABASE_URL ?? '';
const AUTH_URL = normalizeAuthUrl(argValue('--auth-url') ?? process.env.ADDI_AUTH_URL ?? 'https://auth.addi-staging.com/oauth/token');
const AUDIENCE = argValue('--audience') ?? process.env.ADDI_AUDIENCE ?? 'https://api.staging.addi.com';
const API_BASE = (argValue('--base-url') ?? process.env.ADDI_API_BASE_URL ?? 'https://api.staging.addi.com').trim().replace(/\/+$/, '');
const rawPath = (argValue('--path') ?? process.env.ADDI_APPLICATIONS_PATH ?? '/v1/online-applications').trim().replace(/\/+$/, '');
const APPLICATIONS_PATH = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
const CALLBACK_URL = process.env.ADDI_CALLBACK_URL ?? 'https://pos.tienderu.com/api/webhooks/addi';
const REDIRECTION_URL = process.env.CUSTOMER_PAYMENT_RETURN_URL ?? 'https://pos.tienderu.com/config?payment=return';
const DOCUMENT_NUMBER = process.env.ADDI_TEST_DOCUMENT_NUMBER ?? '1001234567';
const REQUEST_TIMEOUT_MS = 15000;

function requireDatabaseUrl(): string {
  if (DATABASE_URL.trim() === '') {
    console.error('Falta DATABASE_URL (usa --database-url o exporta la variable).');
    process.exit(1);
  }
  return DATABASE_URL;
}

type SaleData = {
  amount: number;
  taxAmount: number;
  items: AddiItemInput[];
  firstName: string;
  lastName: string;
  email: string;
  cellphone: string;
  address: AddiAddress | null;
};

async function loadSaleData(pool: Pool, saleId: number): Promise<SaleData> {
  const saleResult = await pool.query<{ grand_total: string | null; total_tax: string | null; customer_id: number | null }>(
    `SELECT grand_total::text AS grand_total, COALESCE(total_tax, 0)::text AS total_tax, customer_id
     FROM public.tec_sales WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [saleId, TENANT_ID]
  );
  const sale = saleResult.rows[0];
  if (!sale) throw new Error(`Venta ${saleId} no encontrada para el tenant ${TENANT_ID}`);

  const itemsResult = await pool.query<{
    product_id: number | null;
    code: string | null;
    name: string | null;
    quantity: string | number;
    unit_price: string;
    subtotal: string | null;
    tax_rate: string | null;
  }>(
    `SELECT si.product_id, p.code, p.name, si.quantity, si.unit_price::text AS unit_price,
            si.subtotal::text AS subtotal, p.tax::text AS tax_rate
     FROM public.tec_sale_items si
     LEFT JOIN public.tec_products p ON p.id = si.product_id
     WHERE si.sale_id = $1 AND si.tenant_id = $2
     ORDER BY si.id ASC`,
    [saleId, TENANT_ID]
  );
  const items: AddiItemInput[] = itemsResult.rows.map((row) => {
    const quantity = Math.max(1, Math.round(Number(row.quantity) || 1));
    const unitPrice = Math.round(Number(row.unit_price) || 0);
    const subtotal = Math.round(Number(row.subtotal) || unitPrice * quantity);
    const taxRate = Number(row.tax_rate ?? 0);
    return {
      sku: (row.code ?? '').trim() !== '' ? String(row.code) : `PROD-${row.product_id ?? 0}`,
      name: (row.name ?? '').trim() !== '' ? String(row.name) : 'Producto',
      quantity,
      unitPrice,
      tax: Number.isFinite(taxRate) && taxRate > 0 ? Math.round((subtotal * taxRate) / 100) : 0
    };
  });

  let firstName = 'Ana';
  let lastName = 'Pérez Gómez';
  let email = 'ana@test.com';
  let cellphone = '3009998888';
  let address: AddiAddress | null = null;
  if (sale.customer_id !== null) {
    const customerResult = await pool.query<{ name: string | null; email: string | null; phone: string | null }>(
      `SELECT name, email, phone FROM public.tec_customers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [sale.customer_id, TENANT_ID]
    );
    const customer = customerResult.rows[0];
    if (customer) {
      const parts = (customer.name ?? '').trim().split(/\s+/).filter(Boolean);
      firstName = parts[0] ?? firstName;
      lastName = parts.slice(1).join(' ') || 'Cliente';
      email = customer.email ?? email;
      cellphone = customer.phone ?? cellphone;
    }
    const addressResult = await pool.query<{ street_address: string | null; city: string | null }>(
      `SELECT street_address, city FROM public.customer_addresses
       WHERE customer_id = $1 ORDER BY is_default DESC, id ASC LIMIT 1`,
      [sale.customer_id]
    ).catch(() => ({ rows: [] as Array<{ street_address: string | null; city: string | null }> }));
    const addressRow = addressResult.rows[0];
    if (addressRow && (addressRow.street_address ?? '').trim() !== '') {
      address = {
        lineOne: String(addressRow.street_address),
        city: (addressRow.city ?? '').trim() !== '' ? String(addressRow.city) : 'Bogotá',
        country: 'CO'
      };
    }
  }

  return {
    amount: Math.round(Number(sale.grand_total ?? 0)),
    taxAmount: Number(sale.total_tax ?? 0),
    items,
    firstName,
    lastName,
    email,
    cellphone,
    address
  };
}

async function loadTenantCredentials(pool: Pool): Promise<{ clientId: string; clientSecret: string }> {
  const result = await pool.query<{ addi_api_key: string | null; addi_webhook_secret: string | null; addi_enabled: boolean | null }>(
    `SELECT addi_enabled, addi_api_key, addi_webhook_secret
     FROM public.tec_tenant_payment_settings WHERE tenant_id = $1 LIMIT 1`,
    [TENANT_ID]
  );
  const row = result.rows[0];
  if (!row || row.addi_enabled !== true || !row.addi_api_key || !row.addi_webhook_secret) {
    throw new Error(`Tenant ${TENANT_ID} sin credenciales Addi habilitadas (addi_enabled/addi_api_key/addi_webhook_secret).`);
  }
  return { clientId: row.addi_api_key, clientSecret: row.addi_webhook_secret };
}

async function fetchToken(clientId: string, clientSecret: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: AUDIENCE
    });
    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      console.error(`Token Addi FALLÓ (${response.status}): ${text.slice(0, 400)}`);
      process.exit(1);
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const token = typeof parsed.access_token === 'string' ? parsed.access_token : '';
    if (token === '') {
      console.error('Token Addi sin access_token en la respuesta.');
      process.exit(1);
    }
    console.log(`Token OK: ${maskSecret(token)} (expires_in=${String(parsed.expires_in ?? '?')})`);
    return token;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  console.log('Addi integration test — schema oficial v0.3.96');
  console.log(`Tenant: ${TENANT_ID} · Modo: ${SYNTHETIC ? 'sintético' : `venta #${SALE_ID}`} · ${DRY_RUN ? 'DRY-RUN (no llama a Addi)' : 'POST real'}`);
  console.log(`Auth: ${AUTH_URL} (audience ${AUDIENCE})`);
  console.log(`Create: POST ${API_BASE}${APPLICATIONS_PATH}\n`);

  const pool = !DRY_RUN || SALE_ID !== null ? new Pool({ connectionString: requireDatabaseUrl() }) : null;
  try {
    const saleData: SaleData = SALE_ID !== null && pool !== null
      ? await loadSaleData(pool, SALE_ID)
      : {
          amount: AMOUNT_OVERRIDE ?? 45000,
          taxAmount: 0,
          items: [{ sku: 'TEST-1', name: 'Producto de prueba', quantity: 2, unitPrice: 22500, tax: 0 }],
          firstName: 'Ana',
          lastName: 'Pérez Gómez',
          email: 'ana@test.com',
          cellphone: '3009998888',
          address: { lineOne: 'Calle Falsa 123', city: 'Bogotá', country: 'CO' }
        };
    if (AMOUNT_OVERRIDE !== null && !SYNTHETIC) saleData.amount = AMOUNT_OVERRIDE;

    const address: AddiAddress = saleData.address ?? { lineOne: 'Calle Falsa 123', city: 'Bogotá', country: 'CO' };
    const orderId = `ORDER-TEST-${Date.now().toString(36)}`;
    const payload = buildAddiPayload({
      orderId,
      amount: saleData.amount,
      taxAmount: saleData.taxAmount,
      firstName: saleData.firstName,
      lastName: saleData.lastName,
      email: saleData.email,
      cellphone: saleData.cellphone,
      documentType: 'CC',
      documentNumber: DOCUMENT_NUMBER,
      callbackUrl: CALLBACK_URL,
      redirectionUrl: REDIRECTION_URL,
      items: saleData.items,
      address,
      includeShipping: (process.env.ADDI_SEND_SHIPPING ?? 'true').trim().toLowerCase() !== 'false' && saleData.address !== null
    });

    const client = payload.client as Record<string, unknown>;
    const debugPayload = {
      ...payload,
      client: {
        ...client,
        email: maskEmail(String(client.email ?? '')),
        cellphone: maskPhone(String(client.cellphone ?? ''))
      }
    };
    console.log('Payload (PII de client enmascarada solo en esta copia):');
    console.log(JSON.stringify(debugPayload, null, 2));

    if (DRY_RUN) {
      console.log('\nDRY-RUN: payload construido. Sin llamada a Addi.');
      return;
    }
    if (pool === null) throw new Error('Pool de BD no inicializado');

    const credentials = await loadTenantCredentials(pool);
    const token = await fetchToken(credentials.clientId, credentials.clientSecret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${API_BASE}${APPLICATIONS_PATH}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const elapsedMs = Date.now() - startedAt;
      const location = response.headers.get('location');
      const traceId = response.headers.get('x-trace-id') ?? response.headers.get('trace-id');
      const text = await response.text();
      console.log(`\nRespuesta: HTTP ${response.status} · ${elapsedMs} ms`);
      if (traceId) console.log(`x-trace-id: ${traceId}`);
      if (location) console.log(`Location: ${location}`);
      console.log(`Body: ${text === '' ? '(vacío)' : text.slice(0, 2000)}`);

      if (response.status >= 300 && response.status < 400 && location) {
        console.log('\nOK ✅ — 301 con Location; URL de checkout capturada correctamente.');
        return;
      }
      if (response.ok) {
        console.log('\nOK ✅ — 2xx con body (fallback).');
        return;
      }
      console.error('\nFALLÓ ❌ — revisar status/body/trace-id para soporte Addi.');
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (pool !== null) await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
