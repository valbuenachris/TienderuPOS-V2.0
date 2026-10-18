# Plan: sección "Asistente IA" (OpenRouter) — v0.4.0 / v0.4.1

Estado: **ejecutado completo** (API v0.4.0 + web v0.4.1). Fecha: 2026-10-18.

## Decisiones confirmadas por el usuario
- **API key solo global en `.env`** (`OPENROUTER_API_KEY`): la plataforma (dueño del POS) cobra por el servicio; **no** hay key por tenant en la UI.
- **Migración `tec_tenant_ai_settings` aprobada** (guarda `model` y `enabled` por tenant; `openrouter_api_key` queda reservado/futuro, sin uso en esta fase).
- **MVP sin streaming** (respuesta completa; SSE en fase futura).
- **Modelo por defecto en `.env`** (`OPENROUTER_MODEL`), sobreescribible por tenant desde la UI (tabla aprobada).
- Plan guardado en `docs/plan-asistente-ia.md`.

## Concepto
Chat **solo para el admin del tenant** que responde con **datos reales de su tienda** vía **tool calling**: el modelo no inventa cifras; pide datos con herramientas que ejecutan consultas server-side existentes (métricas de Reportes), siempre scoped al tenant del token.

## Arquitectura (API `api/src/ai/`, v0.4.0)
- `ai.module.ts` (importa `ReportsModule`; `ReportsService` se exporta), `ai.controller.ts`, `ai.service.ts` (loop de tools ≤4 iteraciones + llamada final sin tools), `ai.dto.ts`, `openrouter.client.ts`, `ai.tools.ts`, `tenant-ai-settings.service.ts` (patrón `to_regclass` + caché 60 s).
- **Herramientas** (tenant-scoped): `get_report_summary`, `get_top_products`, `get_sales_calendar` (reusan `ReportsService`), `get_low_stock` (SQL `quantity <= threshold`, para "pedido sugerido").
- System prompt: español, asesor de negocio, fecha/zona horaria del tenant, "no inventes cifras: usa herramientas"; contexto: nombre del tenant.
- Endpoints (admin): `GET/PUT /api/ai/settings`, `GET /api/ai/models` (curada ∩ catálogo OpenRouter con caché), `POST /api/ai/chat`.
- Seguridad: `JwtAuthGuard + TenantContextGuard + AdminGuard + TenantOperationalGuard` (402 si suspendido); key solo server-side (nunca en respuestas/logs, hint `…abcd`); límites: ≤20 mensajes, ≤2000 chars, `max_tokens` 800, temp 0.2, 1 petición concurrente por usuario, timeout 45 s; solo agregados (sin PII de clientes).
- Migración: `docs/migrations/v0.4.0-tenant-ai-settings.sql` (`tec_tenant_ai_settings`: `tenant_id` PK FK, `model`, `enabled`, `openrouter_api_key` reservado, timestamps).

## UI (web, v0.4.1)
- `/asistente` (**AdminOnly**) + ítem sidebar 🤖 + breadcrumb `Asistente IA`.
- Chat: burbujas usuario/asistente, spinner "Pensando…", estados vacío/error, Enter para enviar, "Nueva conversación" (historial en memoria, sin DDL), chips de preguntas sugeridas (últimos 3 días, más vendido del mes, pedido sugerido, ganancia del mes).
- **⚙️ Configuración** (modal): toggle habilitado, selector de modelo (lista del API + por defecto del servidor), indicador de fuente (plataforma) y aviso si falta la migración. Sin campo de API key (global).
- Estilos `.chat-*` con tokens + overrides dark; `aria-live` en respuestas.

## Env nuevas
`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`), `OPENROUTER_APP_URL`, `OPENROUTER_APP_TITLE`.

## Fases
- **v0.4.0**: migración + módulo API + build/tests.
- **v0.4.1**: página web + nav + estilos + docs.
- **Futuro**: streaming SSE, persistencia de conversaciones, más herramientas (cuentas abiertas, clientes, compras), memoria.

## Actualización v0.4.2
- Eliminado el botón/⚙️ modal de configuración por tenant en la UI (la página solo tiene el chat y "Nueva conversación").
- Modelo fijo por servidor: `OPENROUTER_MODEL` (default `openai/gpt-oss-20b`) y fallback `OPENROUTER_MODEL_FALLBACK` (default `deepseek/deepseek-v4.1-flash-1017`), enviado como el arreglo `models` de OpenRouter (failover automático ante errores/downtime del primario; el modelo usado viene en la respuesta).
- `tec_tenant_ai_settings` (`model`/`enabled`) queda **reservada, sin uso en el chat**; los endpoints de settings permanecen para una fase futura.

## Verificación
- API: build + tests; con key real de OpenRouter probar: "¿cuánto vendí los últimos 3 días?", "producto más vendido del mes", "qué sugieres pedir" (compara contra `/reportes`).
- Web: admin ve la sección; staff recibe 403 y no ve el menú; sin key global → mensaje claro.
