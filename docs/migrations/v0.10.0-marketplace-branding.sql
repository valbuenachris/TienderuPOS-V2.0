-- POS v2 · v0.10.0 · Marca (logo/footer) y banners del marketplace Tienderu.com (DDL aprobado)
-- tienderu.com: branding de la plataforma (fila única) y banners pequeños del home.
-- Ejecutar UNA VEZ antes de desplegar v0.10.0. No borra datos.

BEGIN;

-- 1) Branding de la plataforma (logo, favicon y datos del footer). Fila única id = 1.
CREATE TABLE IF NOT EXISTS public.tec_marketplace_branding (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  logo_url text,
  favicon_url text,
  footer_description varchar(300),
  footer_email varchar(150),
  footer_phone varchar(30),
  footer_whatsapp varchar(30),
  footer_address varchar(200),
  footer_instagram varchar(200),
  footer_facebook varchar(200),
  updated_at timestamptz DEFAULT now()
);

-- 2) Banners pequeños del home (fila de promos debajo del hero). Los banners grandes
--    del carrusel siguen en la tabla global public.banners (sin cambios).
CREATE TABLE IF NOT EXISTS public.tec_marketplace_banners (
  id bigserial PRIMARY KEY,
  slot varchar(20) NOT NULL DEFAULT 'home_strip',
  title varchar(120),
  image_url text NOT NULL,
  target_url varchar(500),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tec_marketplace_banners_slot
  ON public.tec_marketplace_banners (slot, active, sort_order, id);

COMMIT;

-- Verificación
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('tec_marketplace_branding', 'tec_marketplace_banners')
ORDER BY table_name;

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   DROP TABLE IF EXISTS public.tec_marketplace_banners;
--   DROP TABLE IF EXISTS public.tec_marketplace_branding;
-- COMMIT;
