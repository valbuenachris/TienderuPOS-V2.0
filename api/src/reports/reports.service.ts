import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DatabaseService } from '../database/database.service';

type ReportDayRow = {
  day: string;
  sales_count: number;
  total: string;
  grand_total: string;
  paid: string;
  due: string;
};

type SalesTotalsRow = {
  sales_count: number;
  subtotal: string;
  grand_total: string;
  paid: string;
  due: string;
};

type MonthlyRow = {
  month: string;
  total: string;
};

type ReportMonthPoint = {
  month: string;
  sales: string;
  purchases: string;
  expenses: string;
};

type TotalRow = { total: string };

type TopProductRow = {
  product_id: number;
  code: string | null;
  name: string | null;
  quantity: string;
  subtotal: string;
};

export type CalendarGroup = 'day' | 'month';

type BucketAggRow = {
  bucket: string;
  count: number;
  total: string;
  pending?: string;
};

type CalendarPoint = {
  key: string;
  sales_total: string;
  sales_count: number;
  purchases_total: string;
  purchases_count: number;
  expenses_total: string;
  expenses_count: number;
  pending_total: string;
  net_profit: string;
};

const RANGE_START = `$2::date::timestamp AT TIME ZONE 'UTC'`;
const RANGE_END = `($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`;

function monthKeys(from: string, to: string): string[] {
  const keys: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    keys.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function bucketKeys(from: string, to: string, group: CalendarGroup): string[] {
  if (group === 'month') return monthKeys(from, to);
  const keys: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

  async summary(tenantId: string, from: string, to: string) {
    this.assertRange(from, to);

    const [
      daysResult,
      totalsResult,
      salesMonthly,
      purchasesMonthly,
      expensesMonthly,
      purchasesTotalResult,
      expensesTotalResult
    ] = await Promise.all([
      this.database.query<ReportDayRow>(
        `SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                COUNT(*)::integer AS sales_count,
                COALESCE(SUM(total), 0)::text AS total,
                COALESCE(SUM(grand_total), 0)::text AS grand_total,
                COALESCE(SUM(paid), 0)::text AS paid,
                COALESCE(SUM(grand_total - COALESCE(paid, 0)), 0)::text AS due
         FROM public.tec_sales
         WHERE tenant_id = $1
           AND created_at >= ${RANGE_START}
           AND created_at < ${RANGE_END}
         GROUP BY TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
         ORDER BY day`,
        [tenantId, from, to]
      ),
      this.database.query<SalesTotalsRow>(
        `SELECT COUNT(*)::integer AS sales_count,
                COALESCE(SUM(total), 0)::text AS subtotal,
                COALESCE(SUM(grand_total), 0)::text AS grand_total,
                COALESCE(SUM(paid), 0)::text AS paid,
                COALESCE(SUM(grand_total - COALESCE(paid, 0)), 0)::text AS due
         FROM public.tec_sales
         WHERE tenant_id = $1
           AND created_at >= ${RANGE_START}
           AND created_at < ${RANGE_END}`,
        [tenantId, from, to]
      ),
      this.database.query<MonthlyRow>(
        `SELECT TO_CHAR(date_trunc('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
                COALESCE(SUM(grand_total), 0)::text AS total
         FROM public.tec_sales
         WHERE tenant_id = $1
           AND created_at >= ${RANGE_START}
           AND created_at < ${RANGE_END}
         GROUP BY 1
         ORDER BY 1`,
        [tenantId, from, to]
      ),
      this.database.query<MonthlyRow>(
        `SELECT TO_CHAR(date_trunc('month', date), 'YYYY-MM') AS month,
                COALESCE(SUM(total), 0)::text AS total
         FROM public.tec_purchases
         WHERE tenant_id = $1
           AND date >= $2::date
           AND date < ${RANGE_END}
         GROUP BY 1
         ORDER BY 1`,
        [tenantId, from, to]
      ),
      this.database.query<MonthlyRow>(
        `SELECT TO_CHAR(date_trunc('month', date), 'YYYY-MM') AS month,
                COALESCE(SUM(amount), 0)::text AS total
         FROM public.tec_expenses
         WHERE tenant_id = $1
           AND date >= $2::date
           AND date < ${RANGE_END}
         GROUP BY 1
         ORDER BY 1`,
        [tenantId, from, to]
      ),
      this.database.query<TotalRow>(
        `SELECT COALESCE(SUM(total), 0)::text AS total
         FROM public.tec_purchases
         WHERE tenant_id = $1 AND date >= $2::date AND date < ${RANGE_END}`,
        [tenantId, from, to]
      ),
      this.database.query<TotalRow>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total
         FROM public.tec_expenses
         WHERE tenant_id = $1 AND date >= $2::date AND date < ${RANGE_END}`,
        [tenantId, from, to]
      )
    ]);

    const totals: SalesTotalsRow = totalsResult.rows[0] ?? {
      sales_count: 0,
      subtotal: '0.00',
      grand_total: '0.00',
      paid: '0.00',
      due: '0.00'
    };
    const purchasesTotal = purchasesTotalResult.rows[0]?.total ?? '0.00';
    const expensesTotal = expensesTotalResult.rows[0]?.total ?? '0.00';
    const netProfit = new Decimal(totals.grand_total)
      .minus(purchasesTotal)
      .minus(expensesTotal)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2);

    const monthMap = new Map<string, ReportMonthPoint>();
    for (const key of monthKeys(from, to)) {
      monthMap.set(key, { month: key, sales: '0.00', purchases: '0.00', expenses: '0.00' });
    }
    const merge = (rows: MonthlyRow[], field: 'sales' | 'purchases' | 'expenses') => {
      for (const row of rows) {
        const point = monthMap.get(row.month) ?? { month: row.month, sales: '0.00', purchases: '0.00', expenses: '0.00' };
        point[field] = row.total;
        monthMap.set(row.month, point);
      }
    };
    merge(salesMonthly.rows, 'sales');
    merge(purchasesMonthly.rows, 'purchases');
    merge(expensesMonthly.rows, 'expenses');

    return {
      from,
      to,
      days: daysResult.rows,
      totals,
      purchases_total: purchasesTotal,
      expenses_total: expensesTotal,
      net_profit: netProfit,
      monthly: [...monthMap.values()]
    };
  }

  async calendar(tenantId: string, from: string, to: string, group: CalendarGroup) {
    this.assertRange(from, to);
    const format = group === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
    const salesBucket = `TO_CHAR(created_at AT TIME ZONE 'UTC', '${format}')`;
    const dateBucket = `TO_CHAR(date, '${format}')`;

    const [sales, purchases, expenses] = await Promise.all([
      this.database.query<BucketAggRow>(
        `SELECT ${salesBucket} AS bucket,
                COUNT(*)::integer AS count,
                COALESCE(SUM(grand_total), 0)::text AS total,
                COALESCE(SUM(grand_total - COALESCE(paid, 0)), 0)::text AS pending
         FROM public.tec_sales
         WHERE tenant_id = $1
           AND created_at >= ${RANGE_START}
           AND created_at < ${RANGE_END}
         GROUP BY 1`,
        [tenantId, from, to]
      ),
      this.database.query<BucketAggRow>(
        `SELECT ${dateBucket} AS bucket,
                COUNT(*)::integer AS count,
                COALESCE(SUM(total), 0)::text AS total
         FROM public.tec_purchases
         WHERE tenant_id = $1
           AND date >= $2::date
           AND date < ${RANGE_END}
         GROUP BY 1`,
        [tenantId, from, to]
      ),
      this.database.query<BucketAggRow>(
        `SELECT ${dateBucket} AS bucket,
                COUNT(*)::integer AS count,
                COALESCE(SUM(amount), 0)::text AS total
         FROM public.tec_expenses
         WHERE tenant_id = $1
           AND date >= $2::date
           AND date < ${RANGE_END}
         GROUP BY 1`,
        [tenantId, from, to]
      )
    ]);

    const points = new Map<string, CalendarPoint>();
    for (const key of bucketKeys(from, to, group)) {
      points.set(key, {
        key,
        sales_total: '0.00',
        sales_count: 0,
        purchases_total: '0.00',
        purchases_count: 0,
        expenses_total: '0.00',
        expenses_count: 0,
        pending_total: '0.00',
        net_profit: '0.00'
      });
    }

    for (const row of sales.rows) {
      const point = points.get(row.bucket);
      if (!point) continue;
      point.sales_total = row.total;
      point.sales_count = row.count;
      point.pending_total = row.pending ?? '0.00';
    }
    for (const row of purchases.rows) {
      const point = points.get(row.bucket);
      if (!point) continue;
      point.purchases_total = row.total;
      point.purchases_count = row.count;
    }
    for (const row of expenses.rows) {
      const point = points.get(row.bucket);
      if (!point) continue;
      point.expenses_total = row.total;
      point.expenses_count = row.count;
    }

    const totals = {
      sales_total: new Decimal(0),
      sales_count: 0,
      purchases_total: new Decimal(0),
      purchases_count: 0,
      expenses_total: new Decimal(0),
      expenses_count: 0,
      pending_total: new Decimal(0),
      net_profit: new Decimal(0)
    };
    for (const point of points.values()) {
      point.net_profit = new Decimal(point.sales_total)
        .minus(point.purchases_total)
        .minus(point.expenses_total)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toFixed(2);
      totals.sales_total = totals.sales_total.plus(point.sales_total);
      totals.sales_count += point.sales_count;
      totals.purchases_total = totals.purchases_total.plus(point.purchases_total);
      totals.purchases_count += point.purchases_count;
      totals.expenses_total = totals.expenses_total.plus(point.expenses_total);
      totals.expenses_count += point.expenses_count;
      totals.pending_total = totals.pending_total.plus(point.pending_total);
      totals.net_profit = totals.net_profit.plus(point.net_profit);
    }

    return {
      from,
      to,
      group,
      points: [...points.values()],
      totals: {
        sales_total: totals.sales_total.toFixed(2),
        sales_count: totals.sales_count,
        purchases_total: totals.purchases_total.toFixed(2),
        purchases_count: totals.purchases_count,
        expenses_total: totals.expenses_total.toFixed(2),
        expenses_count: totals.expenses_count,
        pending_total: totals.pending_total.toFixed(2),
        net_profit: totals.net_profit.toFixed(2)
      }
    };
  }

  async topProducts(tenantId: string, from: string, to: string, limit: number): Promise<TopProductRow[]> {
    this.assertRange(from, to);
    const result = await this.database.query<TopProductRow>(
      `SELECT si.product_id,
              p.code,
              p.name,
              COALESCE(SUM(si.quantity), 0)::text AS quantity,
              COALESCE(SUM(si.subtotal), 0)::text AS subtotal
       FROM public.tec_sale_items si
       JOIN public.tec_sales s
         ON s.id = si.sale_id AND s.tenant_id = $1
       LEFT JOIN public.tec_products p
         ON p.id = si.product_id AND p.tenant_id = $1
       WHERE si.tenant_id = $1
         AND s.created_at >= ${RANGE_START}
         AND s.created_at < ${RANGE_END}
       GROUP BY si.product_id, p.code, p.name
       ORDER BY SUM(si.quantity) DESC
       LIMIT $4`,
      [tenantId, from, to, limit]
    );
    return result.rows;
  }

  private assertRange(from: string, to: string): void {
    if (from > to) throw new BadRequestException('from must be on or before to');
  }
}
