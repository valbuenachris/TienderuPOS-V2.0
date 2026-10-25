# Sistecrédito — Checklist para la integración real (v0.12.4)

Estado (2026-10-19): **plumbing listo, pasarela real pendiente**.

## Qué YA quedó (desplegado v0.12.2/v0.12.3)
- Gate por tenant: Princess Skin tiene `sistecredito_enabled=true` + `sistecredito_api_key` en `tec_tenant_payment_settings` ⇒ el checkout **ya no responde** "no configurado".
- Webhook `POST /api/webhooks/sistecredito` **fail-closed** (`x-webhook-secret` con comparación en tiempo constante) que liquida el pedido (`registerGatewayPayment 'Sistecredito'`, idempotente, acredita puntos).
- `api/src/payments/sistecredito.service.ts` con la estructura definitiva (credenciales del tenant, logging, TODOs).

## Qué NO funciona todavía (por esto no se puede cobrar de verdad)
- `createCheckoutLink` devuelve un **link sandbox ficticio** (`SISTECREDITO_CHECKOUT_BASE_URL?order=ORDER-<id>`, default `https://sandbox.sistecredito.com/checkout`): no existe un flujo de pago real; el pedido quedaría `due` para siempre y jamás llega webhook.
- **No conocemos el contrato real** (auth, endpoint, payload, webhook). No se implementa a ciegas — con Addi inventar el payload costó un 400 durante días.

## Mitigación hasta tener el contrato (recomendada)
Deshabilitar el método para que la app muestre el mensaje limpio ("no está configurado para esta tienda…") en vez de abrir un link falso. Reversible en segundos:

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
1. `createCheckoutLink` real en `sistecredito.service.ts` (espejo de `AddiService`: auth → POST → parseo de la URL → logging con trace).
2. Ajustar el webhook al formato/autenticación reales (hoy `x-webhook-secret`).
3. Script `api/src/scripts/test-sistecredito-integration.ts` (como `test-addi-integration.ts`).
4. Specs + `tsc` + tests, y deploy **v0.12.4** (sin DDL).

## Cómo pedirlo
Usa el canal de tu asesor comercial de Sistecrédito (o el portal de aliados donde generaste las llaves actuales). Las llaves que ya están en la BD sirven solo si el contrato indica cómo usarlas — hoy el código ni las envía a ningún lado.
