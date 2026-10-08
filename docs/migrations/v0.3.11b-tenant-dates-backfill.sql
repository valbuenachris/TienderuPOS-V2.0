-- POS v2 · v0.3.11b · Backfill de fechas de suscripción y pago (SOLO DATOS)
-- Causa del síntoma "PRUEBA / VIGENCIA —" y "ÚLTIMO PAGO —":
--   el backfill de v0.3.11 creó suscripciones 'active' con subscription_start_date
--   pero sin trial_end_date / subscription_end_date / next_billing_date, y aún no
--   hay pagos registrados. El API sí devuelve los campos; solo faltan los datos.
-- Ejecutar UNA VEZ contra la base desplegada. No requiere rebuild (la UI además
-- ahora muestra "Activa desde …" cuando no hay fecha de renovación).
--
-- ⚠️ No conviertas las suscripciones 'active' existentes en 'trial' con fechas
-- derivadas de created_at: si trial_end_date queda en el pasado y
-- subscription_start_date se anula, refreshLifecycleStatuses las marcaría como
-- 'expired' en el siguiente ciclo (arranque o cada 6 h) y la UI mostraría
-- "Vencida" en todos los tenants. Los pasos 3 y 4 siguientes son la versión segura.

-- ── 1) DIAGNÓSTICO (ejecutar antes; esperado tras v0.3.11: fechas en NULL) ──
-- Suscripciones y sus fechas:
--   SELECT t.name, s.status, s.trial_start_date, s.trial_end_date,
--          s.subscription_start_date, s.subscription_end_date, s.next_billing_date,
--          s.last_payment_date, s.last_payment_amount
--   FROM public.tec_tenant_subscriptions s
--   JOIN public.tec_tenants t ON t.id = s.tenant_id
--   WHERE t.status <> 'deleted'
--   ORDER BY t.name;
--
-- Tenants sin suscripción (deberían ser 0):
--   SELECT t.id, t.name FROM public.tec_tenants t
--   WHERE t.status <> 'deleted'
--     AND NOT EXISTS (SELECT 1 FROM public.tec_tenant_subscriptions s WHERE s.tenant_id = t.id);
--
-- Pagos registrados:
--   SELECT tenant_id, subscription_id, payment_date, amount, status
--   FROM public.tec_tenant_payments ORDER BY payment_date DESC NULLS LAST;

BEGIN;

-- ── 2) Pruebas sin ventana: 14 días desde el inicio (o desde hoy) ──
UPDATE public.tec_tenant_subscriptions
SET trial_start_date = COALESCE(trial_start_date, CURRENT_DATE),
    trial_end_date = COALESCE(
      trial_end_date,
      (COALESCE(trial_start_date, CURRENT_DATE) + INTERVAL '14 days')::date
    ),
    updated_at = now()
WHERE status = 'trial'
  AND (trial_start_date IS NULL OR trial_end_date IS NULL);

-- ── 3) Suscripciones activas sin fin de periodo / próximo cobro ──
-- Convención: la base es la fecha de inicio (o hoy) y al menos un ciclo completo
-- desde hoy, según billing_cycle (mensual por defecto).
UPDATE public.tec_tenant_subscriptions
SET subscription_start_date = COALESCE(subscription_start_date, CURRENT_DATE),
    subscription_end_date = COALESCE(
      subscription_end_date,
      (GREATEST(COALESCE(subscription_start_date, CURRENT_DATE), CURRENT_DATE)
        + CASE WHEN billing_cycle = 'yearly' THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END)::date
    ),
    next_billing_date = COALESCE(
      next_billing_date,
      (GREATEST(COALESCE(subscription_start_date, CURRENT_DATE), CURRENT_DATE)
        + CASE WHEN billing_cycle = 'yearly' THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END)::date
    ),
    updated_at = now()
WHERE status = 'active'
  AND (next_billing_date IS NULL OR subscription_end_date IS NULL);

-- ── 4) Último pago: sincronizar desde tec_tenant_payments si falta ──
UPDATE public.tec_tenant_subscriptions s
SET last_payment_date = p.payment_date,
    last_payment_amount = p.amount,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (subscription_id) subscription_id, payment_date, amount
  FROM public.tec_tenant_payments
  WHERE status = 'completed'
  ORDER BY subscription_id, payment_date DESC NULLS LAST, created_at DESC NULLS LAST
) p
WHERE p.subscription_id = s.id
  AND s.last_payment_date IS NULL;

COMMIT;

-- ── 5) VERIFICACIÓN: ninguna activa/prueba debe quedar sin fechas ──
SELECT t.name, s.status, s.trial_end_date, s.subscription_end_date,
       s.next_billing_date, s.last_payment_date, s.last_payment_amount
FROM public.tec_tenant_subscriptions s
JOIN public.tec_tenants t ON t.id = s.tenant_id
WHERE t.status <> 'deleted'
ORDER BY t.name;
