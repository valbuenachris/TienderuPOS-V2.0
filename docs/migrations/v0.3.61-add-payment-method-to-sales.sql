-- POS v2 · v0.3.61 · Método de pago del pedido (DDL aprobado)
-- Guarda el método elegido en el checkout de la app de clientes
-- ('cash'|'bold'|'addi'|'sistecredito') para mostrar el estado pendiente
-- (p. ej. "Pendiente de aprobación (Addi)") antes del webhook.
-- Los pedidos creados por el POS quedan en NULL (el método real vive en tec_payments.paid_by).
--
-- ⚠️ Ejecutar UNA VEZ **ANTES** de desplegar la API v0.3.61: el INSERT de ventas
--    referencia la columna directamente. No borra datos.

BEGIN;

ALTER TABLE public.tec_sales
  ADD COLUMN IF NOT EXISTS payment_method varchar(50);

COMMIT;

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tec_sales'
  AND column_name = 'payment_method';

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   ALTER TABLE public.tec_sales DROP COLUMN IF EXISTS payment_method;
-- COMMIT;
