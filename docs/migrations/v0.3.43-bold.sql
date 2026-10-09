-- POS v2 · v0.3.43 · Bold Checkout (API Link de pagos)
-- DDL aprobado: columna para el id del link/transacción de Bold en tec_tenant_payments.
-- Ejecutar una vez ANTES de desplegar v0.3.43. No borra ni modifica datos existentes.

BEGIN;

ALTER TABLE public.tec_tenant_payments
  ADD COLUMN IF NOT EXISTS bold_payment_id varchar(255);

-- Índice único parcial: garantiza idempotencia del webhook/verificación por link (LNK_*)
CREATE UNIQUE INDEX IF NOT EXISTS tec_tenant_payments_bold_payment_id_uq
  ON public.tec_tenant_payments (bold_payment_id)
  WHERE bold_payment_id IS NOT NULL;

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tec_tenant_payments' AND column_name = 'bold_payment_id';
