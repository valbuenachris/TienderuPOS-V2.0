/**
 * Prueba manual del checkout de Sistecrédito — contrato real v0.12.6
 * (plugin WooCommerce `sistecredito` v1.13.0: POST {base}/Spay/PasCheckout/checkout/create/transaction/sistecredito).
 *
 * Uso (desde la carpeta `api/`):
 *   npx tsx src/scripts/test-sistecredito-integration.ts --dry-run --synthetic
 *   npx tsx src/scripts/test-sistecredito-integration.ts --tenant <uuid> --sale <id>
 *   npx tsx src/scripts/test-sistecredito-integration.ts --tenant <uuid> --dry-run --sale 123
 *
 * Flags:
 *   --tenant <uuid>       Tenant a probar (default: Princess Skin / env SISTECREDITO_TEST_TENANT_ID).
 *   --sale <id>           Usa el total y el documento reales de esa venta (requiere BD).
 *   --synthetic           Fuerza datos de ejemplo (default si no hay --sale).
 *   --amount <n>          Override del valueToPaid (modo sintético).
 *   --dry-run             Imprime payload/JWT/URL sin llamar a Sistecrédito.
 *   --database-url <url>  Override de DATABASE_URL.
 *   --base-url <url>      Override de SISTECREDITO_API_BASE_URL (Staging: https://api-co-stg.sistecreditocloud.com).
 *   --origin <v>          Override de SISTECREDITO_ORIGIN (Production|Staging|Qa|Development).
 *   --jwt-secret <hex>    Override de SISTECREDITO_JWT_SECRET (default: env).
 *   --audience <url>      Override de SISTECREDITO_AUDIENCE_URL (default: PUBLIC_API_URL).
 *
 * Lee `.env` local de `api/` y `../.env` (raíz del repo). Nunca imprime secretos:
 * Subscription Key y JWT se muestran enmascarados/recortados.
 */
import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import {
  buildSistecreditoCreatePayload,
  buildSistecreditoJwt,
  buildSistecreditoToken,
  formatSistecreditoDate,
  mapSistecreditoError,
  normalizeSistecreditoDocumentNumber,
  normalizeSistecreditoDocumentType
} from '../payments/sistecredito.service';

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

const TENANT_ID = argValue('--tenant') ?? process.env.SISTECREDITO_TEST_TENANT_ID ?? 'ac344fcc-d3bf-4c0d-b8ab-135c985ce8df';
const SALE_ID = argValue('--sale') !== undefined ? Number(argValue('--sale')) : null;
const AMOUNT_OVERRIDE = argValue('--amount') !== undefined ? Number(argValue('--amount')) : null;
const DRY_RUN = hasFlag('--dry-run');
const SYNTHETIC = hasFlag('--synthetic') || SALE_ID === null;
const DATABASE_URL = argValue('--database-url') ?? process.env.DATABASE_URL ?? '';
const API_BASE = (
  argValue('--base-url') ?? process.env.SISTECREDITO_API_BASE_URL ?? 'https://api.sistecredito.com'
).trim().replace(/\/+$/, '');
const ORIGIN = (argValue('--origin') ?? process.env.SISTECREDITO_ORIGIN ?? 'Production').trim();
const JWT_SECRET = (argValue('--jwt-secret') ?? process.env.SISTECREDITO_JWT_SECRET ?? '').trim();
const AUDIENCE = (
  argValue('--audience') ?? process.env.SISTECREDITO_AUDIENCE_URL ?? process.env.PUBLIC_API_URL ?? 'https://pos.tienderu.com'
).trim().replace(/\/+$/, '');
const CALLBACK_URL = (
  process.env.SISTECREDITO_CALLBACK_URL ?? `${AUDIENCE}/api/webhooks/sistecredito`
).trim();
const CREATE_PATH = '/Spay/PasCheckout/checkout/create/transaction/sistecredito';
const REQUEST_TIMEOUT_MS = 15000;

function requireDatabaseUrl(): string {
  if (DATABASE_URL.trim() === '') {
    console.error('Falta DATABASE_URL (usa --database-url o exporta la variable).');
    process.exit(1);
  }
  return DATABASE_URL;
}

function mask(value: string, keep = 6): string {
  return value.length <= keep * 2 ? `***(${value.length})` : `${value.slice(0, keep)}…(${value.length})`;
}

type TenantCredentials = {
  apiKey: string;
  vendorId: string;
  storeId: string;
  enabled: boolean;
};

