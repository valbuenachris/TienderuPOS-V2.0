# Sistecrédito — Checklist para la integración real

Estado (2026-10-26): **plumbing listo; credenciales recibidas; pasarela REAL pendiente de documentación**.

## Actualización 2026-10-26
- Credenciales de producción recibidas del asesor: **Vendor ID**, **Store ID** y **Subscription Key** (la key se guarda solo en BD/`.env`, nunca en este doc). Mapeo previsto: Subscription Key → `sistecredito_api_key` (header probable `Ocp-Apim-Subscription-Key`), y Vendor/Store → columnas nuevas `sistecredito_vendor_id`/`sistecredito_store_id` (DDL a ejecutar junto con la implementación real).
- **Mitigación aplicada**: `sistecredito_enabled=false` para Princess Skin (2026-10-26) — nadie recibe el link sandbox ficticio; el checkout responde el mensaje limpio "no configurado para esta tienda".
- Sondeo externo: `api.sistecredito.com` existe (gateway) pero **no expone Swagger ni rutas públicas**; sin la documentación de endpoints/payload/webhook **no se implementa** (lección de Addi: no inventar el contrato).
- **Bloqueante**: pedir al asesor el paquete de integración (checklist de abajo; en especial: endpoint de creación del link, método de auth real, formato/autenticación del webhook y ambiente de PRUEBAS).

## Qué YA quedó (desplegado v0.12.2/v0.12.3)
- Gate por tenant implementado en `tec_tenant_payment_settings` (histórico: Princess Skin llegó a tener `enabled=true`; **desde 2026-10-26 está `enabled=false` como mitigación**, ver arriba).
- Webhook `POST /api/webhooks/sistecredito` **fail-closed** (`x-webhook-secret` con comparación en tiempo constante) que liquida el pedido (`registerGatewayPayment 'Sistecredito'`, idempotente, acredita puntos).
- `api/src/payments/sistecredito.service.ts` con la estructura definitiva (credenciales del tenant, logging, TODOs).

## Qué NO funciona todavía (por esto no se puede cobrar de verdad)
- `createCheckoutLink` devuelve un **link sandbox ficticio** (`SISTECREDITO_CHECKOUT_BASE_URL?order=ORDER-<id>`, default `https://sandbox.sistecredito.com/checkout`): no existe un flujo de pago real; el pedido quedaría `due` para siempre y jamás llega webhook.
- **No conocemos el contrato real** (auth, endpoint, payload, webhook). No se implementa a ciegas — con Addi inventar el payload costó un 400 durante días.

## Mitigación (APLICADA el 2026-10-26)
El método quedó deshabilitado para que la app muestre el mensaje limpio ("no está configurado para esta tienda…") en vez de abrir un link falso. Reversible en segundos cuando la pasarela real esté validada:

```sql
UPDATE public.tec_tenant_payment_settings
SET sistecredito_enabled = false, updated_at = now()
WHERE tenant_id = 'ac344fcc-d3bf-4c0d-b8ab-135c985ce8df';
-- Caché de 60 s; para efecto inmediato: docker compose restart api (o up -d api)
```

## Checklist para Sistecrédito (solicitar al asesor comercial / portal de aliados)

1. **Producto contratado**: ¿Botón de pago web / Link de pago / API de crédito / otro? (define el endpoint y el flujo de retorno).
2. **Documentación/Postman de integración** (request y response exactos).
3. **Credenciales de producción**: usuario/clave o API key + **código de comercio** (merchant id) + cualquier id adicional requerido en el payload.
4. **Credenciales/env de PRUEBAS** (sandbox) para validar sin afectar métricas — igual que hicimos con Addi.
5. **Endpoints**: autenticación (si es por token: URL y método), creación de la transacción/link, consulta de estado.
6. **Request schema**: campos y tipos exactos (¿montos string o entero? ¿ítems? ¿documento del cliente? ¿código de comercio?).
7. **Response**: ¿devuelve una URL de redirección lista para abrir en el navegador (como el 301 de Addi)? ¿la envía por SMS/WhatsApp? (define qué muestra la app).
8. **Webhook/notificación**:
   - URL a registrar (nosotros damos `https://pos.tienderu.com/api/webhooks/sistecredito`).
   - Formato exacto del payload (campos de referencia/estado/approvedAmount).
   - **Método de autenticación** (¿`x-webhook-secret`? ¿Basic Auth? ¿firma HMAC? ¿otra?).
   - Estados posibles (approved/rejected/…) y si reintenta ante fallos.
9. **URLs de retorno/redirect** requeridas y si hay que registrarlas por comercio.
10. Límites: expiración de la transacción, montos mín/máx, cancelaciones/reembolsos por API.

## Plan de implementación (en cuanto llegue el paquete anterior)
1. DDL `docs/migrations/…-sistecredito-ids.sql`: columnas `sistecredito_vendor_id`/`sistecredito_store_id` en `tec_tenant_payment_settings`; cargar las credenciales del tenant (Subscription Key → `sistecredito_api_key`) manteniendo `enabled=false` hasta validar el flujo.
2. `createCheckoutLink` real en `sistecredito.service.ts` (espejo de `AddiService`: auth → POST → parseo de la URL → logging con trace).
3. Ajustar el webhook al formato/autenticación reales (hoy `x-webhook-secret`).
4. Script `api/src/scripts/test-sistecredito-integration.ts` (como `test-addi-integration.ts`).
5. Specs + build/tests, deploy con el `IMAGE_TAG` de turno y luego habilitar `sistecredito_enabled=true` para el tenant.

## Cómo pedirlo
Usa el canal de tu asesor comercial de Sistecrédito (o el portal de aliados donde se generaron las credenciales). Sin el paquete (endpoints/auth/webhook/sandbox) el código no puede enviar nada a la pasarela — hoy el método está deshabilitado a propósito.
