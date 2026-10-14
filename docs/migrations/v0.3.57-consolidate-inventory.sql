-- POS v2 · v0.3.57 · Consolidación de inventario en tec_products.quantity (DDL aprobado)
-- `tec_products.quantity` pasa a ser la fuente de verdad para la API.
-- Se añaden DOS triggers de sincronización con tec_product_store_qty para que el POS PHP
-- legacy siga funcionando (lecturas y ventas) sin cambios:
--   1) trg_sync_product_quantity  : products.quantity → filas de tienda (espejo).
--   2) trg_sync_store_to_product  : filas de tienda → products.quantity (ventas legacy).
-- Son los ÚNICOS triggers permitidos en tablas de stock; el resto siguen prohibidos.
-- Ejecutar UNA VEZ antes de desplegar v0.3.57.

BEGIN;

ALTER TABLE public.tec_products
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 0;

-- Backfill: stock global por producto (suma de todas sus tiendas).
UPDATE public.tec_products p
SET quantity = COALESCE((
  SELECT SUM(q.quantity)::integer
  FROM public.tec_product_store_qty q
  WHERE q.product_id = p.id AND q.tenant_id = p.tenant_id
), 0)
WHERE p.quantity = 0;

-- 1) products.quantity → todas las filas de tienda del producto (crea una si no existe).
CREATE OR REPLACE FUNCTION public.sync_product_qty_to_stores()
RETURNS trigger AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.tec_product_store_qty
  SET quantity = NEW.quantity
  WHERE product_id = NEW.id AND tenant_id = NEW.tenant_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count = 0 THEN
    INSERT INTO public.tec_product_store_qty (tenant_id, product_id, store_id, quantity)
    SELECT NEW.tenant_id, NEW.id, s.id, NEW.quantity
    FROM public.tec_stores s
    WHERE s.tenant_id = NEW.tenant_id
    ORDER BY s.id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_product_quantity ON public.tec_products;
CREATE TRIGGER trg_sync_product_quantity
AFTER INSERT OR UPDATE OF quantity ON public.tec_products
FOR EACH ROW EXECUTE FUNCTION public.sync_product_qty_to_stores();

-- 2) filas de tienda (POS legacy) → products.quantity. Guarda de profundidad para evitar recursión.
CREATE OR REPLACE FUNCTION public.sync_store_qty_to_product()
RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.tec_products
  SET quantity = NEW.quantity
  WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_store_to_product ON public.tec_product_store_qty;
CREATE TRIGGER trg_sync_store_to_product
AFTER INSERT OR UPDATE OF quantity ON public.tec_product_store_qty
FOR EACH ROW EXECUTE FUNCTION public.sync_store_qty_to_product();

COMMIT;

-- Verificación: productos con stock y espejo en tiendas
SELECT p.id, p.name, p.quantity AS product_qty,
       COALESCE(SUM(q.quantity), 0) AS stores_qty
FROM public.tec_products p
LEFT JOIN public.tec_product_store_qty q
  ON q.product_id = p.id AND q.tenant_id = p.tenant_id
GROUP BY p.id, p.name, p.quantity
ORDER BY p.id
LIMIT 20;
