-- POS v2 · v0.3.60 · Backfill de puntos de clientes (DML, ejecución única)
-- Recalcula tec_customers.points_balance a partir del historial de ventas.
--
-- ⚠️ EJECUTAR UNA SOLA VEZ, manualmente, DESPUÉS de:
--    1) aplicar docs/migrations/v0.3.60-remove-points-trigger.sql, y
--    2) desplegar la API v0.3.60 (SalesService acredita las ventas nuevas).
-- ⚠️ Reinicia TODOS los saldos a 0 y los recalcula: cualquier ajuste manual previo se pierde.
-- ⚠️ Ejecutar en ventana de mantenimiento: el UPDATE bloquea la tabla de clientes.
-- Solo toca points_balance; point_transactions no tiene customer_id/sale_id/tenant_id.

BEGIN;

-- 1. Reiniciar todos los saldos
UPDATE public.tec_customers SET points_balance = 0;

-- 2. Recalcular desde ventas pagadas/parciales con puntos
UPDATE public.tec_customers c
SET points_balance = COALESCE((
    SELECT SUM(COALESCE(s.total_reward_points, 0))
    FROM public.tec_sales s
    WHERE s.customer_id = c.id
      AND s.status IN ('paid', 'partial')
      AND s.total_reward_points > 0
), 0);

COMMIT;

-- Verificación: top 10 clientes por puntos
SELECT id, name, email, phone, points_balance
FROM public.tec_customers
WHERE points_balance > 0
ORDER BY points_balance DESC
LIMIT 10;
