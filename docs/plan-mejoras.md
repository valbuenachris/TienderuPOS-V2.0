# Plan: Pagos Tienda Virtual v0.3.85 — Fix Addi (400) y Sistecrédito (no configurado)

Estado: **desplegado (v0.12.2)** — API en VPS `healthy` con los fixes; SQL de Sistecrédito aplicado para Princess Skin (`key_ok`/`secret_ok`). Pendiente: pruebas E2E en la app, bisect del 400 de Addi con los knobs y respuesta de soporte (§8). Fecha: 2026-10-19.

## 1. Contexto y alcance

- La app móvil (`tienda_virtual`, tenant **Princess Skin**, `tenant_id ac344fcc-d3bf-4c0d-b8ab-135c985ce8df`) cobra los pedidos en la **cuenta de pasarelas del tenant**.
- Backend `pos-gres-v2`: pagos por tenant v0.3.78 (`tec_tenant_payment_settings`), Bold tenant (`TenantBoldService`), Addi real (`AddiService` v0.3.79–84), Sistecrédito **stub** de checkout.
- La app Flutter **no requiere cambios** para estos fixes: solo llama `POST /api/customer/checkout-with-payment` y muestra el error que devuelve la API. Todo el fallo ocurre en el backend.
- Fallos reportados:
  - **Addi**: la creación de solicitud devuelve 400 "Formato incorrecto" (trace-ids: `dde4c291-8d8b-4973-a16e-52c1cc930c97`, `53bece31-b382-4e66-a404-092a7d7e9a6e`, `16a60ab7-738f-43b6-9c79-9a8fc5b1a50e`).
  - **Sistecrédito**: checkout → 400 "Este método de pago no está configurado para esta tienda. Por favor, elija Efectivo." (falta fila/llave del tenant en la tabla).
- Alcance v0.3.85: **solo API + DML de configuración**. Sin DDL nuevo.

## 2. Diagnóstico

### 2.1 Addi (400 "Formato incorrecto")

Evidencia: auth OK (no 401 — OAuth2 funciona) y endpoint OK (no 404) ⇒ el body es rechazado por el esquema.

Payload actual (`api/src/payments/addi.service.ts:219-247`):

```json
{
  "order_id": "ORDER-<saleId>-<ts36>",
  "amount": 45000,
  "currency": "COP",
  "customer": { "first_name": "…", "last_name": "…", "email": "…", "phone": "57XXXXXXXXXX", "document_type": "CC", "document_number": "1001234567" },
  "callback_url": "https://pos.tienderu.com/api/webhooks/addi",
  "redirection_url": "https://pos.tienderu.com/config?payment=return",
  "items": [{ "sku": "…", "name": "…", "quantity": 1, "price": 45000 }],
  "shipping": { "first_name": "…", "last_name": "…", "phone": "57XXXXXXXXXX", "address": "Calle Falsa 123", "city": "Bogotá", "country": "CO" }
}
```

POST a `{ADDI_API_BASE_URL}{ADDI_APPLICATIONS_PATH}` con `Authorization: Bearer <jwt>`.

Hipótesis ordenadas por probabilidad (confirmar contra la doc oficial / soporte):

1. **[ALTA]** Raíz `amount` debe llamarse `total_amount`.
2. **[ALTA]** `items[].price` debe llamarse `unit_price` (y probablemente incluir `total_amount` por ítem).
3. **[MEDIA]** Faltan `tax_amount` / `shipping_amount` / `discount_amount` en raíz; el total debe reconciliar con la suma de ítems.
4. **[MEDIA]** La forma del bloque `shipping` no es la esperada (probar con `ADDI_SEND_SHIPPING=false`).
5. **[MEDIA-BAJA]** `redirection_url` con query params (`?payment=return`) es rechazada (probar URL sin query).
6. **[BAJA]** El formato de `order_id` con prefijo/guiones es rechazado (probar variante numérica).
7. **[BAJA]** Faltan campos opcionales (`metadata`/`external_reference`), `ally_slug`, o headers extra (`x-api-key`). Preguntar a soporte; `ally_slug` hoy solo se usa para `GET /allies/{ally_slug}/config` (ver TODO en `addi.service.ts:217-218`).

