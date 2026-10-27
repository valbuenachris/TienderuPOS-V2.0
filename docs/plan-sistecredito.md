# Plan: Integración real de Sistecrédito (v0.12.6)

Estado: **APROBADO Y EN EJECUCIÓN (2026-10-26)** — contrato real capturado del plugin
WooCommerce `sistecredito` v1.13.0 instalado en la tienda Princess Skin (wp-admin, solo
lectura). Credenciales de producción obtenidas (Vendor ID / Store ID / Subscription Key,
la key solo va a BD). Activación final pendiente de certificación en Staging/Qa.

## 1. Contrato capturado (fuente: código del plugin)

Endpoints (`GatewayActions::ENDPOINTS`):

| Entorno | Crear transacción / getInfoCredit | Visor (no usado: modo Redirect) |
|---|---|---|
| Production | `https://api.sistecredito.com/Spay/PasCheckout/checkout/create/transaction/sistecredito` · `.../getInfoCredit?transactionId=` | `stoprdeu2sistepayecomerc.blob.core.windows.net/ecommerce/visor/visor.js` |
| Staging | `https://api-co-stg.sistecreditocloud.com/...` | `stostgeu2sistepayecommer.blob.core.windows.net/...` |
| Qa | `https://api-co-nop-internal.sistecreditocloud.com/...` | `stonprdeu2sistepayecomme.blob.core.windows.net/...` |

Creación (servidor → Sistecrédito):
- `POST` JSON con headers: `Content-Type: application/json`, `Ocp-Apim-Subscription-Key`
  (Subscription Key del tenant), `SCLocation: 0,0`, `country: co`, `SCOrigen: <entorno>`,
  `Authentication: <JWT HS256>`.
- JWT por transacción firmado con token propio; payload `{iss, aud, iat, nbf: iat+30}` con
  `iss`/`aud` = URL pública del comercio. El plugin usa un `uniqid` guardado en BD; aquí se
  usa un **token determinista** `HMAC-SHA256(SISTECREDITO_JWT_SECRET, "ORDER-<saleId>")`
  (verificable sin persistir estado).
- Body: `{typeDocument: "CC"|"CE", idDocument, transactionDate (ISO con offset),
  valueToPaid (numérico), vendorId, storeId, orderId (int), responseUrl}`.
- Respuesta 200: `data.urlToRedirect` + `data.transactionId` → el usuario va a
  `urlToRedirect?transactionId=...`. Errores: `message`/`errorCode` (catálogo 800–827).

Confirmación (webhook servidor → comercio):
- `POST` JSON: `TypeDocument, IdDocument, ValueToPay, OrderId, CreditNumber, Authentication
  (JWT), TransactionStatus ("Terminado"|"Error"|"Abandonada"), TransactionId`.
- Validar: documento `CC|CE` y numérico; JWT HS256 contra el token de la venta + `aud`;
  monto `ValueToPay` == total (centavos).
- Respuesta (acuse): `{"function","errorCode","message","country":"co","data":{"orderId",
  "transactionId","status":"VALID"|"ERROR","errors":[]}}` con HTTP 200.
- `Terminado` → pagar; `Abandonada` → 827 (sigue pendiente); otros → 823; JWT → 825;
  parámetros → 822; monto → 826.

Retorno del usuario (GET al mismo endpoint, `transactionId` + `orderId`): validar con
`getInfoCredit` (`data.transactionStatus === 3` = aprobada) y liquidar idempotente.

## 2. Implementación (esta versión)

1. **DDL** `docs/migrations/v0.12.6-sistecredito-ids.sql`: columnas
   `sistecredito_vendor_id` / `sistecredito_store_id` en `tec_tenant_payment_settings`.
2. **Env**: `SISTECREDITO_API_BASE_URL` (default producción), `SISTECREDITO_ORIGIN`
   (SCOrigen), `SISTECREDITO_JWT_SECRET` (nuevo), `SISTECREDITO_AUDIENCE_URL`
   (iss/aud; fallback `PUBLIC_API_URL`), `SISTECREDITO_CALLBACK_URL` (fallback
   `PUBLIC_API_URL/api/webhooks/sistecredito`). Se retira `SISTECREDITO_CHECKOUT_BASE_URL`.
3. **`sistecredito.service.ts`** (reescritura): builders puros (token, JWT, payload,
   fecha con offset, normalización de documento, mapeo de errores, acuse),
   `createCheckoutLink` real (fail-closed + cédula obligatoria del perfil),
   `verifyTransaction` (getInfoCredit), `verifyConfirmationJwt`.
4. **Webhook**: `POST /api/webhooks/sistecredito` (acuse exacto; se retira
   `x-webhook-secret`) y `GET /api/webhooks/sistecredito` (retorno del usuario con
   `getInfoCredit` + redirección al `return_url` del tenant).
5. **Specs** de los builders + **script** `test-sistecredito-integration.ts`.
6. **Docs**: este plan, `sistecredito-integracion.md`, `AGENTS.md`, `README.md`,
   `.env.example`.

## 3. Certificación y activación

1. Pedir al asesor credenciales de **Qa/Staging** + política de reintentos del webhook y
   proceso de reembolsos (el plugin no trae API de reembolso).
2. Certificar en Staging (override `SISTECREDITO_API_BASE_URL`/`SISTECREDITO_ORIGIN`):
   venta → redirect → confirmación `Terminado` → `paid` + `paid_by='Sistecredito'` + puntos;
   negativos: JWT inválido (825), monto (826), abandonada (827).
3. Operador: correr DDL → cargar credenciales (`enabled=false`) → deploy API.
4. E2E producción con monto mínimo controlado → habilitar `sistecredito_enabled=true`
   para Princess Skin.

## 4. Notas

- El token JWT determinista replica el mecanismo del plugin (token propio por intento,
  verificación del JWT de confirmación); se confirma end-to-end en certificación.
- Ante errores de confirmación la venta NO se marca fallida (a diferencia del plugin
  WooCommerce): queda `due` y el staff la gestiona en el POS.
- El checkout con combos sigue restringido a cash/Bold.
- Hallazgo ajeno: la pantalla de edición de pedidos del wp-admin de la tienda devuelve
  HTTP 500 (avisar al administrador de la tienda).
