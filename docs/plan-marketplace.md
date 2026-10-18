# Plan: Tienderu.com — Marketplace multi-tenant (v0.8.0 → v0.8.2)

Estado: **ejecutado** (v0.8.0 API + DDL, v0.8.1 tienda web `store/`, v0.8.2 paneles del POS; pendiente despliegue del operador: correr la migración y configurar `MARKETPLACE_*`). Fecha: 2026-10-18.

## Decisiones confirmadas por el usuario
- **Tienda en nueva app** `store/` (React+Vite) del monorepo, servida en **tienderu.com** con contenedor propio; reutiliza stack (TanStack Query, tokens/estilos) sin tocar el POS.
- **DDL aprobada**: `docs/migrations/v0.8.0-marketplace.sql` (la corre el operador antes del deploy; la API nunca ejecuta DDL).
- **Regla de precio**: tienda = (precio base + impuesto del tenant) × 1.10; la plataforma gana la diferencia (10% del valor de la venta del tenant) y el tenant recibe exactamente lo mismo que en su local. `markup_percent` por tenant (default 10).
- **Publicación**: opt-in por tenant (`enabled`); se publican todos sus productos con stock > 0 de tenants activos.
- **Pago del cliente**: Bold de plataforma (tarjetas/PSE). Contraentrega en fase 2.
- **Despacho**: cada tenant despacha su sub-pedido desde el POS; tarifa de envío plana de plataforma configurable (`MARKETPLACE_SHIPPING_FLAT`).
- **Cuenta de cliente**: global y nueva (`tec_marketplace_customers`), email + contraseña (bcrypt).
- **Liquidación**: reporte derivado por tenant + marcado manual de pagos (`payout_status`/`paid_out_at` en sub-órdenes), sin tabla extra.
- **Alcance v1**: Amazon-like base (home, buscador, categorías, ficha con galería y reviews existentes, carrito multi-vendedor, checkout con dirección y pago, cuenta con pedidos y seguimiento).

## 1. Base de datos — `docs/migrations/v0.8.0-marketplace.sql` (idempotente)
- `tec_marketplace_settings`: `tenant_id uuid PK FK → tec_tenants`, `enabled bool default false`, `markup_percent numeric(5,2) default 10`, `store_display_name text`, `created_at/updated_at`.
- `tec_marketplace_customers`: `id serial PK`, `name`, `email`, `phone`, `password` (bcrypt), `created_at`; índice único funcional `LOWER(email)`.
- `tec_marketplace_addresses`: espejo de `customer_addresses` + `recipient_name`; primer registro forzado default; borrar el default promueve el más antiguo.
- `tec_marketplace_orders`: `id serial`, `order_number varchar UNIQUE` (`TDR-000001`), snapshot del cliente y de la dirección de envío, `products_total`, `shipping_total`, `grand_total`, `commission_total`, `status` (`pending_payment|paid|preparing|shipped|delivered|cancelled`), `payment_method`, `payment_status`, `bold_payment_id`, `checkout_url`, `paid_at`, `created_at/updated_at`.
- `tec_marketplace_suborders`: `order_id FK`, `tenant_id FK`, `sale_id` (venta real del POS), `status`, `tenant_total` (lo que se le debe al tenant), `commission`, `shipping`, `tracking_note`, `shipped_at/delivered_at`, `payout_status ('pending'|'paid')`, `paid_out_at`.
- `tec_marketplace_order_items`: `order_id`, `suborder_id`, `product_id`, `tenant_id`, snapshot (`product_name`, `product_code`, `product_image`), `quantity`, `base_unit_price`, `unit_price` (con markup), `commission_unit`, `line_subtotal` (base+impuesto por línea = lo del tenant), `line_total` (lo que paga el cliente), `commission_total`.

## 2. API — `api/src/marketplace/` (v0.8.0)
**Público (sin auth, solo campos publicables; nunca costo/deuda):**
- `GET /api/marketplace/products` — listado cross-tenant (q, categoría, vendedor, rango precio, orden, paginado; solo tenants opt-in activos y stock > 0).
- `GET /api/marketplace/products/:id` — ficha + galería + vendedor + rating (`product_reviews`) + relacionados.
- `GET /api/marketplace/categories`, `GET /api/marketplace/sellers/:tenantId`, `GET /api/marketplace/config`.
- `GET /api/marketplace/home` — banners globales (tabla `banners`) + secciones (nuevos, mejor calificados, por categoría).

