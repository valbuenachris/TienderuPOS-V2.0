-- POS v2 · v0.3.11 · Tenant Management Platform
-- Approved DDL exception (the only tables allowed beyond tec_tenants).
-- Run this ONCE against the POS database BEFORE deploying the v0.3.11 images.
-- The API never runs DDL; it only does DML once these tables exist.
--
-- Deviations from the original spec (documented decisions):
--   1) tec_tenant_activity_logs.performed_by is INTEGER (not uuid) because
--      public.tec_users.id is an integer identity (verified live schema).
--   2) No updated_at trigger: the API sets updated_at explicitly on UPDATE.
--   3) gen_random_uuid() requires PostgreSQL >= 13 (built-in) or pgcrypto.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tec_subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  description text,
  price_monthly decimal(10,2),
  price_yearly decimal(10,2),
  max_users integer DEFAULT -1,
  max_stores integer DEFAULT -1,
  features jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tec_tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  plan_id uuid REFERENCES public.tec_subscription_plans(id),
  status varchar(20) NOT NULL DEFAULT 'trial',
  trial_start_date date,
  trial_end_date date,
  subscription_start_date date,
  subscription_end_date date,
  billing_cycle varchar(20),
  last_payment_date date,
  last_payment_amount decimal(10,2),
  next_billing_date date,
  auto_renew boolean DEFAULT true,
  cancellation_reason text,
  cancelled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tec_tenant_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.tec_tenant_subscriptions(id),
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  amount decimal(10,2) NOT NULL,
  payment_date date DEFAULT CURRENT_DATE,
  payment_method varchar(50),
  status varchar(20) DEFAULT 'completed',
  invoice_url varchar(255),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tec_tenant_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  action varchar(100) NOT NULL,
  details jsonb,
  performed_by integer,
  performed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant_id ON public.tec_tenant_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status ON public.tec_tenant_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_tenant_payments_tenant_id ON public.tec_tenant_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_activity_logs_tenant_id ON public.tec_tenant_activity_logs(tenant_id);

-- Default plans (idempotent by name)
INSERT INTO public.tec_subscription_plans (name, description, price_monthly, price_yearly, max_users, max_stores, features, is_active)
SELECT 'Plan Gratuito', 'Prueba de 14 días para conocer el POS', 0, 0, 1, 1,
       '["14 días de prueba"]'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM public.tec_subscription_plans WHERE lower(name) = 'plan gratuito');

INSERT INTO public.tec_subscription_plans (name, description, price_monthly, price_yearly, max_users, max_stores, features, is_active)
SELECT 'Plan Básico', 'Para negocios que inician', 20, 200, 3, 1,
       '["Soporte por email"]'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM public.tec_subscription_plans WHERE lower(name) = 'plan básico');

INSERT INTO public.tec_subscription_plans (name, description, price_monthly, price_yearly, max_users, max_stores, features, is_active)
SELECT 'Plan Profesional', 'Para negocios en crecimiento', 50, 500, 10, 3,
       '["Soporte prioritario", "Reportes avanzados"]'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM public.tec_subscription_plans WHERE lower(name) = 'plan profesional');

INSERT INTO public.tec_subscription_plans (name, description, price_monthly, price_yearly, max_users, max_stores, features, is_active)
SELECT 'Plan Empresarial', 'Sin límites para operaciones grandes', 199, 1990, -1, -1,
       '["Soporte 24/7", "API access"]'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM public.tec_subscription_plans WHERE lower(name) = 'plan empresarial');

-- One-time backfill: existing non-deleted tenants without subscription get Plan Gratuito activo.
-- New tenants created after deployment start in a 14-day trial (API bootstrap).
INSERT INTO public.tec_tenant_subscriptions
  (tenant_id, plan_id, status, trial_start_date, trial_end_date,
   subscription_start_date, subscription_end_date, billing_cycle, auto_renew)
SELECT t.id,
       p.id,
       'active',
       COALESCE(t.created_at::date, CURRENT_DATE),
       NULL,
       COALESCE(t.created_at::date, CURRENT_DATE),
       NULL,
       'monthly',
       true
FROM public.tec_tenants t
LEFT JOIN public.tec_subscription_plans p ON lower(p.name) = 'plan gratuito'
WHERE t.status <> 'deleted'
  AND NOT EXISTS (
    SELECT 1 FROM public.tec_tenant_subscriptions s WHERE s.tenant_id = t.id
  );

-- Optional verification queries (run manually):
-- SELECT name, price_monthly, price_yearly, max_users, max_stores, is_active FROM public.tec_subscription_plans ORDER BY price_monthly;
-- SELECT t.name, s.status, p.name AS plan, s.trial_end_date, s.next_billing_date
-- FROM public.tec_tenants t
-- LEFT JOIN public.tec_tenant_subscriptions s ON s.tenant_id = t.id
-- LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id
-- WHERE t.status <> 'deleted';

COMMIT;
