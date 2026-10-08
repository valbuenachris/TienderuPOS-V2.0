-- POS v2 · v0.3.16 · Settings por tenant (DDL aprobado: tec_tenant_settings)
-- Ejecutar UNA VEZ antes de desplegar v0.3.16. La API detecta la tabla al arrancar:
--   * si existe  → lee/escribe la configuración del tenant (esta tabla);
--   * si no existe → mantiene el modo global legado (primera fila de tec_settings).
-- Incluye las columnas extra que el POS ya usa (impuestos, ticket, QR, ancho…)
-- además de las propuestas, para no deshabilitar la UI ni perder el ticket.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_tenant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tec_tenants(id) ON DELETE CASCADE,
  site_name varchar(255),
  logo_url text,
  address text,
  phone varchar(50),
  email varchar(255),
  nit varchar(50),
  currency_prefix varchar(10) DEFAULT '$',
  timezone varchar(50) DEFAULT 'America/Bogota',
  language varchar(10) DEFAULT 'es',
  theme varchar(50) DEFAULT 'default',
  default_customer integer,
  default_tax numeric(6,2),
  decimal_digits smallint DEFAULT 2,
  thank_you_message varchar(255),
  return_policy text,
  show_qr_on_ticket boolean DEFAULT true,
  printer_width varchar(8) DEFAULT '58mm',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Backfill idempotente:
--   * el tenant MÁS ANTIGUO (tenant original) hereda la fila legada completa
--     (site_name, logo, dirección, NIT, etc.), para que "Skin" siga igual;
--   * los demás arrancan con defaults y site_name = nombre del tenant.
-- Si tu tenant original no es el más antiguo, reemplaza el CTE `original` por su UUID:
--   original AS (SELECT '<UUID_DEL_TENANT_ORIGINAL>'::uuid AS id)
WITH base AS (
  SELECT * FROM public.tec_settings ORDER BY setting_id ASC LIMIT 1
), original AS (
  SELECT id
  FROM public.tec_tenants
  WHERE status IS NULL OR status <> 'deleted'
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1
)
INSERT INTO public.tec_tenant_settings
  (tenant_id, site_name, logo_url, address, phone, email, nit, currency_prefix, timezone, language,
   default_customer, default_tax, decimal_digits, thank_you_message, return_policy, show_qr_on_ticket, printer_width)
SELECT t.id,
       CASE WHEN t.id = o.id THEN COALESCE(b.site_name, t.name) ELSE t.name END,
       CASE WHEN t.id = o.id THEN b.logo_url END,
       CASE WHEN t.id = o.id THEN b.address END,
       CASE WHEN t.id = o.id THEN b.phone END,
       CASE WHEN t.id = o.id THEN b.email END,
       CASE WHEN t.id = o.id THEN b.nit END,
       COALESCE(b.currency_prefix, '$'),
       COALESCE(b.timezone, 'America/Bogota'),
       COALESCE(b.language, 'es'),
       b.default_customer,
       b.default_tax,
       COALESCE(b.decimal_digits, 2),
       b.thank_you_message,
       b.return_policy,
       COALESCE(b.show_qr_on_ticket, true),
       COALESCE(b.printer_width, '58mm')
FROM public.tec_tenants t
LEFT JOIN base b ON true
LEFT JOIN original o ON true
WHERE (t.status IS NULL OR t.status <> 'deleted')
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;

-- Verificación: debe haber exactamente una fila por tenant
SELECT t.name, s.site_name, s.currency_prefix, s.timezone, s.printer_width
FROM public.tec_tenants t
LEFT JOIN public.tec_tenant_settings s ON s.tenant_id = t.id
WHERE (t.status IS NULL OR t.status <> 'deleted')
ORDER BY t.name;
