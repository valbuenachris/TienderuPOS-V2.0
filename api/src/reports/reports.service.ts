import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

type ReportDayRow = {
  day: string;
  sales_count: number;
  total: string;
  grand_total: string;
  paid: string;
  due: string;
};

type TopProductRow = {
  product_id: number;
  code: string | null;
  name: string | null;
  quantity: string;
  subtotal: string;
};

@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

  async summary(tenantId: string, from: string, to: string): Promise<ReportDayRow[]> {
    this.assertRange(from, to);
    const result = await this.database.query<ReportDayRow>(
      `SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              COUNT(*)::integer AS sales_count,
              COALESCE(SUM(total), 0)::text AS total,
              COALESCE(SUM(grand_total), 0)::text AS grand_total,
              COALESCE(SUM(paid), 0)::text AS paid,
              COALESCE(SUM(grand_total - COALESCE(paid, 0)), 0)::text AS due
       FROM public.tec_sales
       WHERE tenant_id = $1
         AND created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
         AND created_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
       GROUP BY TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
       ORDER BY day`,
      [tenantId, from, to]
    );
    return result.rows;
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
         AND s.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
         AND s.created_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
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
