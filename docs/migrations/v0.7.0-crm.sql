-- POS v2 · v0.7.0 · CRM de ventas por tenant (DDL aprobado)
-- Leads con pipeline, timeline de actividades, plantillas y automatizaciones.
-- Ejecutar UNA VEZ antes de desplegar v0.7.0. No borra datos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_crm_leads (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  customer_id integer REFERENCES public.tec_customers(id),
  name varchar(120),
  phone varchar(30) NOT NULL,
  email varchar(150),
  source varchar(20) NOT NULL DEFAULT 'manual',
  stage varchar(20) NOT NULL DEFAULT 'new',
  score integer NOT NULL DEFAULT 0,
  owner_id integer,
  opt_out boolean NOT NULL DEFAULT false,
  last_activity_at timestamptz,
  next_followup_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tec_crm_leads_tenant_phone
  ON public.tec_crm_leads (tenant_id, phone);
CREATE INDEX IF NOT EXISTS ix_tec_crm_leads_pipeline
  ON public.tec_crm_leads (tenant_id, stage, next_followup_at);

CREATE TABLE IF NOT EXISTS public.tec_crm_activities (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  lead_id bigint NOT NULL REFERENCES public.tec_crm_leads(id) ON DELETE CASCADE,
  type varchar(20) NOT NULL,
  content text,
  due_at timestamptz,
  completed_at timestamptz,
  created_by integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tec_crm_activities_lead
  ON public.tec_crm_activities (lead_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_tec_crm_activities_automation
  ON public.tec_crm_activities (tenant_id, type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tec_crm_templates (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  name varchar(120) NOT NULL,
  body text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tec_crm_automations (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  name varchar(120) NOT NULL,
  trigger varchar(30) NOT NULL,
  delay_hours integer NOT NULL DEFAULT 24,
  template_id bigint REFERENCES public.tec_crm_templates(id),
  enabled boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tec_crm_automations_tenant
  ON public.tec_crm_automations (tenant_id, enabled);

COMMIT;

-- Verificación
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'tec_crm_%'
ORDER BY table_name;
