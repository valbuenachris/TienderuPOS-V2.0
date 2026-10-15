-- POS v2 · v0.3.69 · Direcciones de clientes (DDL aprobado)
-- Direcciones de entrega de la app de clientes (tienda_virtual).
-- El servicio valida la propiedad (tenant + customer) en cada operación y
-- mantiene una sola dirección predeterminada por cliente.
-- Sin esta migración los GET devuelven [] y POST/PUT/DELETE responden 503 con el hint.
-- Ejecutar UNA VEZ antes de usar la sección de direcciones. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES public.tec_customers(id) ON DELETE CASCADE,
  label VARCHAR(50) NOT NULL,
  street_address TEXT NOT NULL,
  neighborhood VARCHAR(100),
  city VARCHAR(100) DEFAULT 'Bogotá',
  phone VARCHAR(20),
  additional_notes TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id ON public.customer_addresses(customer_id);

COMMIT;

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customer_addresses'
ORDER BY ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'customer_addresses'
ORDER BY indexname;

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   DROP TABLE IF EXISTS public.customer_addresses;
-- COMMIT;