**Cliente tienda (JWT tipo `marketplace_customer`, nuevo guard):**
- `POST /api/auth/marketplace-register` / `marketplace-login`, `GET /api/auth/marketplace-me`; lockout reutiliza `tec_login_attempts` (tenant NULL); bcrypt siempre.
- `GET/PUT /api/marketplace/account` (perfil) y CRUD de direcciones + set-default.

**Checkout:** `POST /api/marketplace/checkout` (`{ items, address_id, payment_method: 'bold' }`) — valida stock/precio en servidor, agrupa por tenant, crea 1 orden plataforma + N sub-órdenes y **N ventas reales** en el POS de cada tenant (base + impuesto, `created_by NULL`, `customer_name` del comprador, `payment_method='marketplace'`) descontando stock en una sola transacción con `FOR UPDATE`; devuelve link Bold de plataforma (`MARKETPLACE_BOLD_API_KEY`, referencia `MKP-<orderId>-<base36 ts>`, callback `MARKETPLACE_CALLBACK_URL`).
**Webhook** `POST /api/webhooks/bold` — tercera fase para referencias `MKP-` (firma con `MARKETPLACE_BOLD_WEBHOOK_SECRET`): `SALE_APPROVED` marca orden/sub-órdenes `paid` y liquida cada venta tenant (idempotente).
**Tenant admin** (`JwtAuthGuard + TenantContextGuard + AdminGuard`): `GET/PUT /api/marketplace/settings`; `GET /api/marketplace/orders` y `PATCH /api/marketplace/orders/:id/status` (preparing/shipped/delivered/cancelled con nota; sincroniza `tec_sales.status_delivery`); `GET /api/marketplace/summary` (ventas y comisión).
**Super admin**: `GET /api/marketplace/admin/orders`, `GET /api/marketplace/admin/summary` (GMV, comisión), `GET /api/marketplace/admin/payouts` y `PATCH /api/marketplace/admin/payouts/mark`.
Fail-safe: `to_regclass` con caché 60 s para desplegar la API antes de la migración.

## 3. Tienda web — `store/` (v0.8.1)
Header con buscador y sugerencias, franja de categorías, home con carrusel y rieles de productos, resultados con filtros/orden, ficha (galería, precio, vendedor, stock, reviews, relacionados), carrito en localStorage agrupado por vendedor (precios revalidados al pagar), checkout (auth → dirección → Bold), cuenta (perfil, direcciones, pedidos con seguimiento por sub-pedido). Estilos propios inspirados en Amazon; SEO básico (títulos/meta); SSR fuera de alcance.

## 4. Admin en el POS web (v0.8.2)
Tenant (`/marketplace`, AdminOnly, nav 🛒): ajustes (activar tienda, markup), pedidos por despachar con estados, resumen de comisión. Global (`/marketplace-global`, super admin): órdenes, KPIs (GMV/comisión), liquidaciones y marcado de pagos.

## 5. Despliegue
`store/Dockerfile` + nginx (SPA + proxy `/api`), servicio `store` en `docker-compose.yml` (red `npm_net`), imagen `pos-gres-v2-store` en `docker-compose.build.yml`; NPM apunta `tienderu.com` → contenedor store. Nuevas envs: `MARKETPLACE_BOLD_API_KEY`, `MARKETPLACE_BOLD_WEBHOOK_SECRET`, `MARKETPLACE_SHIPPING_FLAT`, `MARKETPLACE_CALLBACK_URL`, `MARKETPLACE_BASE_URL`.

## 6. Reglas y riesgos
- Endpoints públicos cross-tenant: exponer solo campos publicables; `TenantContextGuard`/`CustomerContextGuard` rechazan el token `marketplace_customer`; `JwtAuthGuard` no exige `tenant_id` para ese tipo.
- Redondeo Decimal HALF_UP por línea; totales = suma de líneas.
- Impuestos: la venta del tenant conserva su cálculo (exclusivo); el markup 10% aplica sobre base+impuesto (regla confirmada).
- Fase 2: contraentrega, reviews propias del marketplace, wishlist/cupones, cancelaciones/devoluciones, tracking real, SEO avanzado/SSR.
