-- POS v2 · v0.3.60 · Retiro del trigger de puntos de clientes (DDL aprobado)
-- Los puntos de fidelidad pasan a la API (SalesService): se acreditan, ajustan y
-- revierten dentro de la misma transacción de la venta. Este script elimina el
-- trigger legacy que acreditaba puntos directamente desde la base de datos.
-- Ejecutar UNA VEZ antes de desplegar v0.3.60. No borra datos.
-- ⚠️ public.point_transactions NO se toca: no tiene customer_id/sale_id/tenant_id,
--    así que la API no la usa (solo actualiza tec_customers.points_balance).

BEGIN;

-- 1. Eliminar el trigger legacy en tec_sales
DROP TRIGGER IF EXISTS trg_acreditar_puntos_venta ON public.tec_sales;

-- 2. Eliminar la función asociada solo si ningún otro trigger la usa
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE p.proname = 'acreditar_puntos_por_venta'
      AND NOT t.tgisinternal
  ) THEN
    EXECUTE 'DROP FUNCTION IF EXISTS public.acreditar_puntos_por_venta()';
  END IF;
END
$$;

COMMIT;

-- Verificación: no deben quedar el trigger ni la función de puntos
SELECT tgname, tgrelid::regclass
FROM pg_trigger
WHERE tgname = 'trg_acreditar_puntos_venta';

SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'acreditar_puntos_por_venta';