Restricción del entorno: `docs.addi.com` no es accesible desde el sandbox (403) ⇒ obtener el contrato/Postman oficial y el motivo exacto del 400 con los trace-ids.

### 2.2 Sistecrédito

Cadena del error verificada:

`checkoutWithPayment` (`payments.service.ts:59`) → `TenantPaymentSettingsService.requireProvider(tenantId, 'sistecredito')` (`tenant-payment-settings.service.ts:118-126`) → sin fila / `sistecredito_enabled=false` / `sistecredito_api_key` nula → 400 `PAYMENT_NOT_CONFIGURED_MESSAGE` (constante en `tenant-payment-settings.service.ts:20-21`).

La tabla (v0.3.78) y el servicio ya existen; **solo falta la configuración del tenant** (DML) + endurecer el webhook + mover el stub a un servicio propio.

## 3. Cambios propuestos (v0.3.85, sin DDL)

### A. `api/src/payments/addi.service.ts`

1. Payload primario corregido:
   - Raíz: `order_id / total_amount / currency / tax_amount / shipping_amount (=0) / discount_amount / customer / callback_url / redirection_url / items`.
   - Ítems: `{ sku, name, quantity, unit_price, total_amount }`.
   - Mantener customer/document como están (`document_type: 'CC'`, `document_number` desde `ADDI_TEST_DOCUMENT_NUMBER`).
2. Toolkit de **bisect temporal** vía env (retirar tras confirmar contrato contra la doc):
   - `ADDI_AMOUNT_FIELD=total_amount|amount`
   - `ADDI_ITEM_PRICE_FIELD=unit_price|price`
   - `ADDI_ORDER_ID_STYLE=prefixed|numeric`
   - `ADDI_REDIRECT_STRIP_QUERY=true|false`
   - `ADDI_SEND_SHIPPING` (ya existe, v0.3.84)
3. Logging reforzado:
   - Body completo (PII ya enmascarada) a nivel **warn** cuando `ADDI_DEBUG_PAYLOAD=true` (hoy solo en debug, puede no verse en producción).
   - Log de headers de request (sin secretos) y de response; mantener cuerpo completo + `errors[]` + `x-trace-id` en error (ya existe, `addi.service.ts:309-322`).
   - Snapshot del token request ya existe (`addi.service.ts:380-383`).
4. Extraer `buildAddiPayload()` como función pura (testeable) + tests de variantes en `addi.service.spec.ts`.

### B. `api/src/payments/sistecredito.service.ts` (NUEVO, espejo de `AddiService`)

- `createCheckoutLink()`: resuelve credenciales del tenant (`providerCredentials(settings, 'sistecredito')`), y:
  - Con contrato real confirmado: llama la API real de Sistecrédito (auth + creación de link).
  - Mientras el contrato no esté confirmado: mantiene el **link stub** actual (`SISTECREDITO_CHECKOUT_BASE_URL`, default sandbox) con TODO explícito, igual que tuvo Addi al inicio.
- Logging estructurado (payload, tenant, flush) sin filtrar secretos.
- Wiring: `payments.service.ts` reemplaza `createSistecreditoLink` (líneas 275-289) por la llamada al servicio; `payments.module.ts` registra el provider.
- `.env.example`: documentar `SISTECREDITO_CHECKOUT_BASE_URL` (hoy no está) y futuras variables (`SISTECREDITO_AUTH_URL`, `SISTECREDITO_API_BASE_URL`, `SISTECREDITO_WEBHOOK_SECRET` global no; el secreto va por tenant).

### C. Endurecer webhook Sistecrédito (fail-closed)

`payments.service.ts` `handleSistecreditoWebhook` (líneas 185-218): hoy, si el tenant está habilitado pero sin secreto, corre en "modo sandbox" (solo warning) — **no iguala a Addi**. Cambiar a:

- Secreto presente: `x-webhook-secret` con `secureCompare` (ya lo hace).
- Secreto ausente con tenant habilitado: **401** (fail-closed).
- Sin configuración o deshabilitado: mantener `{ received: true, handled: false }` (200 ignore).
- Documentar `x-webhook-secret` en el panel de Sistecrédito.

### D. Configuración del tenant (DML, operador)

Ejecutar el SQL de §4. No requiere migración ni redeploy.

### E. Documentación

Actualizar `README.md` y `AGENTS.md` con: resultado v0.3.85, knobs temporales de Addi, contrato Sistecrédito pendiente, y este plan.

