# Plan: Bot de ventas por WhatsApp (Evolution + OpenRouter) — v0.6.0 / v0.6.1

Estado: **ejecutado completo** (API v0.6.0 + web v0.6.1). Fecha: 2026-10-18.

## Decisiones confirmadas por el usuario
- **DDL aprobada**: `ALTER tec_tenant_whatsapp_settings` (agent_enabled/agent_name/agent_tone) + tablas `tec_whatsapp_conversations` y `tec_whatsapp_messages` (historial + dedup por `message_id`).
- **Registrar el webhook en la instancia existente al activar el bot** con `POST /webhook/set/{instance}`.
- **Clientes automáticos con `pushName`** (find-or-create por teléfono digits-only).
- **Link de pago Bold del tenant**: fase 2 (MVP informa "pago pendiente de verificación"; la venta queda `due`).
- **Handoff/avisos al admin por WhatsApp**: fase 2. En MVP el bot SÍ marca la conversación en `human` con `request_human` (deja de responder), sin notificación.
- Plan guardado en `docs/plan-whatsapp-bot.md`.

## Arquitectura (v0.6.0 — API `api/src/whatsapp/`)
- **Webhook público** `POST /api/webhooks/evolution/:instance?token=…`: token timing-safe (`EVOLUTION_WEBHOOK_TOKEN`, fail-closed 503 si falta / 401 si no coincide), resuelve tenant por `instance_name`, responde 200 inmediato y procesa en background; dedup por `message_id`; ignora `fromMe`, grupos y no-texto (respuesta amable).
- **Agente** (`WhatsappAgentService`): reutiliza `OpenRouterClient` (modelo/fallback del `.env`) con system prompt de **vendedor** parametrizado por **nombre**, **tono** (amable/profesional/vendedor/cercano) y **datos de la tienda desde `tec_tenant_settings`** (`SettingsService.getGlobalForTenant`).
- **Herramientas** (tool calling, tenant-scoped): `search_products`, `get_product_details` (precio, stock, categoría, características `details`), `create_order` (crea la venta **`due`** vía `SalesService.createForCustomer`; stock/precios validados server-side) y `request_human`.
- **Playbook anti-pérdida**: saludo con nombre de tienda, recomendar con beneficios, alternativas si no hay stock, confirmar ítems+total antes de cerrar, nunca dejar sin respuesta, fallback + `human` si el modelo falla, no inventar precios/stock (solo herramientas).
- **Conversaciones/mensajes** en BD (contexto = últimos 12 mensajes); locks en memoria (1 respuesta concurrente por conversación) + rate limit 20 msgs/min por teléfono.
- Cliente WhatsApp: `POST /message/sendText/{instance}` `{ number, text }`; webhook: `POST /webhook/set/{instance}` `{ webhook: { enabled, url, events: ['MESSAGES_UPSERT','CONNECTION_UPDATE'] } }`.

## UI (v0.6.1 — en `/whatsapp`)
- Tarjeta **"Agente de ventas"**: toggle **Activar bot** (al activar registra el webhook), **Nombre del agente**, **Tono** (select) y Guardar (`PUT /api/whatsapp/settings`). Los datos de tienda se toman de Configuración del tenant.

## Env nuevas
`EVOLUTION_WEBHOOK_TOKEN` (obligatorio para activar el bot), `PUBLIC_API_URL` (default `https://pos.tienderu.com`).

## Fases / versiones
- **v0.6.0**: migración + webhook + sendText/webhookSet + agente + herramientas + pedidos `due` + conversaciones/mensajes.
- **v0.6.1**: tarjeta de configuración del agente en `/whatsapp`.
- **v0.6.2 (futuro)**: bandeja de conversaciones con handoff, aviso al admin por WhatsApp, link Bold del tenant, imágenes de producto, horarios.

## Verificación
Activar agente → escribir desde un WhatsApp real: "hola" · "¿cuánto vale X?" · "¿tienen Y?" · "quiero 2 de X" · confirmar → pedido **#N** en **Cuentas abiertas** (y Pedidos App, `created_by NULL`) con stock descontado y estado **Debida**. Probar bot apagado, "pásame con alguien" (`human`) y texto no soportado.
