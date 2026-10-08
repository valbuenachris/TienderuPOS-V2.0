import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BUSINESS_TIMEZONE, todayInBusinessTimezone } from '../common/timezone';

type CountRow = { count: number };
type TenantCountRow = { total: number; active: number };
type GlobalSalesRow = {
  sales_count: number;
  subtotal: string;
  grand_total: string;
  paid: string;
};
type GlobalPaymentsRow = {
  cash: string;
  card: string;
  transfer: string;
  sistecredito: string;
  adi: string;
  credit: string;
  paid_total: string;
  payments_count: number;
  card_count: number;
};
type TopTenantRow = {
  id: string;
  name: string;
  sales_count: number;
  total: string;
};

@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  async global() {
    const day = todayInBusinessTimezone();
    const rangeValues = [day, BUSINESS_TIMEZONE];

    const [tenants, users, stores, sales, payments, topTenants] = await Promise.all([
      this.database.query<TenantCountRow>(
        `SELECT COUNT(*) FILTER (WHERE status <> 'deleted')::integer AS total,
                COUNT(*) FILTER (WHERE status = 'active')::integer AS active
         FROM public.tec_tenants`
      ),
      this.database.query<CountRow>(
        `SELECT COUNT(*)::integer AS count
         FROM public.tec_users u
         WHERE u.active = 1
           AND NOT EXISTS (
             SELECT 1 FROM public.tec_tenants t
             WHERE t.id = u.tenant_id AND t.status = 'deleted'
           )`
      ),
      this.database.query<CountRow>(
        `SELECT COUNT(*)::integer AS count
         FROM public.tec_stores s
         WHERE NOT EXISTS (
           SELECT 1 FROM public.tec_tenants t
           WHERE t.id = s.tenant_id AND t.status = 'deleted'
         )`
      ),
      this.database.query<GlobalSalesRow>(
        `SELECT COUNT(*)::integer AS sales_count,
                COALESCE(SUM(total), 0)::text AS subtotal,
                COALESCE(SUM(grand_total), 0)::text AS grand_total,
                COALESCE(SUM(paid), 0)::text AS paid
         FROM public.tec_sales
         WHERE created_at >= ($1::date::timestamp AT TIME ZONE $2)
           AND created_at < (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE $2)`,
        rangeValues
      ),
      this.database.query<GlobalPaymentsRow>(
        `SELECT COALESCE(SUM(CASE WHEN pay.paid_by = 'cash' THEN pay.amount END), 0)::text AS cash,
                COALESCE(SUM(CASE WHEN pay.paid_by = 'CC' THEN pay.amount END), 0)::text AS card,
                COALESCE(SUM(CASE WHEN pay.paid_by = 'Transferencia' THEN pay.amount END), 0)::text AS transfer,
                COALESCE(SUM(CASE WHEN LOWER(pay.paid_by) IN ('sistecredito', 'sistecrédito') THEN pay.amount END), 0)::text AS sistecredito,
                COALESCE(SUM(CASE WHEN LOWER(pay.paid_by) = 'adi' THEN pay.amount END), 0)::text AS adi,
                COALESCE(SUM(CASE WHEN LOWER(pay.paid_by) IN ('credito', 'crédito') THEN pay.amount END), 0)::text AS credit,
                COALESCE(SUM(pay.amount), 0)::text AS paid_total,
                COUNT(*)::integer AS payments_count,
                COALESCE(SUM(CASE WHEN pay.paid_by = 'CC' THEN 1 ELSE 0 END), 0)::integer AS card_count
         FROM public.tec_payments pay
         JOIN public.tec_sales s ON s.id = pay.sale_id AND s.tenant_id = pay.tenant_id
         WHERE pay.created_at >= ($1::date::timestamp AT TIME ZONE $2)
           AND pay.created_at < (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE $2)`,
        rangeValues
      ),
      this.database.query<TopTenantRow>(
        `SELECT t.id::text AS id, t.name,
                COUNT(s.id)::integer AS sales_count,
                COALESCE(SUM(s.grand_total), 0)::text AS total
         FROM public.tec_tenants t
         LEFT JOIN public.tec_sales s
           ON s.tenant_id = t.id
          AND s.created_at >= ($1::date::timestamp AT TIME ZONE $2)
          AND s.created_at < (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE $2)
         WHERE t.status <> 'deleted'
         GROUP BY t.id, t.name
         HAVING COUNT(s.id) > 0
         ORDER BY SUM(s.grand_total) DESC NULLS LAST
         LIMIT 5`,
        rangeValues
      )
    ]);

    return {
      date: day,
      tenants: tenants.rows[0] ?? { total: 0, active: 0 },
      users: users.rows[0]?.count ?? 0,
      stores: stores.rows[0]?.count ?? 0,
      sales: sales.rows[0] ?? { sales_count: 0, subtotal: '0.00', grand_total: '0.00', paid: '0.00' },
      payments: payments.rows[0] ?? {
        cash: '0.00',
        card: '0.00',
        transfer: '0.00',
        sistecredito: '0.00',
        adi: '0.00',
        credit: '0.00',
        paid_total: '0.00',
        payments_count: 0,
        card_count: 0
      },
      top_tenants: topTenants.rows
    };
  }
}
