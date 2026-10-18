-- POS v2 · v0.5.0 · Instancia de WhatsApp (Evolution API) por tenant (DDL aprobado)
-- Mapea tenant → instancia (la instancia vive en el servidor Evolution). La API key de
-- Evolution es global de la plataforma (.env); aquí NO se guardan credenciales.
-- Ejecutar UNA VEZ antes de desplegar v0.5.0. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_tenant_whatsapp_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tec_tenants(id),
  instance_name varchar(120) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'close',
  connected_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tec_tenant_whatsapp_settings'
ORDER BY ordinal_position;
