import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PosUser } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import { isAdminRole } from '../common/roles';
import { BUSINESS_TIMEZONE, todayInBusinessTimezone } from '../common/timezone';
import { CloseRegisterDto, OpenRegisterDto } from './register.dto';

type RegisterRow = {
  id: number;
  date: string | null;
  user_id: number | null;
  cash_in_hand: string | null;
  status: string | null;
  total_cash: string | null;
  total_cash_submitted: string | null;
  note: string | null;
  closed_at: string | null;
  closed_by: number | null;
  store_id: number | null;
};

type PaymentSummaryRow = {
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

type SalesSummaryRow = {
  sales_count: number;
  subtotal: string;
  grand_total: string;
  paid: string;
};

type StoreIdRow = { id: number };
type RegisterScopeRow = Pick<RegisterRow, 'id' | 'date' | 'status' | 'store_id' | 'user_id'>;

const REGISTER_FIELDS = `id, date, user_id, cash_in_hand::text AS cash_in_hand, status,
  total_cash::text AS total_cash, total_cash_submitted::text AS total_cash_submitted,
  note, closed_at, closed_by, store_id`;

@Injectable()
export class RegistersService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, user: PosUser, limit = 20): Promise<RegisterRow[]> {
    const isAdmin = isAdminRole(user.group_name);
    const values: unknown[] = [tenantId];
    let scopeFilter = '';
    if (!isAdmin) {
      values.push(user.id);
      scopeFilter = ` AND user_id = $${values.length}`;
    }
    values.push(limit);
    const result = await this.database.query<RegisterRow>(
      `SELECT ${REGISTER_FIELDS}
       FROM public.tec_registers
       WHERE tenant_id = $1 ${scopeFilter}
       ORDER BY date DESC, id DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows;
  }

  async current(tenantId: string, user: PosUser, requestedStoreId?: number): Promise<RegisterRow | null> {
    if (!isAdminRole(user.group_name)) {
      const result = await this.database.query<RegisterRow>(
        `SELECT ${REGISTER_FIELDS}
         FROM public.tec_registers
         WHERE tenant_id = $1 AND user_id = $2 AND status = 'open'
         ORDER BY date DESC, id DESC
         LIMIT 1`,
        [tenantId, user.id]
      );
      return result.rows[0] ?? null;
    }
    const storeId = await this.resolveStore(tenantId, user, requestedStoreId);
    const result = await this.database.query<RegisterRow>(
      `SELECT ${REGISTER_FIELDS}
       FROM public.tec_registers
       WHERE tenant_id = $1 AND store_id = $2 AND status = 'open'
       ORDER BY date DESC, id DESC
       LIMIT 1`,
      [tenantId, storeId]
    );
    return result.rows[0] ?? null;
  }

  async summary(tenantId: string, user: PosUser, date: string | undefined, requestedStoreId?: number) {
    const isAdmin = isAdminRole(user.group_name);
    const day = date ?? todayInBusinessTimezone();
    const storeId = isAdmin ? await this.resolveStore(tenantId, user, requestedStoreId) : (user.store_id ?? null);
    const scopeFilter = isAdmin ? 's.store_id = $2' : 's.created_by = $2';
    const scopeValue: unknown = isAdmin ? storeId : user.id;

    const payments = await this.database.query<PaymentSummaryRow>(
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
       WHERE pay.tenant_id = $1 AND ${scopeFilter}
         AND pay.created_at >= ($3::date::timestamp AT TIME ZONE $4)
         AND pay.created_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE $4)`,
      [tenantId, scopeValue, day, BUSINESS_TIMEZONE]
    );

    const sales = await this.database.query<SalesSummaryRow>(
      `SELECT COUNT(*)::integer AS sales_count,
              COALESCE(SUM(total), 0)::text AS subtotal,
              COALESCE(SUM(grand_total), 0)::text AS grand_total,
              COALESCE(SUM(paid), 0)::text AS paid
       FROM public.tec_sales
       WHERE tenant_id = $1 AND ${isAdmin ? 'store_id' : 'created_by'} = $2
         AND created_at >= ($3::date::timestamp AT TIME ZONE $4)
         AND created_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE $4)`,
      [tenantId, scopeValue, day, BUSINESS_TIMEZONE]
    );

