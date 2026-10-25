# Plan: Fix definitivo Addi — 400 "La solicitud no tiene el formato correcto" (v0.3.96)

Estado: **ejecutado en código (v0.3.96)** — `tsc` OK, 25/25 specs y dry-run del script OK; pendiente build/push + deploy en VPS (sin DDL). Causa raíz confirmada contra el OpenAPI spec oficial (2026-10-19). Imagen a desplegar: `v0.12.3` (continúa la línea de producción; el fix de feature es v0.3.96). Fecha: 2026-10-19.

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

## 5. ⚠️ Bloqueante de PRODUCCIÓN (decisión del usuario)
**Documento del cliente**: hoy todo checkout envía la CC de prueba `1001234567` (sandbox). En producción es inválido (KYC) y Addi responde **409** si la CC ya tiene crédito. Opciones: (a) DDL aprobada `tec_customers.document_type/document_number` + captura en la app; (b) reutilizar `cf1`/`cf2` legacy; (c) pedirlo en cada checkout. **Recomendado (a)**.

## 6. Preguntas abiertas
1. ¿Credenciales de **staging** de Addi? (soporte_aliados@addi.com / WhatsApp +57 1 580 6869) — para validar el 301 sin tocar producción.
2. ¿Campo de documento del cliente: DDL o temporal?
3. ¿Confirmar contratación del flujo "Custom Integrations" (este endpoint) y no "Paylink" (WhatsApp, `storeId`, sin URL de retorno)?