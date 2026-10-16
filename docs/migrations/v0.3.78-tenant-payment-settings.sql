-- POS v2 · v0.3.78 · Credenciales de pago POR TENANT (DDL aprobado)
-- Separa el billing del SaaS (api/src/billing/*, que sigue con el .env global)
-- de los cobros de la tienda virtual (cada tenant cobra en SU cuenta Bold/Addi/Sistecredito).
-- Ejecutar UNA VEZ antes de desplegar v0.3.78. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_tenant_payment_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tec_tenants(id),
  bold_enabled boolean NOT NULL DEFAULT false,
  bold_api_key varchar(255),
  bold_webhook_secret varchar(255),
  addi_enabled boolean NOT NULL DEFAULT false,
  addi_api_key varchar(255),
  addi_webhook_secret varchar(255),
  sistecredito_enabled boolean NOT NULL DEFAULT false,
  sistecredito_api_key varchar(255),
  sistecredito_webhook_secret varchar(255),
  return_url varchar(500),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tec_tenant_payment_settings'
ORDER BY ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED de Princess Skin (reemplaza los valores por las llaves REALES del panel
-- de Bold/Addi de la tienda). Notas:
--  · `bold_webhook_secret` puede quedar NULL: en ese caso la firma del webhook
--    se valida con `bold_api_key` (así firma Bold con la llave de identidad).
--  · `addi_webhook_secret` es el valor que Addi mandará en `x-webhook-secret`;
--    si queda NULL, el webhook corre en modo sandbox (solo loggea).
--  · `return_url` es opcional: override del `CUSTOMER_PAYMENT_RETURN_URL` global.
--  · Habilitar solo lo que la tienda tenga contratado; los no configurados
--    fallan cerrado ("Este método de pago no está configurado para esta tienda").
-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT INTO public.tec_tenant_payment_settings
--   (tenant_id, bold_enabled, bold_api_key, bold_webhook_secret,
--    addi_enabled, addi_api_key, addi_webhook_secret, return_url)
-- SELECT id, true, 'LLAVE_IDENTIDAD_BOLD_DE_PRINCESS_SKIN', NULL,
--        false, NULL, NULL, NULL
-- FROM public.tec_tenants
-- WHERE lower(name) = 'princess skin'
-- ON CONFLICT (tenant_id) DO UPDATE SET
--   bold_enabled = EXCLUDED.bold_enabled,
--   bold_api_key = EXCLUDED.bold_api_key,
--   bold_webhook_secret = EXCLUDED.bold_webhook_secret,
--   addi_enabled = EXCLUDED.addi_enabled,
--   addi_api_key = EXCLUDED.addi_api_key,
--   addi_webhook_secret = EXCLUDED.addi_webhook_secret,
--   return_url = EXCLUDED.return_url,
--   updated_at = now();
--
-- Verificar el seed:
-- SELECT tenant_id, bold_enabled, (bold_api_key IS NOT NULL) AS bold_key,
--        addi_enabled, (addi_api_key IS NOT NULL) AS addi_key
-- FROM public.tec_tenant_payment_settings;
