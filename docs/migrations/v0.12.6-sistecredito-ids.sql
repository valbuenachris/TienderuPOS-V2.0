-- POS v2 · v0.12.6 · Sistecrédito: Vendor ID / Store ID por tenant (DDL aprobado)
-- El plugin oficial de Sistecrédito exige TRES credenciales por comercio:
--   Vendor ID        -> sistecredito_vendor_id
--   Store ID         -> sistecredito_store_id
--   Subscription Key -> sistecredito_api_key (columna ya existente, v0.3.78)
-- Sin las tres, el checkout falla cerrado (PAYMENT_NOT_CONFIGURED).
-- Ejecutar UNA VEZ ANTES de desplegar la imagen v0.12.6. No borra datos.
-- La API NUNCA ejecuta DDL: este script lo corre el operador manualmente.

BEGIN;

ALTER TABLE public.tec_tenant_payment_settings
  ADD COLUMN IF NOT EXISTS sistecredito_vendor_id varchar(64),
  ADD COLUMN IF NOT EXISTS sistecredito_store_id varchar(64);

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tec_tenant_payment_settings'
  AND column_name IN ('sistecredito_vendor_id', 'sistecredito_store_id')
ORDER BY column_name;

-- Carga de credenciales (DML del operador; mantener enabled=false hasta certificar).
-- La Subscription Key NO se versiona: reemplazar <...> por el valor real.
-- BEGIN;
--   UPDATE public.tec_tenant_payment_settings
--   SET sistecredito_vendor_id = '<VENDOR_ID>',
--       sistecredito_store_id = '<STORE_ID>',
--       sistecredito_api_key = '<SUBSCRIPTION_KEY>',
--       updated_at = now()
--   WHERE tenant_id = 'ac344fcc-d3bf-4c0d-b8ab-135c985ce8df';
-- COMMIT;
--
-- Verificación de credenciales (sin exponer la key):
-- SELECT tenant_id, sistecredito_enabled,
--        (sistecredito_vendor_id IS NOT NULL) AS vendor_ok,
--        (sistecredito_store_id IS NOT NULL) AS store_ok,
--        (sistecredito_api_key IS NOT NULL) AS key_ok
-- FROM public.tec_tenant_payment_settings
-- WHERE tenant_id = 'ac344fcc-d3bf-4c0d-b8ab-135c985ce8df';

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   ALTER TABLE public.tec_tenant_payment_settings DROP COLUMN IF EXISTS sistecredito_vendor_id;
--   ALTER TABLE public.tec_tenant_payment_settings DROP COLUMN IF EXISTS sistecredito_store_id;
-- COMMIT;
