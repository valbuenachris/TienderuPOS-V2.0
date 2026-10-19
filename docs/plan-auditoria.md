# Plan: Auditoría del Marketplace Tienderu.com — Hallazgos y Mejoras (v0.11.x)

Estado: **Fases 1–4 ejecutadas** (v0.11.0 `f40b829`, v0.11.1 `f4fbcb4`, v0.11.2 `1ad8913`, v0.11.3); Fases 5–6 pendientes. Fecha: 2026-10-19.

## Decisiones confirmadas por el usuario
- **Arranque por la Fase 1** (higiene operativa: expiración de pedidos impagos, reposición de stock, cancelaciones).
- **DDL aprobadas cuando toque** (v0.11.x): reseñas del marketplace, cupones, eventos/analítica de banners, `unaccent`+trigram.
- **Notificaciones por WhatsApp por tenant** (Evolution, ya integrado) — Fase 2.
- **Analítica self-hosted en el VPS** (Umami o Plausible) — Fase 3.
- **Checkout con cuenta obligatoria** (sin invitado).

## Alcance auditado
- API `api/src/marketplace/` (12 archivos, ~2.700 líneas), DDL v0.8.0/v0.10.0, tienda `store/`, paneles POS (`/marketplace`, `/marketplace-global`) y producción real (latencias, headers, robots, estructura).

## Hallazgos por severidad

### Críticos (operación / riesgo de negocio) — RESUELTOS en Fase 1
1. **Pedidos abandonados retienen stock para siempre.** El checkout descuenta `tec_products.quantity` al crear el pedido `pending_payment`; no existía expiración, cancelación ni reposición (no había job/cron; el link Bold vence a los 30 min y el pedido quedaba pendiente). ✅ Resuelto: job de expiración con TTL + reposición.
2. **No hay cancelación ni reembolso.** Ni cliente (impago) ni vendedor (antes de despachar); el estado `cancelled` nunca se asignaba; el webhook solo manejaba `SALE_APPROVED` (pago rechazado no reponía stock). ✅ Resuelto: cancelaciones cliente/vendedor + `SALE_REJECTED` (reembolso automático sigue pendiente, Fase 5).
3. **Pedidos duplicados sin límite.** Checkout sin rate limit ni anti-duplicado; cada intento retenía stock. ✅ Resuelto: máx. 5 pendientes + dedupe 60 s.

### Importantes (conversión / confianza / crecimiento)
4. **Sin recuperación de contraseña** para clientes del marketplace (no hay email service).
5. **Sin notificaciones** al vendedor (pedido pagado) ni al cliente (pago/despacho/entrega); sin badge de pedidos pendientes en el POS.
6. **SEO/social nulo** (verificado en producción): título estático, sin meta/OG por página, `robots.txt` devuelve la SPA, sin sitemap, sin JSON-LD.
7. **Sin analítica** (visitas, conversión, clics de banners) — necesario para vender los espacios.
8. **Búsqueda sensible a tildes** (ILIKE sin `unaccent`) y filtros limitados (sin rating/stock/vendedor).

### Mejoras (calidad y escala)
9. Reseñas de compradores del marketplace (DDL). 10. Wishlist, comprar de nuevo, vistos recientemente, compartir por WhatsApp, cupones (DDL). 11. Contraentrega y múltiples pasarelas. 12. Vendedor: exclusión por producto, buffer de stock, export CSV de liquidaciones. 13. Plataforma: número de guía, política de cancelación con reposición, SLA. 14. Performance BD: trigram+unaccent, `COUNT(*) OVER()`. 15. Seguridad: headers nginx ausentes (X-Frame-Options, CSP, HSTS, X-Content-Type-Options, Referrer-Policy), rate limiting público, limpieza de links Bold obsoletos. 16. Calidad: tests del dinero/estados, E2E del store, alertas de webhooks y pedidos estancados.

## Plan por fases (v0.11.x)

### Fase 1 — Higiene operativa (v0.11.0) ✅ EJECUTADA (commit `f40b829`)
1. **Expiración de pedidos impagos** (`MarketplaceMaintenanceService`, job cada 5 min + corrida inicial): pedidos `pending_payment` + `payment_status='pending'` con `created_at < NOW() - TTL` (`MARKETPLACE_PAYMENT_TTL_MINUTES`, default 60, rango 5–1440; debe superar la expiración del link Bold). En transacción con `FOR UPDATE`: guardas (se omite con log si alguna sub-orden salió de `pending` o si la venta vinculada tiene `paid > 0`), repone stock desde `tec_marketplace_order_items`, elimina `tec_sale_items`/`tec_sales` vinculadas (nunca se pagaron → no deben quedar como deuda en el POS) y marca pedido/subórdenes `cancelled`. Idempotente.
2. **Webhook Bold `SALE_REJECTED`**: marca `payment_status='failed'` + cancela + repone (misma rutina con guardas); `settleOrder` ignora `SALE_APPROVED` de pedidos cancelados.
3. **Cancelación del cliente**: `POST /api/marketplace/orders/:id/cancel` (solo impagos) + botón «Cancelar pedido» en el detalle del store.
4. **Cancelación del vendedor**: `PATCH /api/marketplace/orders/:id/status` con `status: 'cancelled'` solo en sub-órdenes `pending` (las pagadas → 400 «requiere reembolso manual»); acción en el panel + filtro «Cancelados».
5. **Anti-abuso de checkout**: máx. 5 pedidos `pending_payment` por cliente + dedupe en memoria de 60 s por fingerprint de items.
6. **Tests y verificación**: `computeParentOrderStatus` (función pura, 10 casos; `cancelled` terminal y excluido del total activo) → 29 tests API en verde; builds api/web/store; verificación en navegador (nota de expiración en checkout, botón cancelar, toast, llamada API). `GET /api/marketplace/config` expone `payment_ttl_minutes`; `.env.example` documenta la variable.

### Fase 2 — Notificaciones y cuenta (v0.11.1) ✅ EJECUTADA (commit `f4fbcb4`)
WhatsApp al vendedor (pedido pagado) y al cliente (pagado/despachado/entregado) con la instancia Evolution del tenant; badge/contador de pedidos pendientes en el POS (`/marketplace`); recuperación de contraseña (reset desde el panel global estilo Clientes App + OTP por WhatsApp opcional).

### Fase 3 — SEO, social y analítica (v0.11.2) ✅ EJECUTADA
Títulos/meta/OG dinámicos por página y producto; `robots.txt` + `sitemap.xml`; JSON-LD (Product/Offer/Breadcrumb); Umami/Plausible self-hosted en el VPS (contenedor propio) + eventos de clic de banners (DDL `tec_marketplace_banner_events`).

### Fase 4 — Conversión/UX (v0.11.3) ✅ EJECUTADA
Compartir producto por WhatsApp; comprar de nuevo; vistos recientemente; wishlist; filtros por rating/stock/vendedor; `unaccent`+trigram (DDL).

### Fase 5 — Confianza/crecimiento (v0.11.4) — PENDIENTE
Reseñas del marketplace (DDL); cupones (DDL); contraentrega; número de guía; flujo de reembolso para cancelaciones de pedidos pagados.

### Fase 6 — Calidad/ops (v0.11.5) — PENDIENTE
Headers de seguridad en nginx (store y web); rate limiting de endpoints públicos; tests E2E smoke del store (Playwright); monitoreo/alertas de webhooks fallidos y pedidos estancados.
