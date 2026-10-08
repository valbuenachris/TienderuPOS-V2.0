import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { BUSINESS_TIMEZONE, todayInBusinessTimezone } from '../common/timezone';
import { DatabaseService } from '../database/database.service';

type TenantCountRow = { total: number; active: number };
type PlanCountRow = { plan_id: string | null; plan_name: string | null; count: number };
type SalesTodayRow = { count: number; revenue: string };
type MonthlyRevenueRow = { revenue: string; payments_count: number };
type MrrRow = { mrr: string };
type MonthCountRow = { count: number };
type RecentSaleRow = {
  tenant_id: string;
  tenant_name: string;
  plan_name: string | null;
  amount: string;
  date: string | null;
  subscription_status: string | null;
};
type PaymentsStatusRow = {
  pending_count: number;
  pending_amount: string;
  overdue_count: number;
  overdue_amount: string;
};
type TrialsRow = { active: number; expiring_soon: number; converted: number };

function isUndefinedTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && String((error as { code?: unknown }).code) === '42P01';
}

@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  async global() {
    const day = todayInBusinessTimezone();
    const values = [day, BUSINESS_TIMEZONE];

    try {
      const [
        tenants,
        plans,
        salesToday,
        monthlyRevenue,
        mrr,
        newSubscriptions,
        planChanges,
        cancellations,
        recentSales,
        paymentsStatus,
        trials
      ] = await Promise.all([
        this.database.query<TenantCountRow>(
          `SELECT COUNT(*) FILTER (WHERE status <> 'deleted')::integer AS total,
                  COUNT(*) FILTER (WHERE status = 'active')::integer AS active
           FROM public.tec_tenants`
        ),
        this.database.query<PlanCountRow>(
          `SELECT p.id::text AS plan_id, p.name AS plan_name, COUNT(*)::integer AS count
           FROM public.tec_tenant_subscriptions s
           JOIN public.tec_tenants t
             ON t.id = s.tenant_id AND (t.status IS NULL OR t.status <> 'deleted')
           LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id
           WHERE s.status = 'active'
           GROUP BY p.id, p.name
           ORDER BY p.name`
        ),
        this.database.query<SalesTodayRow>(
          `SELECT COUNT(*)::integer AS count, COALESCE(SUM(amount), 0)::text AS revenue
           FROM public.tec_tenant_payments
           WHERE status = 'completed' AND payment_date = $1::date`,
          [day]
        ),
        this.database.query<MonthlyRevenueRow>(
          `SELECT COALESCE(SUM(amount), 0)::text AS revenue, COUNT(*)::integer AS payments_count
           FROM public.tec_tenant_payments
           WHERE status = 'completed'
             AND payment_date >= date_trunc('month', $1::date)::date
             AND payment_date <= $1::date`,
          [day]
        ),
        this.database.query<MrrRow>(
          `SELECT ROUND(COALESCE(SUM(
                    CASE WHEN s.billing_cycle = 'yearly'
                      THEN COALESCE(p.price_yearly, 0) / 12
                      ELSE COALESCE(p.price_monthly, p.price_yearly, 0)
                    END), 0), 2)::text AS mrr
           FROM public.tec_tenant_subscriptions s
           JOIN public.tec_tenants t
             ON t.id = s.tenant_id AND (t.status IS NULL OR t.status <> 'deleted')
           LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id
           WHERE s.status = 'active'`
        ),
        this.database.query<MonthCountRow>(
          `SELECT COUNT(*)::integer AS count
           FROM public.tec_tenant_subscriptions s
           JOIN public.tec_tenants t
             ON t.id = s.tenant_id AND (t.status IS NULL OR t.status <> 'deleted')
           WHERE s.created_at >= (date_trunc('month', $1::date)::timestamp AT TIME ZONE $2)`,
          values
        ),
        this.database.query<MonthCountRow>(
          `SELECT COUNT(*)::integer AS count
           FROM public.tec_tenant_activity_logs
           WHERE action = 'plan_changed'
             AND performed_at >= (date_trunc('month', $1::date)::timestamp AT TIME ZONE $2)`,
          values
        ),
        this.database.query<MonthCountRow>(
          `SELECT COUNT(*)::integer AS count
           FROM public.tec_tenant_subscriptions s
           JOIN public.tec_tenants t
             ON t.id = s.tenant_id AND (t.status IS NULL OR t.status <> 'deleted')
           WHERE s.status = 'cancelled'
             AND s.cancelled_at >= (date_trunc('month', $1::date)::timestamp AT TIME ZONE $2)`,
          values
        ),
        this.database.query<RecentSaleRow>(
          `SELECT t.id::text AS tenant_id, t.name AS tenant_name, p.name AS plan_name,
                  pay.amount, pay.payment_date::text AS date, s.status AS subscription_status
           FROM public.tec_tenant_payments pay
           JOIN public.tec_tenants t ON t.id = pay.tenant_id
           LEFT JOIN public.tec_tenant_subscriptions s ON s.id = pay.subscription_id
           LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id
           WHERE pay.status = 'completed'
           ORDER BY pay.payment_date DESC NULLS LAST, pay.created_at DESC NULLS LAST
           LIMIT 8`
        ),
        this.database.query<PaymentsStatusRow>(
          `SELECT
             (SELECT COUNT(*) FROM public.tec_tenant_payments WHERE status = 'pending')::integer AS pending_count,
             (SELECT COALESCE(SUM(amount), 0) FROM public.tec_tenant_payments WHERE status = 'pending')::text AS pending_amount,
             (SELECT COUNT(*)
                FROM public.tec_tenant_subscriptions s
                JOIN public.tec_tenants t
                  ON t.id = s.tenant_id AND (t.status IS NULL OR t.status <> 'deleted')
               WHERE s.status IN ('active', 'suspended', 'expired')
                 AND COALESCE(s.next_billing_date, s.subscription_end_date) < $1::date)::integer AS overdue_count,
             (SELECT COALESCE(SUM(CASE WHEN s.billing_cycle = 'yearly'
                        THEN COALESCE(p.price_yearly, 0)
                        ELSE COALESCE(p.price_monthly, 0) END), 0)
                FROM public.tec_tenant_subscriptions s
                JOIN public.tec_tenants t
                  ON t.id = s.tenant_id AND (t.status IS NULL OR t.status <> 'deleted')
                LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id
               WHERE s.status IN ('active', 'suspended', 'expired')
                 AND COALESCE(s.next_billing_date, s.subscription_end_date) < $1::date)::text AS overdue_amount`,
          [day]
        ),
        this.database.query<TrialsRow>(
          `SELECT
             COUNT(*) FILTER (WHERE s.status = 'trial')::integer AS active,
             COUNT(*) FILTER (WHERE s.status = 'trial'
               AND s.trial_end_date BETWEEN $1::date AND ($1::date + INTERVAL '7 days')::date)::integer AS expiring_soon,
             COUNT(*) FILTER (WHERE s.subscription_start_date >= date_trunc('month', $1::date)::date)::integer AS converted
           FROM public.tec_tenant_subscriptions s
           JOIN public.tec_tenants t
             ON t.id = s.tenant_id AND (t.status IS NULL OR t.status <> 'deleted')`,
          [day]
        )
      ]);

      const byPlan = plans.rows;
      const activeTotal = byPlan.reduce((sum, row) => sum + row.count, 0);

      return {
        date: day,
        tenants: tenants.rows[0] ?? { total: 0, active: 0 },
        active_subscriptions: { total: activeTotal, by_plan: byPlan },
        plan_sales_today: salesToday.rows[0] ?? { count: 0, revenue: '0.00' },
        monthly_revenue: {
          total: monthlyRevenue.rows[0]?.revenue ?? '0.00',
          payments_count: monthlyRevenue.rows[0]?.payments_count ?? 0,
          new_subscriptions: newSubscriptions.rows[0]?.count ?? 0,
          plan_changes: planChanges.rows[0]?.count ?? 0,
          cancellations: cancellations.rows[0]?.count ?? 0
        },
        mrr: mrr.rows[0]?.mrr ?? '0.00',
        recent_sales: recentSales.rows,
        payments_status: paymentsStatus.rows[0] ?? {
          pending_count: 0,
          pending_amount: '0.00',
          overdue_count: 0,
          overdue_amount: '0.00'
        },
        trials: trials.rows[0] ?? { active: 0, expiring_soon: 0, converted: 0 }
      };
    } catch (error: unknown) {
      if (isUndefinedTable(error)) {
        throw new ServiceUnavailableException(
          'Las tablas de suscripciones no existen; ejecuta docs/migrations/v0.3.11-tenant-management.sql.'
        );
      }
      throw error;
    }
  }
}