## 4. SQL para configurar Sistecrédito (Princess Skin)

```sql
INSERT INTO public.tec_tenant_payment_settings
  (tenant_id, sistecredito_enabled, sistecredito_api_key,
   sistecredito_webhook_secret, updated_at)
VALUES
  ('ac344fcc-d3bf-4c0d-b8ab-135c985ce8df', true,
   '<SISTECREDITO_API_KEY>', '<SISTECREDITO_WEBHOOK_SECRET>', now())
ON CONFLICT (tenant_id) DO UPDATE SET
  sistecredito_enabled = EXCLUDED.sistecredito_enabled,
  sistecredito_api_key = EXCLUDED.sistecredito_api_key,
  sistecredito_webhook_secret = EXCLUDED.sistecredito_webhook_secret,
  updated_at = now();

-- Verificación
SELECT tenant_id, sistecredito_enabled,
       (sistecredito_api_key IS NOT NULL) AS key_ok,
       (sistecredito_webhook_secret IS NOT NULL) AS secret_ok
FROM public.tec_tenant_payment_settings
WHERE tenant_id = 'ac344fcc-d3bf-4c0d-b8ab-135c985ce8df';
```

Notas:
- El checkout exige `sistecredito_enabled=true` **y** `sistecredito_api_key` no nula; el secreto solo lo exige el webhook.
- `TenantPaymentSettingsService` cachea 60 s por tenant (re-chequeo de tabla cada 30 s) ⇒ reintentar el checkout tras ~1 minuto o reiniciar el API. No requiere redeploy.
- No crear la fila con llaves placeholder: el stub de Sistecrédito genera link sandbox mientras el contrato real no esté confirmado.

## 5. Webhook Sistecrédito (estado y plan)

- URL: `POST https://pos.tienderu.com/api/webhooks/sistecredito` (`payments.controller.ts:27-31`). **Mapeado y funcional.** ✓
- Seguridad actual: con secreto → `x-webhook-secret` + `secureCompare`; sin secreto → modo sandbox (NO fail-closed). ✗
- v0.3.85: fail-closed 401 cuando el tenant está habilitado y el secreto está ausente; mantener comparación de tiempo constante, estados `approved|paid|completed` y `readAmount` (acepta number o string).
- La liquidación registra `tec_payments.paid_by='Sistecredito'` y el pedido pasa de `due` a `paid` creditando puntos (`registerGatewayPayment`).

## 6. Pasos de ejecución (al aprobar)

1. Implementar A, B, C + specs (`addi.service.spec.ts` ampliado, `sistecredito.service.spec.ts` nuevo si aplica).
2. Verificar: `tsc --noEmit` + tests del API en verde.
3. Ejecutar el SQL DML (§4) en la base de datos.
4. Deploy: `IMAGE_TAG=v0.3.85` (build/push/pull/up). Sin DDL nuevo; sin cambios en la app móvil.
5. Pruebas E2E del checklist (§7) y actualizar README/AGENTS.md.

## 7. Verificación E2E

- **Addi**: checkout en la app → revisar el log con payload + `x-trace-id` → si 400, bisect con los knobs de §3A → confirmar con soporte Addi (enviar los 3 trace-ids) → el link (301 `Location`) abre Addi → webhook `approved` → pedido `paid` + `tec_payments.paid_by='ADI'`.
- **Sistecrédito**: SQL → checkout → `payment_url` (stub/real) → webhook con `x-webhook-secret` válido → `paid`; intento sin secreto → 401.
- **Regresión**: cash, Bold tenant, combos (cash/Bold) y suites de tests existentes.

## 8. Preguntas abiertas

1. Addi: ¿tienen la doc/Postman oficial de Custom Integrations (solicitud online)? ¿El cuerpo JSON completo del 400? ¿Se requiere `ally_slug` o header `x-api-key` adicional? ¿Los trace-ids salieron del header `x-trace-id`?
2. Sistecrédito: ¿llaves reales ya disponibles o mantenemos link stub? ¿Contrato/API y nombre del header del secreto?
3. ¿Autorizan los knobs temporales de bisect por env para Addi (recomendado, dado que su doc no es accesible desde el entorno) o prefieren solo el payload corregido + consulta a soporte?