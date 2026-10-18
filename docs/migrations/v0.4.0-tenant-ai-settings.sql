-- POS v2 · v0.4.0 · Configuración del Asistente IA por tenant (DDL aprobado)
-- Guarda el modelo elegido y el interruptor por tenant. La API key de OpenRouter
-- vive SOLO en el .env del API (la plataforma cobra el servicio): la columna
-- openrouter_api_key queda RESERVADA para una fase futura (key por tenant).
-- Ejecutar UNA VEZ antes de desplegar v0.4.0. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_tenant_ai_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tec_tenants(id),
  model varchar(120),
  enabled boolean NOT NULL DEFAULT true,
  openrouter_api_key varchar(255),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tec_tenant_ai_settings'
ORDER BY ordinal_position;
