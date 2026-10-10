-- POS v2 · v0.3.52 · Categorías de productos (DDL aprobado)
-- Ejecutar UNA VEZ antes de desplegar v0.3.52. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  name varchar(100) NOT NULL,
  description varchar(255),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT tec_categories_tenant_name_uq UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tec_categories_tenant_id
  ON public.tec_categories(tenant_id);

ALTER TABLE public.tec_products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.tec_categories(id);

CREATE INDEX IF NOT EXISTS idx_tec_products_category_id
  ON public.tec_products(category_id);

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'tec_categories')
    OR (table_name = 'tec_products' AND column_name = 'category_id'))
ORDER BY table_name, column_name;