async function loadTenantCredentials(pool: Pool): Promise<TenantCredentials> {
  const result = await pool.query<{
    sistecredito_enabled: boolean | null;
    sistecredito_api_key: string | null;
    sistecredito_vendor_id: string | null;
    sistecredito_store_id: string | null;
  }>(
    `SELECT sistecredito_enabled, sistecredito_api_key, sistecredito_vendor_id, sistecredito_store_id
     FROM public.tec_tenant_payment_settings WHERE tenant_id = $1 LIMIT 1`,
    [TENANT_ID]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Tenant ${TENANT_ID} sin fila en tec_tenant_payment_settings.`);
  if (!row.sistecredito_api_key || !row.sistecredito_vendor_id || !row.sistecredito_store_id) {
    throw new Error(
      `Tenant ${TENANT_ID} incompleto: requiere sistecredito_api_key + sistecredito_vendor_id + ` +
      'sistecredito_store_id (migración v0.12.6 + DML del operador).'
    );
  }
  return {
    enabled: row.sistecredito_enabled === true,
    apiKey: row.sistecredito_api_key,
    vendorId: row.sistecredito_vendor_id,
    storeId: row.sistecredito_store_id
  };
}

async function loadSaleAmount(pool: Pool): Promise<number> {
  const result = await pool.query<{ grand_total: string | null }>(
    `SELECT grand_total::text AS grand_total FROM public.tec_sales WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [SALE_ID, TENANT_ID]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Venta ${SALE_ID} no encontrada para el tenant ${TENANT_ID}`);
  return Number(row.grand_total ?? 0);
}

async function main(): Promise<void> {
  console.log('Sistecrédito integration test — contrato real v0.12.6 (plugin WooCommerce v1.13.0)');
  console.log(`Tenant: ${TENANT_ID} · Modo: ${SYNTHETIC ? 'sintético' : `venta #${SALE_ID}`} · ${DRY_RUN ? 'DRY-RUN (no llama a Sistecrédito)' : 'POST real'}`);
  console.log(`Create: POST ${API_BASE}${CREATE_PATH} (SCOrigen=${ORIGIN})\n`);

  if (JWT_SECRET === '') {
    console.error('Falta SISTECREDITO_JWT_SECRET (env o --jwt-secret). Genera: openssl rand -hex 32');
    process.exit(1);
  }

  const saleIdForToken = SALE_ID ?? 999999999;
  const amount = AMOUNT_OVERRIDE ?? (SALE_ID !== null && !SYNTHETIC ? 0 : 45000);
  const documentType = normalizeSistecreditoDocumentType('CC');
  const documentNumber = normalizeSistecreditoDocumentNumber(process.env.SISTECREDITO_TEST_DOCUMENT_NUMBER ?? '1001234567');
  if (documentType === null || documentNumber === null) {
    console.error('Documento de prueba inválido (SISTECREDITO_TEST_DOCUMENT_NUMBER debe ser numérico).');
    process.exit(1);
  }

  const pool = !DRY_RUN || SALE_ID !== null ? new Pool({ connectionString: requireDatabaseUrl() }) : null;
  try {
    const credentials = pool !== null
      ? await loadTenantCredentials(pool)
      : { enabled: false, apiKey: 'dry-run-key', vendorId: 'dry-run-vendor', storeId: 'dry-run-store' };
    const finalAmount = SALE_ID !== null && !SYNTHETIC
      ? (AMOUNT_OVERRIDE ?? await loadSaleAmount(pool as Pool))
      : amount;

    const token = buildSistecreditoToken(JWT_SECRET, saleIdForToken);
    const jwt = buildSistecreditoJwt(token, AUDIENCE);
    const payload = buildSistecreditoCreatePayload({
      saleId: saleIdForToken,
      amount: finalAmount,
      documentType,
      documentNumber,
      vendorId: credentials.vendorId,
      storeId: credentials.storeId,
      responseUrl: CALLBACK_URL,
      transactionDate: formatSistecreditoDate(new Date())
    });

    console.log(`Tenant enabled: ${credentials.enabled} · Subscription Key: ${mask(credentials.apiKey)} · JWT: ${mask(jwt, 12)}`);
    console.log('Payload (orderId de prueba si es sintético):');
    console.log(JSON.stringify(payload, null, 2));

    if (DRY_RUN) {
      console.log('\nDRY-RUN: payload construido. Sin llamada a Sistecrédito.');
      return;
    }
    if (!credentials.enabled) {
      console.warn('\nAVISO: sistecredito_enabled=false para el tenant; la pasarela real respondería no configurado.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${API_BASE}${CREATE_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': credentials.apiKey,
          SCLocation: '0,0',
          country: 'co',
          SCOrigen: ORIGIN,
          Authentication: jwt
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const elapsedMs = Date.now() - startedAt;
      const text = await response.text();
      console.log(`\nRespuesta: HTTP ${response.status} · ${elapsedMs} ms`);
      console.log(`Body: ${text === '' ? '(vacío)' : text.slice(0, 2000)}`);

      if (response.ok) {
        try {
          const parsed = JSON.parse(text) as { data?: { urlToRedirect?: string; transactionId?: string } };
          const url = parsed.data?.urlToRedirect;
          const transactionId = parsed.data?.transactionId;
          if (url && transactionId) {
            console.log(`\nOK ✅ — redirección: ${url}?transactionId=${transactionId}`);
            return;
          }
        } catch (_error: unknown) {
          // cae al aviso de abajo
        }
        console.log('\nOK ✅ — 2xx (revisar body: sin data.urlToRedirect/transactionId).');
        return;
      }
      try {
        const parsed = JSON.parse(text) as { errorCode?: string | number; message?: string };
        const code = parsed.errorCode !== undefined ? String(parsed.errorCode) : null;
        console.log(`\nMensaje público: ${mapSistecreditoError(code)} (errorCode=${code ?? 'n/a'} - ${parsed.message ?? ''})`);
      } catch (_error: unknown) {
        // sin detalle
      }
      console.error('\nFALLÓ ❌ — revisar status/body para soporte Sistecrédito.');
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
