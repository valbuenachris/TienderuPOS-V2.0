-- POS v2 · v0.6.0 · Bot de ventas por WhatsApp (DDL aprobado)
-- 1) Config del agente sobre la tabla existente (v0.5.0).
-- 2) Conversaciones por teléfono/tenant (estado bot|human).
-- 3) Mensajes con dedup por message_id (Evolution reintenta webhooks).
-- Ejecutar UNA VEZ antes de desplegar v0.6.0. No borra datos.

BEGIN;

ALTER TABLE public.tec_tenant_whatsapp_settings
  ADD COLUMN IF NOT EXISTS agent_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_name varchar(60),
  ADD COLUMN IF NOT EXISTS agent_tone varchar(20) DEFAULT 'amable';

CREATE TABLE IF NOT EXISTS public.tec_whatsapp_conversations (
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  phone varchar(30) NOT NULL,
  push_name varchar(120),
  status varchar(20) NOT NULL DEFAULT 'bot',
  last_message_at timestamptz,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, phone)
);

CREATE TABLE IF NOT EXISTS public.tec_whatsapp_messages (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  phone varchar(30) NOT NULL,
  direction varchar(3) NOT NULL,
  message_id varchar(120),
  body text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tec_whatsapp_messages_msgid
  ON public.tec_whatsapp_messages (message_id) WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tec_whatsapp_messages_conversation
  ON public.tec_whatsapp_messages (tenant_id, phone, id DESC);

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('tec_tenant_whatsapp_settings', 'tec_whatsapp_conversations', 'tec_whatsapp_messages')
ORDER BY table_name, ordinal_position;
