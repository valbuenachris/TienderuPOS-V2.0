# Plan: Fix definitivo Addi — 400 "La solicitud no tiene el formato correcto" (v0.3.96)

Estado: **EN PRODUCCIÓN (v0.12.5, 2026-10-26)** — spec oficial confirmada; el código v0.3.96 cumple el `OnlineLoanApplicationRequest` y v0.12.5 agrega la cédula real del cliente: DDL `docs/migrations/v0.12.5-customer-document.sql` aplicada, env productivo (`ADDI_AUTH_URL=https://auth.addi.com/oauth/token`, `ADDI_AUDIENCE`/`ADDI_API_BASE_URL=https://api.addi.com`, sin `ADDI_TEST_DOCUMENT_NUMBER`), claves de producción del tenant cargadas en `tec_tenant_payment_settings` y **token OAuth2 verificado (200)**; API `v0.12.5` healthy. Captura de la cédula en el perfil de la app (`PUT /api/customer/profile`) + validaciones estrictas (cédula/celular 10 dígitos/dirección) y mensaje claro para el 409. App `tienda_virtual` versionada (repo `tienda-virtual-app`, commits de cédula incluidos). Pendiente: E2E en producción con CC real (checkout → webhook `APPROVED` → `paid`/`ADI`) y distribución del APK nuevo.

## 1. Causa raíz (evidencia oficial)

El payload de `buildAddiPayload` (`api/src/payments/addi.service.ts`) usaba un schema inventado (snake_case, plano, `customer`/`items.price`, montos numéricos). El contrato real — **ADDI API · Integración con un E-commerce - CO**, OpenAPI 3.0.3 en `https://api-docs.addi-staging.com/integration/swagger-ui-init.js` (`components.schemas.OnlineLoanApplicationRequest`, `Item`, `ClientInfo`, `AllyUrlRedirection`) — exige otro schema:

- `POST https://api.addi.com/v1/online-applications` (staging: `https://api.addi-staging.com/v1/online-applications`) → responde **301 + header `Location`** (redirección manual; ya soportado ✅).
- **Requeridos**: `orderId`, `totalAmount`, `shippingAmount`, `currency`, `client`, `allyUrlRedirection`, `items`.
- **`client.address` es obligatoria** (`lineOne`/`city`/`country`) — hoy no se envía.
- Montos y cantidades como **strings** (`"45000.0"`, `"2"`); `unitPrice` (no `price`); sin `total_amount` por ítem.
- `callbackUrl` + `redirectionUrl` van **anidados** en `allyUrlRedirection` (camelCase).
- `cellphone` (10 dígitos) + `cellphoneCountryCode` (`"+57"`) separados.
- No existen `external_reference`, `buyer`, `products`, `return_url`, `notify_url`, `discount_amount`, `ally_slug` (este último solo aplica al endpoint de config de canales).
- Token: la doc recomienda **generar un token por transacción** (no cachear).
- Callback: `approvedAmount` (no `amount`), enum UPPERCASE `APPROVED|PENDING|REJECTED|ABANDONED|DECLINED|INTERNAL_ERROR`.

### Tabla de discrepancias (antes → spec)

| Enviábamos (❌) | Spec oficial (✅) |
|---|---|
| `order_id` | `orderId` (string, único por intento) |
| `total_amount`/`amount` (number) | `totalAmount` (string `"45000.0"`) |
| `shipping_amount` (number) | `shippingAmount` (string, requerido, `"0.0"`) |
| `tax_amount` (number) | `totalTaxesAmount` (string, opcional) |
| `discount_amount` | no existe (implícito en `totalAmount`) |
| `customer{first_name,last_name,email,phone,document_type,document_number}` | `client{idType,idNumber,firstName,lastName,email,cellphone,cellphoneCountryCode,address{lineOne,city,country}}` |
| `callback_url`/`redirection_url` (flat) | `allyUrlRedirection{callbackUrl,redirectionUrl}` |
| `items[].price` (number) | `items[].unitPrice` (string) |
| `items[].quantity` (number) | `items[].quantity` (string) |
| `items[].total_amount` | no existe |
| bloque `shipping{first_name,…,address,city,country}` | opcionales `shippingAddress`/`billingAddress` = `{lineOne,city,country}` |

## 2. Cambios de código (sin DDL)

