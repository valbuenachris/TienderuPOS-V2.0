-- POS v2 · v0.3.59 · Autenticación de clientes B2C y puntos propios (DDL aprobado)
-- Añade credenciales (hash) y saldo de puntos a public.tec_customers para la app
-- tienda_virtual. Ejecutar UNA VEZ antes de desplegar v0.3.59. No borra datos.
-- La API NUNCA ejecuta DDL: este script lo corre el operador manualmente.

BEGIN;

-- Add password and points balance to customers
ALTER TABLE public.tec_customers
  ADD COLUMN IF NOT EXISTS password varchar(255),
  ADD COLUMN IF NOT EXISTS points_balance integer DEFAULT 0;

-- Add index for faster login lookups
CREATE INDEX IF NOT EXISTS idx_tec_customers_phone ON public.tec_customers(phone);
CREATE INDEX IF NOT EXISTS idx_tec_customers_email ON public.tec_customers(email);

-- Functional index for case-insensitive login (LOWER(email) = LOWER($1))
CREATE INDEX IF NOT EXISTS idx_tec_customers_email_lower
  ON public.tec_customers(LOWER(email))
  WHERE email IS NOT NULL;

COMMIT;

-- Verificación
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tec_customers'
  AND column_name IN ('password', 'points_balance')
ORDER BY column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'tec_customers'
ORDER BY indexname;

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   DROP INDEX IF EXISTS public.idx_tec_customers_phone;
--   DROP INDEX IF EXISTS public.idx_tec_customers_email;
--   DROP INDEX IF EXISTS public.idx_tec_customers_email_lower;
--   ALTER TABLE public.tec_customers DROP COLUMN IF EXISTS password;
--   ALTER TABLE public.tec_customers DROP COLUMN IF EXISTS points_balance;
-- COMMIT;