    return {
      store_id: storeId,
      date: day,
      payments: payments.rows[0] ?? { cash: '0.00', card: '0.00', transfer: '0.00', sistecredito: '0.00', adi: '0.00', credit: '0.00', paid_total: '0.00', payments_count: 0, card_count: 0 },
      sales: sales.rows[0] ?? { sales_count: 0, subtotal: '0.00', grand_total: '0.00', paid: '0.00' }
    };
  }

  async open(tenantId: string, user: PosUser, input: OpenRegisterDto) {
    if (!isAdminRole(user.group_name)) {
      const existing = await this.database.query<RegisterScopeRow>(
        `SELECT id, date, status, store_id, user_id FROM public.tec_registers
         WHERE tenant_id = $1 AND user_id = $2 AND status = 'open'
         LIMIT 1`,
        [tenantId, user.id]
      );
      if (existing.rowCount === 1) throw new BadRequestException('You already have an open register');

      const result = await this.database.query<RegisterRow>(
        `INSERT INTO public.tec_registers
           (tenant_id, date, user_id, cash_in_hand, status, total_cash, total_cheques, total_cc_slips,
            total_cash_submitted, total_cheques_submitted, total_cc_slips_submitted, store_id)
         VALUES ($1, CURRENT_TIMESTAMP, $2, $3, 'open', 0, 0, 0, 0, 0, 0, $4)
         RETURNING ${REGISTER_FIELDS}`,
        [tenantId, user.id, input.cash_in_hand, user.store_id ?? null]
      );
      return result.rows[0];
    }

    const storeId = await this.resolveStore(tenantId, user, input.store_id);

    const existing = await this.database.query<RegisterScopeRow>(
      `SELECT id, date, status, store_id, user_id FROM public.tec_registers
       WHERE tenant_id = $1 AND store_id = $2 AND status = 'open'
       LIMIT 1`,
      [tenantId, storeId]
    );
    if (existing.rowCount === 1) throw new BadRequestException('There is already an open register for this store');

    const result = await this.database.query<RegisterRow>(
      `INSERT INTO public.tec_registers
         (tenant_id, date, user_id, cash_in_hand, status, total_cash, total_cheques, total_cc_slips,
          total_cash_submitted, total_cheques_submitted, total_cc_slips_submitted, store_id)
       VALUES ($1, CURRENT_TIMESTAMP, $2, $3, 'open', 0, 0, 0, 0, 0, 0, $4)
       RETURNING ${REGISTER_FIELDS}`,
      [tenantId, user.id, input.cash_in_hand, storeId]
    );
    return result.rows[0];
  }

  async close(tenantId: string, user: PosUser, registerId: number, input: CloseRegisterDto) {
    const isAdmin = isAdminRole(user.group_name);
    const result = await this.database.transaction(async (client) => {
      const registerResult = await client.query<RegisterScopeRow>(
        `SELECT id, date, status, store_id, user_id FROM public.tec_registers
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1
         FOR UPDATE`,
        [tenantId, registerId]
      );
      const register = registerResult.rows[0];
      if (!register) throw new NotFoundException('Register not found in this tenant');
      if (!isAdmin) {
        const ownsByUser = register.user_id !== null && register.user_id === user.id;
        const ownsByStore = register.user_id === null && register.store_id !== null && register.store_id === user.store_id;
        if (!ownsByUser && !ownsByStore) {
          throw new ForbiddenException('This POS user cannot close another register');
        }
      }
      if (register.status !== 'open') throw new BadRequestException('Register is not open');

      const scopeValues: unknown[] = [tenantId, register.date];
      let scopeFilter = '';
      if (register.user_id !== null) {
        scopeValues.push(register.user_id);
        scopeFilter = ` AND s.created_by = $${scopeValues.length}`;
      } else if (register.store_id !== null) {
        scopeValues.push(register.store_id);
        scopeFilter = ` AND s.store_id = $${scopeValues.length}`;
      }

      const payments = await client.query<PaymentSummaryRow>(
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
         WHERE pay.tenant_id = $1 AND pay.created_at >= $2 ${scopeFilter}`,
        scopeValues
      );
      const totals = payments.rows[0] ?? { cash: '0.00', card: '0.00', transfer: '0.00', sistecredito: '0.00', adi: '0.00', credit: '0.00', paid_total: '0.00', payments_count: 0, card_count: 0 };
      const submitted = input.total_cash_submitted ?? totals.cash;

      const updated = await client.query<RegisterRow>(
        `UPDATE public.tec_registers
         SET status = 'closed',
             total_cash = $3::numeric,
             total_cheques = 0,
             total_cc_slips = $4,
             total_cash_submitted = $5::numeric,
             total_cheques_submitted = 0,
             total_cc_slips_submitted = $4,
             note = COALESCE($6, note),
             closed_at = CURRENT_TIMESTAMP,
             closed_by = $7
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${REGISTER_FIELDS}`,
        [tenantId, registerId, totals.cash, totals.card_count, submitted, input.note ?? null, user.id]
      );
      return { register: updated.rows[0], totals };
    });

    return result;
  }

  private async resolveStore(tenantId: string, user: PosUser, requestedStoreId?: number): Promise<number> {
    const isAdmin = isAdminRole(user.group_name);
    if (!isAdmin) {
      if (requestedStoreId !== undefined && requestedStoreId !== user.store_id) {
        throw new ForbiddenException('This POS user cannot operate another store');
      }
      if (!user.store_id) throw new BadRequestException('Assign this POS user to a store');
      return user.store_id;
    }
    const storeId = requestedStoreId ?? user.store_id;
    if (!storeId) throw new BadRequestException('Select a store');

    const store = await this.database.query<StoreIdRow>(
      'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, storeId]
    );
    if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');
    return storeId;
  }
}
