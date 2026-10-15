-- POS v2 · v0.3.65 · Reseñas de productos (DDL aprobado)
-- Tabla de reseñas/calificaciones de la app de clientes (tienda_virtual).
-- Sin tenant_id: el servicio valida que el producto pertenezca al tenant del cliente
-- vía public.tec_products antes de leer/escribir.
-- Regla de negocio: UNA reseña por cliente y producto (constraint UNIQUE).
-- Ejecutar UNA VEZ antes de usar la sección de reseñas en la app. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES public.tec_products(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES public.tec_customers(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON public.product_reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_customer_id ON public.product_reviews(customer_id);

-- Una reseña por cliente y producto. PostgreSQL no soporta ADD CONSTRAINT IF NOT EXISTS,
-- así que el ALTER se protege con pg_constraint para que el script sea re-ejecutable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unique_product_customer_review'
      AND conrelid = 'public.product_reviews'::regclass
  ) THEN
    ALTER TABLE public.product_reviews
      ADD CONSTRAINT unique_product_customer_review UNIQUE (product_id, customer_id);
  END IF;
END
$$;

COMMIT;

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'product_reviews'
ORDER BY ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'product_reviews'
ORDER BY indexname;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.product_reviews'::regclass
ORDER BY conname;

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   DROP TABLE IF EXISTS public.product_reviews;
-- COMMIT;

