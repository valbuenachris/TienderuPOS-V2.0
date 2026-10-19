-- POS v2 · v0.12.0 · WhatsApp de la plataforma para el marketplace (DDL aprobado)
-- Instancia ÚNICA de tienderu.com (la administra el super admin) para:
--   - notificar al comprador y al vendedor los pedidos del marketplace,
--   - atender a los clientes con el chatbot de ventas cross-tenant.
-- La API key de Evolution es global de la plataforma (.env); aquí NO se guardan credenciales.
-- Ejecutar UNA VEZ antes de desplegar v0.12.0. No borra datos.

BEGIN;

-- 1) Configuración de la instancia de plataforma (fila única id = 1).
CREATE TABLE IF NOT EXISTS public.tec_marketplace_whatsapp (
  id integer PRIMARY KEY DEFAULT 1,
  instance_name varchar(120) NOT NULL DEFAULT 'tienderu-marketplace',
  status varchar(20) NOT NULL DEFAULT 'close',
  connected_at timestamptz,
  agent_enabled boolean NOT NULL DEFAULT false,
  agent_name varchar(60),
  agent_tone varchar(20) DEFAULT 'amable',
  notify_customers boolean NOT NULL DEFAULT true,
  notify_tenants boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT ck_tec_marketplace_whatsapp_single CHECK (id = 1)
);

-- 2) Conversaciones del bot de la plataforma (por teléfono; estado bot|human).
CREATE TABLE IF NOT EXISTS public.tec_marketplace_whatsapp_conversations (
  phone varchar(30) PRIMARY KEY,
  push_name varchar(120),
  status varchar(20) NOT NULL DEFAULT 'bot',
  last_message_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 3) Mensajes del bot (dedup de webhooks por message_id).
CREATE TABLE IF NOT EXISTS public.tec_marketplace_whatsapp_messages (
  id bigserial PRIMARY KEY,
  phone varchar(30) NOT NULL,
  direction varchar(3) NOT NULL,
  message_id varchar(120),
  body text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tec_marketplace_whatsapp_messages_msgid
  ON public.tec_marketplace_whatsapp_messages (message_id) WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tec_marketplace_whatsapp_messages_phone
  ON public.tec_marketplace_whatsapp_messages (phone, id DESC);

COMMIT;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tec_marketplace_whatsapp'
ORDER BY ordinal_position;

SELECT COUNT(*)::integer AS conversations_table
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('tec_marketplace_whatsapp_conversations', 'tec_marketplace_whatsapp_messages');

-- Reversión (opcional):
-- BEGIN;
--   DROP TABLE IF EXISTS public.tec_marketplace_whatsapp_messages;
--   DROP TABLE IF EXISTS public.tec_marketplace_whatsapp_conversations;
--   DROP TABLE IF EXISTS public.tec_marketplace_whatsapp;
-- COMMIT;
