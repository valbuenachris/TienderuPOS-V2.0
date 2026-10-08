-- POS v2 · v0.3.11a · Corrección de precios y features de planes (SOLO DATOS)
-- Ejecutar UNA VEZ contra una base que ya tiene la migración v0.3.11 aplicada.
-- No requiere rebuild ni redeploy: el frontend genera "N usuario(s) / N tienda(s)"
-- desde max_users/max_stores, por lo que features solo debe contener beneficios.
--
-- Nota: los planes sembrados se llaman 'Plan Básico', 'Plan Profesional', etc.
-- (con prefijo "Plan"), por eso se compara con lower(name) = 'plan básico'.

BEGIN;

UPDATE public.tec_subscription_plans
SET price_monthly = 20, price_yearly = 200,
    features = '["Soporte por email"]'::jsonb
WHERE lower(name) = 'plan básico';

UPDATE public.tec_subscription_plans
SET price_monthly = 50, price_yearly = 500,
    features = '["Soporte prioritario", "Reportes avanzados"]'::jsonb
WHERE lower(name) = 'plan profesional';

UPDATE public.tec_subscription_plans
SET features = '["14 días de prueba"]'::jsonb
WHERE lower(name) = 'plan gratuito';

UPDATE public.tec_subscription_plans
SET features = '["Soporte 24/7", "API access"]'::jsonb
WHERE lower(name) = 'plan empresarial';

COMMIT;

-- Verificación: Básico 20/200, Profesional 50/500, Gratuito 0/0, Empresarial 199/1990.
-- Cada fila debe devolver exactamente 1 plan; si el nombre no coincide, revisar
-- SELECT name FROM public.tec_subscription_plans; antes de reintentar.
SELECT name, price_monthly, price_yearly, max_users, max_stores, features
FROM public.tec_subscription_plans
ORDER BY price_monthly;
