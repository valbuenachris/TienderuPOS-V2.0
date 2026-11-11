-- POS v2 · v0.13.2 · Planes con features estructuradas (DDL aprobado)
-- La columna `features` en tec_subscription_plans es JSONB. Este script
-- actualiza el seed data de los planes existentes al nuevo formato
-- {"feature_key": true/false} en vez de ["texto"].
-- No altera la estructura de la tabla; solo actualiza los datos.
-- Ejecutar UNA VEZ antes de desplegar v0.13.2.

BEGIN;

-- 1) Plan Gratuito: solo core POS
UPDATE public.tec_subscription_plans
SET features = '{"advanced_reports": false, "crm": false, "whatsapp_bot": false, "app_management": false, "ai_assistant": false, "marketplace": false, "api_access": false}'::jsonb,
    description = '14 días de prueba. Solo el POS básico.'
WHERE lower(name) = 'plan gratuito';

-- 2) Plan Básico: core POS + advanced_reports
UPDATE public.tec_subscription_plans
SET features = '{"advanced_reports": true, "crm": false, "whatsapp_bot": false, "app_management": false, "ai_assistant": false, "marketplace": false, "api_access": false}'::jsonb,
    description = 'POS completo con reportes avanzados. Para pequeños negocios.'
WHERE lower(name) = 'plan básico';

-- 3) Plan Profesional: Básico + crm + whatsapp_bot
UPDATE public.tec_subscription_plans
SET features = '{"advanced_reports": true, "crm": true, "whatsapp_bot": true, "app_management": false, "ai_assistant": false, "marketplace": false, "api_access": false}'::jsonb,
    description = 'POS + reportes avanzados + CRM + WhatsApp Bot. Para negocios en crecimiento.'
WHERE lower(name) = 'plan profesional';

-- 4) Plan Empresarial: Profesional + app_management + ai_assistant + marketplace + api_access
UPDATE public.tec_subscription_plans
SET features = '{"advanced_reports": true, "crm": true, "whatsapp_bot": true, "app_management": true, "ai_assistant": true, "marketplace": true, "api_access": true}'::jsonb,
    description = 'Todo incluido: POS, CRM, WhatsApp, Tienda Virtual, Asistente IA, Marketplace, API. Para grandes negocios.'
WHERE lower(name) = 'plan empresarial';

-- Verificación
SELECT name, features FROM public.tec_subscription_plans ORDER BY COALESCE(price_monthly, 0) ASC;