-- POS v2 · v0.13.1 · Banners por tenant (DDL aprobado)
-- Cada tenant administra sus propios banners para el carrusel de la app móvil.
-- Los banners del marketplace público (tienderu.com) siguen en public.banners (global).
-- Ejecutar UNA VEZ antes de desplegar v0.13.1. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_tenant_banners (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  title varchar(120),
  target_url varchar(500),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tec_tenant_banners_tenant
  ON public.tec_tenant_banners (tenant_id, active, sort_order, id);

COMMIT;

-- Verificación
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'tec_tenant_banners';

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   DROP TABLE IF EXISTS public.tec_tenant_banners;
-- COMMIT;