### A. `api/src/payments/addi.service.ts`
1. `buildAddiPayload` nuevo con el schema oficial; helpers `toAddiAmount` (`"X.0"`/`toFixed(2)`) y `normalizeAddiCellphone` (10 dígitos, sin indicativo).
2. `client.address` real: consulta a `customer_addresses` (default primero: `street_address`, `city`) con fallback `Calle Falsa 123`/`Bogotá`; `lineOne`/`city`/`country: 'CO'`. `shippingAddress`/`billingAddress` se envían solo si hay dirección real y `ADDI_SEND_SHIPPING !== 'false'`.
3. **Token por transacción** (sin caché), según la doc.
4. Ítems con `tax` informativo (`subtotal × p.tax%`), `quantity`/`unitPrice` string.
5. **Retirar los bisect knobs** (`ADDI_AMOUNT_FIELD`, `ADDI_ITEM_PRICE_FIELD`, `ADDI_ORDER_ID_STYLE`, `ADDI_REDIRECT_STRIP_QUERY`) y `buildAddiOrderId`/`stripQueryString`/`normalizePhoneForAddi` (reemplazados). Se conserva `ADDI_DEBUG_PAYLOAD`.
6. `requestLoanCancellation`/refunds: fuera de alcance.

### B. `api/src/payments/payments.service.ts`
- Webhook Addi: leer `approvedAmount` (fallback `amount`) y loggear el estado tal cual (ya solo `APPROVED` liquida).

### C. `api/scripts/test-addi-integration.ts` (NUEVO)
Script `tsx` para validar el payload antes de la app:
- Args: `--tenant <uuid>` (default Princess Skin), `--sale <id>` (usa venta real) o `--synthetic` (datos de ejemplo), `--amount <n>`, `--dry-run`, `--base-url`, `--path`.
- Lee `.env` (raíz), credenciales del tenant desde `tec_tenant_payment_settings`, obtiene token, imprime payload completo (email/teléfono enmascarados) y URL exacta; sin `--dry-run` hace POST con `redirect:'manual'` y loggea **status, `x-trace-id`, `Location` y cuerpo completo** + timing. Exit 0 si 301/200.

### D. Tests y documentación
- `addi.service.spec.ts`: snapshots del schema oficial (amounts strings, `client.address`, `allyUrlRedirection`, celular `+57`).
- `AGENTS.md` + `README.md`: schema oficial, knobs retirados, `approvedAmount`, token por transacción, `customer_addresses` como fuente de la dirección.

## 3. Deploy (sin DDL, sin cambios en la app)
1. File-server: build+push `pos-gres-v2-api` con `IMAGE_TAG` nuevo (`v0.12.3` propuesto).
2. VPS: verificar `ADDI_API_BASE_URL=https://api.addi.com`, `ADDI_APPLICATIONS_PATH=/v1/online-applications`, `ADDI_AUTH_URL`/`ADDI_AUDIENCE` de producción; `docker compose pull api && up -d api`.
3. Opcional: borrar del `.env` del VPS los 4 knobs obsoletos.

## 4. Verificación
1. `npx tsx scripts/test-addi-integration.ts --tenant ac344fcc-… --dry-run` → revisar payload.
2. Sin dry-run → esperado **301 + `Location`** (staging idealmente).
3. App: checkout Addi → abre Addi → webhook `APPROVED` → `paid` + `tec_payments.paid_by='ADI'` y `approvedAmount` cuadrado.
4. Regresión cash/Bold/Sistecrédito; `tsc --noEmit` + specs.

## 5. ✅ RESUELTO (v0.12.5) — Documento del cliente
Hoy todo checkout enviaba la CC de prueba `1001234567` (solo sandbox). Desde v0.12.5: DDL aprobada (`tec_customers.document_type/document_number`), captura **solo en el perfil de la app** (`PUT /api/customer/profile`, opción **a**), y en producción (sin `ADDI_TEST_DOCUMENT_NUMBER`) el `AddiService` exige cédula real + celular de 10 dígitos + dirección real con mensajes claros; el 409 (cliente con crédito activo) también responde un mensaje específico.

## 6. Preguntas abiertas
1. ¿Credenciales de **staging** de Addi? (soporte_aliados@addi.com / WhatsApp +57 1 580 6869) — para validar el 301 sin tocar producción.
2. ¿Campo de documento del cliente: DDL o temporal?
3. ¿Confirmar contratación del flujo "Custom Integrations" (este endpoint) y no "Paylink" (WhatsApp, `storeId`, sin URL de retorno)?