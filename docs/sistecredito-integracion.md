# Sistecrédito — Estado de la integración (2026-10-26)

Estado: **IMPLEMENTACIÓN REAL v0.12.6 — pendiente certificación y activación**.

El contrato real se capturó del **plugin oficial de WooCommerce** (`sistecredito` v1.13.0)
instalado en la tienda Princess Skin (wp-admin, solo lectura), y la implementación replica
su flujo al pie de la letra. Plan aprobado y detalle técnico: `docs/plan-sistecredito.md`.

## 1. Credenciales del comercio (obtenidas del wp-admin)

| Campo | Valor |
|---|---|
| Vendor ID | `68000298a417fd2b05dcf776` |
| Store ID | `68b5fc677d52358a31ab842b` |
| Subscription Key | En el wp-admin → WooCommerce → Ajustes → Pagos → Sistecrédito; **NO** se versiona aquí. Destino: `tec_tenant_payment_settings.sistecredito_api_key` |

Entorno configurado en la tienda: **Production** · modo **Redirect** (sin widget "On Same
Site") · simulador de cuotas activo · URL de retorno propia vacía.

Carga (DML del operador, mantener `enabled=false` hasta certificar):

```sql
UPDATE public.tec_tenant_payment_settings
SET sistecredito_vendor_id = '68000298a417fd2b05dcf776',
    sistecredito_store_id = '68b5fc677d52358a31ab842b',
    sistecredito_api_key = '<SUBSCRIPTION_KEY>',
    updated_at = now()
WHERE tenant_id = 'ac344fcc-d3bf-4c0d-b8ab-135c985ce8df';
-- Caché de 60 s; para efecto inmediato: docker compose restart api
```

Requiere la migración `docs/migrations/v0.12.6-sistecredito-ids.sql` (columnas
`sistecredito_vendor_id`/`sistecredito_store_id`).

## 2. Contrato real (del plugin v1.13.0)

| Entorno | API | SCOrigen |
|---|---|---|
| Production | `https://api.sistecredito.com` | `Production` |
| Staging | `https://api-co-stg.sistecreditocloud.com` | `Staging` |
| Qa | `https://api-co-nop-internal.sistecreditocloud.com` | `Qa` |

- **Crear transacción**: `POST /Spay/PasCheckout/checkout/create/transaction/sistecredito`
  con `Ocp-Apim-Subscription-Key`, `SCLocation: 0,0`, `country: co`, `SCOrigen`,
  `Authentication: <JWT HS256>`; body `{typeDocument, idDocument, transactionDate,
  valueToPaid, vendorId, storeId, orderId, responseUrl}` → 200 `data.urlToRedirect` +
  `data.transactionId`. Errores 800–827 (catálogo en el plugin; públicos mapeados en
  `sistecredito.service.ts`).
- **Confirmación (webhook)**: `POST` JSON con `TypeDocument/IdDocument/ValueToPay/OrderId/
  CreditNumber/Authentication/TransactionStatus/TransactionId`; JWT verificado contra el
  token de la venta + `aud`; monto comparado con el total; acuse JSON
  `{function,errorCode,message,country,data{orderId,transactionId,status,errors}}` con
  HTTP 200. Estados: `Terminado` → pagado · `Abandonada` → 827 (sigue pendiente) · resto 823.
- **getInfoCredit**: `GET /Spay/PasCheckout/checkout/getInfoCredit?transactionId=`
  (`data.transactionStatus === 3` = aprobada; `data.credit.creditNumber`,
  `data.valueToPaid`) — usado en el retorno del usuario como respaldo del webhook.
- **Visor "On Same Site"** (no implementado; usamos Redirect): web-component `<app-visor>`
  + `visor.js` de Azure Blob por entorno.

## 3. Implementado en pos-gres-v2 (v0.12.6)

- `api/src/payments/sistecredito.service.ts` — cliente real + builders puros (token
  determinista `HMAC(secreto, "ORDER-<saleId>")`, JWT HS256, payload, fecha con offset,
  normalización de documento, mapeo de errores, acuse) + `verifyTransaction`.
- Webhook `POST /api/webhooks/sistecredito` (acuse oficial, fail-closed por JWT/monto) y
  retorno `GET /api/webhooks/sistecredito` (getInfoCredit + liquidación idempotente +
  redirect al `return_url`). Se retiró el esquema provisional `x-webhook-secret`.
- Migración `docs/migrations/v0.12.6-sistecredito-ids.sql`, env nuevas
  (`SISTECREDITO_API_BASE_URL`, `SISTECREDITO_ORIGIN`, `SISTECREDITO_JWT_SECRET`,
  `SISTECREDITO_AUDIENCE_URL`, `SISTECREDITO_CALLBACK_URL`) y script manual
  `api/src/scripts/test-sistecredito-integration.ts`.
- Specs: `api/src/payments/sistecredito.service.spec.ts` (token/JWT/payload/errores/acuse).

## 4. Certificación (pasos)

1. Pedir al asesor de Sistecrédito: **credenciales de Qa/Staging**, política de
   reintentos del webhook y proceso de reembolsos/cancelaciones (el plugin no trae API
   de reembolso).
2. Certificar en Staging (override de env: `SISTECREDITO_API_BASE_URL` +
   `SISTECREDITO_ORIGIN=Staging` y credenciales del ambiente):
   - venta de prueba → redirect → confirmación `Terminado` → `paid` + `paid_by='Sistecredito'` + puntos;
   - negativos: JWT inválido (825), monto no coincide (826), abandonada (827), sin documento (400 claro).
3. Operador: correr DDL v0.12.6 → cargar credenciales (`enabled=false`) → deploy API.
4. E2E en producción con monto mínimo controlado → `UPDATE ... SET sistecredito_enabled=true`
   para Princess Skin (reversible en segundos durante la ventana).

## 5. Mitigación vigente

`sistecredito_enabled=false` para Princess Skin (desde 2026-10-26): la app muestra el
mensaje limpio "no configurado para esta tienda" hasta terminar la certificación.

## 6. Notas

- El token JWT determinista replica el mecanismo del plugin (token propio por intento);
  se confirma end-to-end en la certificación de Staging.
- Ante errores de confirmación la venta **no** se marca fallida (a diferencia del plugin
  WooCommerce): queda `due` y el staff la gestiona en el POS.
- Hallazgo ajeno a la integración: la pantalla de edición de pedidos del wp-admin de la
  tienda devuelve HTTP 500 (avisar al administrador de la tienda).
