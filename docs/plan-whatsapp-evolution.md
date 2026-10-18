# Plan: sección "WhatsApp (Evolution API)" en el POS — v0.5.0 / v0.5.1

Estado: **ejecutado completo** (API v0.5.0 + web v0.5.1). Fecha: 2026-10-18.

## Decisiones confirmadas por el usuario
- **Mismo servidor Evolution que ya usa educol** (`EVOLUTION_API_URL`/`EVOLUTION_API_KEY` globales de la plataforma; la key vive solo en el `.env` del API).
- **Una instancia por tenant**, administrada por el **admin del tenant** (`AdminGuard`).
- **Solo logout** para desconectar (se conserva la instancia para reconectar); sin botón de eliminar.
- **DDL aprobada**: `tec_tenant_whatsapp_settings`.
- Plan guardado en `docs/plan-whatsapp-evolution.md`.

## Hallazgos de la inspección de `educolEditores` (referencia)
- Auth por header `apikey: <EVOLUTION_API_KEY>`.
- `POST /instance/create` con `{ instanceName, token, qrcode: true, integration: 'WHATSAPP-BAILEYS' }`.
- `GET /instance/connect/<n>` → QR base64 + `state`; `GET /instance/connectionState/<n>` → estado.
- Nombre de instancia **derivado server-side**; webhook con token timing-safe (fase futura aquí).
- educol no tiene logout → se usa `DELETE /instance/logout/<n>` (Evolution v2; validar con la prueba real de "Desconectar").

## Arquitectura (v0.5.0 — API `api/src/whatsapp/`)
- `EvolutionClient` (timeout 25 s; `create/connect/connectionState/logout`; parseo flexible del QR `base64`/`qrcode.base64`; errores claros; key nunca loggeada).
- `TenantWhatsappSettingsService` (probe `to_regclass` lazy 30 s + caché 60 s; upsert/updateStatus).
- `WhatsappService`: vista de settings (estado live → persistido best-effort), crear instancia (idempotente), conectar (QR), estado, desconectar (logout).
- Instancia por tenant con nombre derivado: `pos-<slug>-<id8>`.
- Endpoints (admin del tenant, + `TenantOperationalGuard` → 402 si suspendido): `GET /api/whatsapp/settings`, `POST /api/whatsapp/instance`, `POST /api/whatsapp/connect`, `GET /api/whatsapp/status`, `POST /api/whatsapp/disconnect`.
- **MVP sin webhook** (estado por polling); mensajería/webhook = fase futura.

## Migración `docs/migrations/v0.5.0-tenant-whatsapp.sql`
`tec_tenant_whatsapp_settings` (`tenant_id` PK FK, `instance_name varchar(120) NOT NULL UNIQUE`, `status varchar(20)`, `connected_at`, timestamps).

## UI (v0.5.1, `web/src/pages/WhatsAppPage.tsx`, AdminOnly, nav 🟢)
- Tarjeta de estado con badge (Conectado/Conectando/Desconectado/Sin instancia), nombre de instancia y "conectado desde".
- Botones: **Crear instancia** · **Conectar** (modal con QR, refresco cada 20 s + polling de estado cada 5 s hasta `open`) · **Desconectar** (modal de confirmación).
- Avisos: falta env (`EVOLUTION_API_URL/KEY`) o falta migración. Recetas de la skill `frontend-ui` (tokens, dark mode; QR siempre sobre fondo blanco).

## Env nuevas
`EVOLUTION_API_URL` (el servidor compartido), `EVOLUTION_API_KEY` (key global).

## Fases / versiones
- **v0.5.0**: migración + módulo API + build/tests.
- **v0.5.1**: página web + nav + breadcrumb + estilos + docs.
- **Futuro (v0.5.2)**: webhook de `CONNECTION_UPDATE`/mensajes, envío de ticket por WhatsApp, avisos de pedidos de la tienda virtual.

## Verificación
Crear → QR → escanear → "Conectado" → Desconectar → "Desconectado" → Conectar de nuevo (QR nuevo). Dos tenants → instancias distintas sin colisión con educol (`*-whatsapp`). Tenant suspendido → 402.
