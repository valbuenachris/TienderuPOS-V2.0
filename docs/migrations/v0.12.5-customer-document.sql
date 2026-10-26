-- POS v2 · v0.12.5 · Documento del cliente para pagos con Addi en producción (DDL aprobado)
-- Addi exige `client.idNumber` real en producción (KYC): hoy se envía la CC de
-- prueba `ADDI_TEST_DOCUMENT_NUMBER` (solo sandbox). La app tienda_virtual captura
-- el documento en el perfil del cliente (PUT /api/customer/profile).
-- Ejecutar UNA VEZ ANTES de desplegar la imagen v0.12.5. No borra datos.
-- La API NUNCA ejecuta DDL: este script lo corre el operador manualmente.

BEGIN;

ALTER TABLE public.tec_customers
  ADD COLUMN IF NOT EXISTS document_type varchar(4),
  ADD COLUMN IF NOT EXISTS document_number varchar(15);

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tec_customers'
  AND column_name IN ('document_type', 'document_number')
ORDER BY column_name;

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   ALTER TABLE public.tec_customers DROP COLUMN IF EXISTS document_type;
--   ALTER TABLE public.tec_customers DROP COLUMN IF EXISTS document_number;
-- COMMIT;
