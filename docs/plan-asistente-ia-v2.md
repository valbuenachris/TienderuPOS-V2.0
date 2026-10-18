# Plan: Asistente IA v2 — más capaz y eficiente (v0.4.3 / v0.4.4)

Estado: **Tier 1 ejecutado** (backend v0.4.3 + UI v0.4.4). Tier 2 pendiente de validación. Fecha: 2026-10-18.

## Decisiones confirmadas por el usuario
- **Datos de clientes: SÍ** (solo admin; es data propia del tenant, ya visible en `/clientes`).
- **Tier 1 ahora** (8 herramientas nuevas → 12 total); **Tier 2** (medios de pago + rendimiento por cajero) en v0.4.4 tras validar precisión.
- **Límite diario `AI_DAILY_MESSAGES_LIMIT=100` por tenant** (control de gasto de la cuenta OpenRouter).

## Inspección previa (v0.4.2)
- 4 herramientas: `get_report_summary`, `get_top_products`, `get_sales_calendar`, `get_low_stock`.
- Límites: ≤4 iteraciones, ≤20 mensajes, `max_tokens` 800, temp 0.2, 1 consulta concurrente/usuario, timeout 45 s; tools tenant-scoped desde el token.
- Modelo por `.env`: `openai/gpt-oss-20b` + fallback `deepseek/deepseek-v4.1-flash-1017` (arreglo `models` de OpenRouter).
- Brechas: sin clientes, productos (margen/desempeño), categorías, horas pico, cuentas abiertas, stock muerto, medios de pago ni cajeros.

## Tier 1 — 8 herramientas nuevas (v0.4.3, `api/src/ai/ai.tools.ts`)
1. `search_customers(query, limit)` — nombre/correo/teléfono (ILIKE con escape), puntos y tienda.
2. `get_customer_summary(customer_id)` — puntos, compras históricas, **deuda pendiente** (`due|partial`) y últimas 5 ventas.
3. `search_products(query, limit)` — código/nombre, precio, costo, stock y categoría.
4. `get_product_performance(product_id, from?, to?)` — unidades, ingresos, stock y **margen unitario** (precio − costo); default 30 días.
5. `get_sales_by_category(from?, to?)` — unidades/monto por categoría (join `sale_items→products→categories` con `id::text`).
6. `get_sales_by_hour(from?, to?)` — ventas e ingresos por hora (zona horaria del tenant); default 7 días.
7. `get_open_accounts(limit?)` — cuentas `due|partial` con pendiente + total global por cobrar.
8. `get_dead_stock(days?, limit?)` — stock > 0 y **cero ventas en N días** (default 30).

## Eficiencia (v0.4.3)
- **Herramientas en paralelo** (`Promise.all`) en vez de secuencial.
- **Caché en memoria 30 s** (tenant+tool+params) para agregados pesados (summary/top/categoría/hora).
- **Iteraciones 4 → 5** (permite encadenar buscar cliente → resumen → deuda).
- **Prompt mejorado**: capacidades, encadenamiento (search_customers → get_customer_summary), rangos por defecto por tipo de consulta, tablas ≤10 filas, nunca inventar cifras.
- **Límite diario**: `AI_DAILY_MESSAGES_LIMIT` (default 100/tenant/día, contador en memoria con reset diario) + log de uso.

## UI (v0.4.4, `web/src/pages/AiAssistantPage.tsx`)
- 6 chips nuevos (cliente top, cuentas por cobrar, stock sin movimiento, hora pico…).
- Panel colapsable **"¿Qué puedo consultar?"** en el estado vacío (descubre capacidades).

## Ampliación v0.4.6
- `get_top_customers(from?, to?, limit?)`: **ranking de clientes por monto comprado** (nombre, teléfono, nº de compras y total; default 30 días, caché 30 s). Total: **13 herramientas**. Detectado en pruebas: "¿qué cliente compra más este mes?" no tenía herramienta que lo resolviera.

## Tier 2 (pendiente de validación, siguiente iteración)
9. `get_payment_mix(from?, to?)` — reparto por medio de pago (`tec_payments.paid_by`).
10. `get_cashier_performance(from?, to?)` — ventas por cajero (`created_by` → `tec_users`).

## Verificación
Una pregunta por herramienta contrastando con la UI: cliente top, deuda de un cliente, margen de un producto, ventas por categoría/hora, cuentas abiertas, stock sin movimiento. Revisar que el modelo elija bien la herramienta (si falla con `gpt-oss-20b`, subir modelo en `.env`).

## Env
`AI_DAILY_MESSAGES_LIMIT=100` (nueva). El resto sin cambios.
