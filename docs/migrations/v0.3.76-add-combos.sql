-- POS v2 · v0.3.76 · Combos de la app de clientes (DDL aprobado)
-- Combos de la tienda virtual: bundle de productos con precio especial.
-- Solo se pueden pagar con efectivo/contraentrega (validado en la API).
--
-- ⚠️ NO se reutiliza public.tec_combo_items: esa tabla YA EXISTE (POS legacy PHP)
-- con otra estructura (`product_id` = producto combo, `item_code`, `quantity` decimal).
-- Con CREATE TABLE IF NOT EXISTS la tabla se habría omitido silenciosamente.
-- Los items de los combos de la app viven en public.tec_customer_combo_items.
--
-- Ejecutar UNA VEZ antes de desplegar v0.3.76. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_combos (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES public.tec_tenants(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  combo_price NUMERIC(10,2) NOT NULL,
  original_price NUMERIC(10,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tec_customer_combo_items (
  id SERIAL PRIMARY KEY,
  combo_id INTEGER REFERENCES public.tec_combos(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES public.tec_products(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_tec_combos_tenant_id
  ON public.tec_combos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tec_customer_combo_items_combo_id
  ON public.tec_customer_combo_items(combo_id);
CREATE INDEX IF NOT EXISTS idx_tec_customer_combo_items_product_id
  ON public.tec_customer_combo_items(product_id);

COMMIT;

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('tec_combos', 'tec_customer_combo_items')
ORDER BY table_name, ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('tec_combos', 'tec_customer_combo_items')
ORDER BY indexname;

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   DROP TABLE IF EXISTS public.tec_customer_combo_items;
--   DROP TABLE IF EXISTS public.tec_combos;
-- COMMIT;
