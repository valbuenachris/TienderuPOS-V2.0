# Plan: Auditoría del Marketplace Tienderu.com — Hallazgos y Mejoras (v0.11.x)

Estado: **Fase 1 ejecutada** (v0.11.0: expiración/cancelaciones/anti-abuso; verificada con tests + navegador); Fases 2–6 pendientes. Fecha: 2026-10-19.

## Decisiones confirmadas por el usuario
- **Arranque por la Fase 1** (higiene operativa: expiración de pedidos impagos, reposición de stock, cancelaciones).
- **DDL aprobadas cuando toque** (v0.11.x): reseñas del marketplace, cupones, eventos/analítica de banners, `unaccent`+trigram.
- **Notificaciones por WhatsApp por tenant** (Evolution, ya integrado) — Fase 2.
- **Analítica self-hosted en el VPS** (Umami o Plausible) — Fase 3.
- **Checkout con cuenta obligatoria** (sin invitado).

## Alcance auditado
- API `api/src/marketplace/` (12 archivos, ~2.700 líneas), DDL v0.8.0/v0.10.0, tienda `store/`, paneles POS (`/marketplace`, `/marketplace-global`) y producción (latencias, headers, robots, estructura).

## Hallazgos por severidad

### Críticos (operación / riesgo de negocio)
1. **Pedidos abandonados retienen stock para siempre.** El checkout descuenta `tec_products.quantity` al crear el pedido `pending_payment`; no existe expiración, cancelación ni reposición (no hay job/cron en el módulo; el link Bold vence a los 30 min y el pedido queda pendiente).
2. **No hay cancelación ni reembolso.** Ni cliente (impago) ni vendedor (antes de despachar); el estado `cancelled` nunca se asigna; el webhook solo maneja `SALE_APPROVED` (pago rechazado no repone stock).
3. **Pedidos duplicados sin límite.** Checkout sin rate limit ni anti-duplicado; cada intento retiene stock.

### Importantes (conversión / confianza / crecimiento)
4. **Sin recuperación de contraseña** para clientes del marketplace (no hay email service).
5. **Sin notificaciones** al vendedor (pedido pagado) ni al cliente (pago/despacho/entrega); sin badge de pedidos pendientes en el POS.
6. **SEO/social nulo** (verificado en producción): título estático, sin meta/OG por página, `robots.txt` devuelve la SPA, sin sitemap, sin JSON-LD.
7. **Sin analítica** (visitas, conversión, clics de banners) — necesario para vender los espacios.
8. **Búsqueda sensible a tildes** (ILIKE sin `unaccent`) y filtros limitados (sin rating/stock/vendedor).

### Mejoras (calidad y escala)
9. Reseñas de compradores del marketplace (DDL). 10. Wishlist, comprar de nuevo, vistos recientemente, compartir por WhatsApp, cupones (DDL). 11. Contraentrega y múltiples pasarelas. 12. Vendedor: exclusión por producto, buffer de stock, export CSV de liquidaciones. 13. Plataforma: número de guía, política de cancelación con reposición, SLA. 14. Performance BD: trigram+unaccent, `COUNT(*) OVER()`. 15. Seguridad: headers nginx ausentes (X-Frame-Options, CSP, HSTS, X-Content-Type-Options, Referrer-Policy), rate limiting público, limpieza de links Bold obsoletos. 16. Calidad: tests del dinero/estados, E2E del store, alertas de webhooks y pedidos estancados.

## Plan por fases (v0.11.x)

### Fase 1 — Higiene operativa (v0.11.0) ✅ EJECUTADA
1. **Expiración de pedidos impagos** (`MarketplaceOrdersService`, job `setInterval` cada 5 min, patrón del proyecto): pedidos `payment_status='pending'` + `status='pending_payment'` con `created_at < NOW() - TTL` (`MARKETPLACE_PAYMENT_TTL_MINUTES`, default 60). Por pedido, en transacción con `FOR UPDATE`: re-verifica impago; **guarda de seguridad**: solo expira si la venta POS vinculada sigue con `paid = 0` y ninguna sub-orden avanzó de `pending` (si alguien cobró/actuó, se omite y se loguea); repone stock desde `tec_marketplace_order_items`; elimina `tec_sale_items`/`tec_sales` vinculadas (nunca se pagaron → no deben quedar como deuda en el POS); marca subórdenes y pedido `cancelled`; idempotente.
2. **Webhook Bold `SALE_REJECTED`**: misma ruta de firma; marca `payment_status='failed'`, `status='cancelled'` y aplica la reposición (misma rutina con guardas). `EXPIRED` lo cubre el job.
3. **Cancelación del cliente** (`POST /api/marketplace/orders/:id/cancel`, guard de cliente): solo si `pending_payment`; aplica la rutina de cancelación. La UI del detalle ya oculta el botón de pago en pedidos `cancelled`.
4. **Cancelación del vendedor**: `MarketplaceOrderStatusDto` acepta `cancelled` **solo si la sub-orden está `pending`** (impaga); en subórdenes pagadas responde 400 "requiere reembolso manual (fase 2)". Recomputar el estado del pedido padre tratando `cancelled` como terminal (si todas las sub-órdenes terminan canceladas → pedido `cancelled`).
5. **Anti-abuso de checkout**: máximo de pedidos `pending_payment` simultáneos por cliente (p. ej. 5) + guard anti-duplicado (mismos items dentro de 60 s) — en memoria, patrón `AI_DAILY_MESSAGES_LIMIT`.
6. **Tests**: extraer funciones puras (reposición por líneas, recomputo de estado con `cancelled`) y cubrirlas con el runner existente (`node:test` + tsx); build API + store.

### Fase 2 — Notificaciones y cuenta (v0.11.1)
WhatsApp al vendedor (pedido pagado) y al cliente (pagado/despachado/entregado) con la instancia Evolution del tenant; badge/contador de pedidos pendientes en el POS (`/marketplace`); recuperación de contraseña (reset desde el panel global estilo Clientes App + OTP por WhatsApp opcional).

### Fase 3 — SEO, social y analítica (v0.11.2)
Títulos/meta/OG dinámicos por página y producto; `robots.txt` + `sitemap.xml` (estático o endpoint); JSON-LD (Product/Offer/Breadcrumb); Umami/Plausible self-hosted en el VPS (contenedor propio) + eventos de clic de banners (DDL `tec_marketplace_banner_events`).

### Fase 4 — Conversión/UX (v0.11.3)
Compartir producto por WhatsApp; comprar de nuevo; vistos recientemente; wishlist; filtros por rating/stock/vendedor; `unaccent`+trigram (DDL).

### Fase 5 — Confianza/crecimiento (v0.11.4)
Reseñas del marketplace (DDL); cupones (DDL); contraentrega; número de guía.

### Fase 6 — Calidad/ops (v0.11.5)
Headers de seguridad en nginx (store y web); rate limiting de endpoints públicos; tests E2E smoke del store (Playwright); monitoreo/alertas de webhooks fallidos y pedidos estancados.
