-- POS v2 · v0.11.3 · Búsqueda sin tildes (unaccent + pg_trgm) del marketplace (DDL aprobado)
-- Habilita búsquedas tipo "audifonos" = "Audífonos" con índices GIN para ILIKE.
-- Ejecutar UNA VEZ antes de desplegar v0.11.3. Ideal en bajo tráfico: crea índices
-- sobre tec_products (puede ser una tabla grande). No borra datos.

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Wrapper IMMUTABLE (el unaccent nativo es STABLE y no puede indexarse directo).
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT public.unaccent('public.unaccent', $1) $$;

CREATE INDEX IF NOT EXISTS ix_tec_products_name_unaccent_trgm
  ON public.tec_products USING gin (public.immutable_unaccent(lower(name)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_tec_products_code_trgm
  ON public.tec_products USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_tec_tenants_name_unaccent_trgm
  ON public.tec_tenants USING gin (public.immutable_unaccent(lower(name)) gin_trgm_ops);

COMMIT;

-- Verificación
SELECT proname FROM pg_proc WHERE proname = 'immutable_unaccent';
SELECT indexname FROM pg_indexes
WHERE indexname IN (
  'ix_tec_products_name_unaccent_trgm',
  'ix_tec_products_code_trgm',
  'ix_tec_tenants_name_unaccent_trgm'
);

-- Reversión (opcional):
-- BEGIN;
--   DROP INDEX IF EXISTS public.ix_tec_products_name_unaccent_trgm;
--   DROP INDEX IF EXISTS public.ix_tec_products_code_trgm;
--   DROP INDEX IF EXISTS public.ix_tec_tenants_name_unaccent_trgm;
--   DROP FUNCTION IF EXISTS public.immutable_unaccent(text);
-- COMMIT;
