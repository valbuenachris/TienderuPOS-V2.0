-- POS v2 · v0.3.18 · Migración a dominio único (pos.tienderu.com)
-- ⚠️ ESTRICTAMENTE NO DESTRUCTIVO: no hay DELETE, DROP TABLE ni TRUNCATE.
-- Solo actualiza tec_tenants.host y elimina el índice/constraint ÚNICO sobre host
-- (DDL aprobado explícitamente para el modelo multi-tenant de dominio compartido).
-- tec_tenants NO tiene updated_at: no lo agregues en el UPDATE.
--
-- ALTERNATIVA SIN DDL (si prefieres no tocar constraints): en el paso 4 usar
--   SET host = NULL  (los NULL no chocan entre sí en un índice único).
-- Con esa variante puedes omitir los pasos 2 y 3.

-- ── 1) DIAGNÓSTICO (solo lectura) ──
SELECT count(*) AS tenants_activos
FROM public.tec_tenants
WHERE status IS NULL OR status <> 'deleted';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'tec_tenants' AND indexdef ILIKE '%host%';

SELECT con.conname, pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
JOIN pg_class t ON t.oid = con.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'tec_tenants' AND con.contype = 'u';

BEGIN;

-- ── 2) Quitar constraints UNIQUE que cubran host (aprobado) ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(con.conkey)
    WHERE n.nspname = 'public' AND t.relname = 'tec_tenants'
      AND con.contype = 'u' AND a.attname = 'host'
  LOOP
    EXECUTE format('ALTER TABLE public.tec_tenants DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- ── 3) Quitar índices UNIQUE sueltos que cubran host (aprobado) ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.relname AS idx
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(x.indkey)
    WHERE n.nspname = 'public' AND t.relname = 'tec_tenants'
      AND x.indisunique AND NOT x.indisprimary AND a.attname = 'host'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.idx);
  END LOOP;
END $$;

-- ── 4) Actualización no destructiva del host ──
UPDATE public.tec_tenants
SET host = 'pos.tienderu.com'
WHERE status IS NULL OR status <> 'deleted';

COMMIT;

-- ── 5) VERIFICACIÓN ──
SELECT host, count(*) AS tenants
FROM public.tec_tenants
WHERE status IS NULL OR status <> 'deleted'
GROUP BY host;

-- Conteo total: debe coincidir con el diagnóstico del paso 1 (nada se borró)
SELECT count(*) AS total_tenants FROM public.tec_tenants;
