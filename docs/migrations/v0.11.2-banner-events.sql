-- POS v2 · v0.11.2 · Eventos de clic de banners del marketplace (DDL aprobado)
-- Métrica básica para vender los espacios de banners de tienderu.com.
-- Ejecutar UNA VEZ antes de desplegar v0.11.2. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_marketplace_banner_events (
  id bigserial PRIMARY KEY,
  banner_id bigint NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tec_marketplace_banner_events_banner
  ON public.tec_marketplace_banner_events (banner_id, created_at DESC);

COMMIT;

-- Verificación
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'tec_marketplace_banner_events';

-- Reversión (opcional):
-- BEGIN;
--   DROP TABLE IF EXISTS public.tec_marketplace_banner_events;
-- COMMIT;
