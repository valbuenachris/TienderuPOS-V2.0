# Plan: Marca (logo/footer) y banners de tienderu.com (v0.10.0 → v0.10.2)

Estado: **ejecutado** (v0.10.0 → v0.10.2; verificado con build + screenshots desktop/móvil). Fecha: 2026-10-18.

## Decisiones confirmadas por el usuario
- **Logo/favicon/footer**: administrables desde el POS (panel global), con subida de archivos — sin tocar código ni redeploy.
- **Banners**: "ambos" → (a) nueva fila de **promos pequeñas** en el home de tienderu.com (subida de imagen, CRUD completo) y (b) gestión también de los **banners grandes del carrusel** desde el mismo panel (reutilizando los endpoints existentes).
- **Banners pequeños: solo imagen** (sin texto superpuesto); toda la tarjeta es clicable si tiene link. El campo `title` se guarda igual como texto alternativo (accesibilidad) y para listarlo en el panel.
- **Footer editable**: descripción, email, teléfono **+ WhatsApp, dirección, Instagram y Facebook**.

## Dónde vive cada cosa hoy (hallazgos)
- Logo: código — `store/src/components/layout/Header.tsx` (cuadro "t" + wordmark). Favicon: no existe en `store/index.html`.
- Footer: código — `store/src/components/layout/Footer.tsx` (descripción, links, sellos, email/teléfono).
- Banners grandes: ya administrables en POS → Tienda Virtual → Banners (tabla global `banners`, solo `image_url` por URL pegada; también alimentan la app móvil de todos los tenants).
- Banners pequeños: no existen (tabla/UI/componente nuevos).
- Patrón de subida a reutilizar: `FileInterceptor('file')` ≤ 2 MB → Supabase Storage service-role → URL pública (`api/src/products/products.service.ts:254`).

## Fase 1 — DDL aprobada `docs/migrations/v0.10.0-marketplace-branding.sql` (idempotente)
- `tec_marketplace_branding` (fila única `id = 1`): `logo_url`, `favicon_url`, `footer_description varchar(300)`, `footer_email varchar(150)`, `footer_phone varchar(30)`, `footer_whatsapp varchar(30)`, `footer_address varchar(200)`, `footer_instagram varchar(200)`, `footer_facebook varchar(200)`, `updated_at`.
- `tec_marketplace_banners`: `id bigserial PK`, `slot varchar(20) DEFAULT 'home_strip'`, `title varchar(120)` (alt/listado), `image_url text NOT NULL`, `target_url varchar(500)`, `sort_order int DEFAULT 0`, `active bool DEFAULT true`, `created_at`.
- La corre el operador; la API/store funcionan sin ella (probes `to_regclass`, fallbacks al diseño actual).

## Fase 2 — API (v0.10.0)
- `MarketplaceBrandingService` (`api/src/marketplace/`): branding público + CRUD admin + subida/borrado en Supabase Storage `productos/marketplace/…` (logo y favicon también aceptan SVG; banners PNG/JPG/WEBP; ≤ 2 MB).
- Público:
  - `GET /api/marketplace/config` → `branding: { logo_url, favicon_url, footer: { description, email, phone, whatsapp, address, instagram, facebook } }` (nulls si falta la tabla).
  - `GET /api/marketplace/home` → `promos: [{ id, title, image_url, target_url }]` (activos, ordenados, ≤ 6).
- Super admin (`/api/marketplace/admin`):
  - `GET/PUT /api/marketplace/admin/branding` (multipart: textos + `logo`/`favicon` opcionales).
  - `GET/POST /api/marketplace/admin/banners` (POST multipart `file` o `image_url`), `PUT /:id`, `DELETE /:id` (borra archivo best-effort).
  - Banners grandes: **sin API nueva** — el panel reutiliza `GET/POST/DELETE /api/admin/banners` existentes.

## Fase 3 — Store (v0.10.1)
- `Header`: `branding.logo_url` con fallback al wordmark actual (`onError`).
- `App`: favicon dinámico desde `branding.favicon_url`.
- `Footer`: campos de branding con fallback a los textos actuales; WhatsApp como link `wa.me`, dirección con icono, Instagram/Facebook como links.
- `HomePage`: **PromoStrip** — fila de tarjetas pequeñas solo-imagen (1 col móvil, 2–3 desktop; `alt` = title; clicable si `target_url`), debajo del hero/sellos.
- Fail-safe: sin tabla/datos → idéntico a hoy.

## Fase 4 — Panel POS (v0.10.2)
`/marketplace-global` → pestaña **“Marca y banners”** con 3 secciones:
1. **Marca**: subir logo y favicon (vista previa) + editar descripción, email, teléfono, WhatsApp, dirección, Instagram, Facebook.
2. **Banners pequeños (tienderu.com)**: listado con miniatura, activo, orden, eliminar y "Subir banner" (imagen + link/título opcional).
3. **Banners del carrusel principal**: lista, agregar (por URL) y eliminar reutilizando `/api/admin/banners`, con la nota visible: "también aparecen en la app móvil de todos los tenants".

## Fase 5 — Despliegue
Operador: correr la migración → rebuild api/web/store (`IMAGE_TAG` v0.10.x) → `docker compose up -d` → cargar logo/favicon/footer y banners desde el panel global.

## Riesgos
- Subida de SVG solo para logo/favicon (se sirve desde el dominio de Supabase Storage, no desde tienderu.com).
- La tabla global `banners` no se modifica; su edición sigue siendo por URL.
