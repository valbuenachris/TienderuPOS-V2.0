import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TableRow } from '../database/database.types';
import { CreateExpenseDto, UpdateExpenseDto } from './expense.dto';

type ExpenseRow = Omit<Pick<TableRow<'tec_expenses'>, 'id' | 'tenant_id' | 'date' | 'reference' | 'note' | 'created_by'>, 'amount'> & {
  amount: string | null;
};

@Injectable()
export class ExpensesService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, from?: string, to?: string, limit = 100, offset = 0): Promise<ExpenseRow[]> {
    if ((from && !to) || (!from && to)) {
      throw new BadRequestException('from and to must be supplied together');
    }
    if (from && to && from > to) throw new BadRequestException('from must be on or before to');

    const values: unknown[] = [tenantId];
    let dateFilter = '';
    if (from && to) {
      values.push(from, to);
      dateFilter = ` AND date >= $2::date AND date < ($3::date + INTERVAL '1 day')`;
    }
    values.push(limit, offset);
    const result = await this.database.query<ExpenseRow>(
      `SELECT id, tenant_id, date, reference, amount::text AS amount, note, created_by
       FROM public.tec_expenses
       WHERE tenant_id = $1 ${dateFilter}
       ORDER BY date DESC, id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return result.rows;
  }

  async create(tenantId: string, userId: number, input: CreateExpenseDto): Promise<ExpenseRow> {
    const result = await this.database.query<ExpenseRow>(
      `INSERT INTO public.tec_expenses (tenant_id, date, reference, amount, note, created_by)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6)
       RETURNING id, tenant_id, date, reference, amount::text AS amount, note, created_by`,
      [tenantId, input.date ?? null, input.reference.trim(), input.amount, input.note ?? null, userId]
    );
    return result.rows[0];
  }

  async update(tenantId: string, expenseId: number, input: UpdateExpenseDto): Promise<ExpenseRow> {
    const result = await this.database.query<ExpenseRow>(
      `UPDATE public.tec_expenses
       SET reference = COALESCE($3, reference),
           amount = COALESCE($4::numeric, amount),
           date = COALESCE($5::date, date),
           note = COALESCE($6, note)
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, tenant_id, date, reference, amount::text AS amount, note, created_by`,
      [
        tenantId,
        expenseId,
        input.reference?.trim() ?? null,
        input.amount ?? null,
        input.date ?? null,
        input.note ?? null
      ]
    );
    const updated = result.rows[0];
    if (!updated) throw new NotFoundException('Expense not found in this tenant');
    return updated;
  }
}
