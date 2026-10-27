# Sistecrédito — Estado de la integración (2026-10-27)

Estado: **CERTIFICADO EN PRODUCCIÓN (v0.12.7)** — pago real aprobado end-to-end en la
tienda Princess Skin (venta `paid` con `paid_by='Sistecredito'`). Regla de negocio
confirmada: monto mínimo **$10.000** por transacción (v0.12.7 lo traduce a un mensaje
claro). `sistecredito_enabled=true`; producción corre v0.12.6 y v0.12.7 (solo mensajes)
queda listo para el próximo deploy.

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

## 4. Certificación — HECHA en producción (2026-10-27)

Se certificó directo en producción con una venta mínima controlada (decisión del
2026-10-27; no se usó Sandbox). Resultado: **pago real aprobado end-to-end** (checkout →
portal Sistecrédito → webhook `Terminado`/retorno GET → venta `paid` con
`paid_by='Sistecredito'` + puntos). Incidentes/reglas descubiertos:

- **Monto mínimo $10.000**: la pasarela rechaza montos menores con
  `{"errorCode":400,"message":"NotValidTransactionValue Value cannot be less than 10000"}`
  (HTTP 200). Desde **v0.12.7** el API lo traduce a mensaje claro en la app
  (`mapSistecreditoErrorDetail`).
- La Subscription Key debe cargarse **real** (32 hex, prefijo `feb4d6c0`): un placeholder
  produce un `400` genérico en el checkout. Verificar tras cada carga:
  `length(sistecredito_api_key)`.
- El documento (CC) del comprador es obligatorio (mismo guard que Addi v0.12.5).
- El mensaje genérico sin detalle en la app implica revisar
  `docker compose logs api | grep -i create-transaction` (el log trae el body completo).

## 5. Activación

`sistecredito_enabled=true` para Princess Skin desde el 2026-10-27 (pasarela en vivo).
El correo al asesor (Sandbox/reintentos/reembolsos) quedó descartado por decisión del
2026-10-27; dudas de reembolsos se resolverán con el asesor si aparece un caso real.

## 6. Notas

- El token JWT determinista replica el mecanismo del plugin (token propio por intento);
  **confirmado end-to-end** en la certificación productiva del 2026-10-27.
- Ante errores de confirmación la venta **no** se marca fallida (a diferencia del plugin
  WooCommerce): queda `due` y el staff la gestiona en el POS.
- Hallazgo ajeno a la integración: la pantalla de edición de pedidos del wp-admin de la
  tienda devuelve HTTP 500 (avisar al administrador de la tienda).
