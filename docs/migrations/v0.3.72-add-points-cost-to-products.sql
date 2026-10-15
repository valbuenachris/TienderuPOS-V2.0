-- POS v2 · v0.3.72 · Costo en puntos para canje (DDL aprobado)
-- Ejecutar UNA VEZ antes de desplegar v0.3.72. No borra datos.

BEGIN;

ALTER TABLE public.tec_products
  ADD COLUMN IF NOT EXISTS points_cost integer DEFAULT 0;

-- PostgreSQL no soporta ADD CONSTRAINT IF NOT EXISTS: se verifica en pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_points_cost_positive'
      AND conrelid = 'public.tec_products'::regclass
  ) THEN
    ALTER TABLE public.tec_products
      ADD CONSTRAINT chk_points_cost_positive CHECK (points_cost >= 0);
  END IF;
END $$;

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tec_products' AND column_name = 'points_cost';

SELECT conname FROM pg_constraint
WHERE conname = 'chk_points_cost_positive';
