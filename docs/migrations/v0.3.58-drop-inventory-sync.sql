-- POS v2 · v0.3.58 · Revertir la sincronización de inventario (DDL aprobado)
-- Elimina los triggers/funciones de sincronización de v0.3.57. La API queda 100% independiente:
-- única fuente de verdad = tec_products.quantity.
-- ⚠️ NO se dropea tec_product_store_qty (el POS legacy puede seguir leyéndola/escribiéndola,
--    pero ya no se sincroniza con la API). Ejecutar UNA VEZ antes de desplegar v0.3.58.

BEGIN;

DROP TRIGGER IF EXISTS trg_sync_product_quantity ON public.tec_products;
DROP TRIGGER IF EXISTS trg_sync_store_to_product ON public.tec_product_store_qty;

-- Funciones creadas por v0.3.57
DROP FUNCTION IF EXISTS public.sync_product_qty_to_stores();
DROP FUNCTION IF EXISTS public.sync_store_qty_to_product();

-- Por si se ejecutó el snippet alternativo con estos nombres
DROP FUNCTION IF EXISTS public.sync_product_to_store_qty();
DROP FUNCTION IF EXISTS public.sync_store_to_product_qty();

COMMIT;

-- Verificación: no deben quedar triggers de sync ni funciones
SELECT t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND t.tgname IN ('trg_sync_product_quantity', 'trg_sync_store_to_product');

SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('sync_product_qty_to_stores', 'sync_store_qty_to_product', 'sync_product_to_store_qty', 'sync_store_to_product_qty');
