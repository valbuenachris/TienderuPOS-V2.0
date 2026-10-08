import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException
} from '@nestjs/common';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { todayInBusinessTimezone } from '../common/timezone';
import { DatabaseService, SqlExecutor } from '../database/database.service';
import {
  CreatePlanDto,
  ExtendTrialDto,
  RecordPaymentDto,
  SuspendTenantDto,
  UpdatePlanDto,
  UpdateSubscriptionDto
} from './tenant-management.dto';

export interface PlanRecord {
  id: string;
  name: string;
  description: string | null;
  price_monthly: string | null;
  price_yearly: string | null;
  max_users: number | null;
  max_stores: number | null;
  features: string[];
  is_active: boolean;
  created_at: string | null;
  tenants_count: number;
}

export interface TenantManagementRow {
  id: string;
  name: string;
  host: string | null;
  tenant_status: string;
  created_at: string | null;
  users_count: number;
  stores_count: number;
  admin_email: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  trial_start_date: string | null;
  trial_end_date: string | null;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
  billing_cycle: string | null;
  last_payment_date: string | null;
  last_payment_amount: string | null;
  next_billing_date: string | null;
  auto_renew: boolean | null;
  plan_id: string | null;
  plan_name: string | null;
  price_monthly: string | null;
  price_yearly: string | null;
  max_users: number | null;
  max_stores: number | null;
}

export interface TenantPaymentRow {
  id: string;
  subscription_id: string;
  tenant_id: string;
  tenant_name?: string | null;
  plan_name?: string | null;
  amount: string;
  payment_date: string | null;
  payment_method: string | null;
  status: string | null;
  invoice_url: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface TenantActivityRow {
  id: string;
  tenant_id: string;
  action: string;
  details: unknown;
  performed_by: number | null;
  performed_at: string | null;
}

export interface PaymentFilters {
  tenantId?: string;
  status?: string;
  method?: string;
  from?: string;
  to?: string;
  minAmount?: string;
  maxAmount?: string;
}

export interface PlanLimits {
  plan_name: string | null;
  max_users: number | null;
  max_stores: number | null;
}

type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  price_monthly: string | null;
  price_yearly: string | null;
  max_users: number | null;
  max_stores: number | null;
  features: unknown;
  is_active: boolean;
  created_at: string | null;
  tenants_count?: number;
};

type SubscriptionIdRow = { id: string; billing_cycle: string | null };
type SubscriptionPatchRow = { id: string; plan_id: string | null; plan_name: string | null; billing_cycle: string | null };
type TenantBasicRow = { id: string; name: string; status: string };
type CountRow = { count: number };
type PaymentSummaryRow = {
  revenue_this_month: string;
  pending_total: string;
  failed_total: string;
  refunded_total: string;
  completed_this_month: number;
};

const TABLES = [
  'tec_subscription_plans',
  'tec_tenant_subscriptions',
  'tec_tenant_payments',
  'tec_tenant_activity_logs'
];

const TENANT_SELECT = `
  SELECT t.id::text AS id,
         t.name,
         t.host,
         t.status AS tenant_status,
         t.created_at,
         (SELECT COUNT(*) FROM public.tec_users u WHERE u.tenant_id = t.id AND u.active = 1)::integer AS users_count,
         (SELECT COUNT(*) FROM public.tec_stores st WHERE st.tenant_id = t.id)::integer AS stores_count,
         (SELECT u.email
            FROM public.tec_users u
            LEFT JOIN public.tec_groups g
              ON g.id = u.group_id AND (g.tenant_id = u.tenant_id OR g.tenant_id IS NULL)
           WHERE u.tenant_id = t.id AND u.active = 1 AND lower(COALESCE(g.name, '')) IN ('admin', 'super_admin')
           ORDER BY u.id
           LIMIT 1) AS admin_email,
         s.id::text AS subscription_id,
         s.status AS subscription_status,
         s.trial_start_date::text AS trial_start_date,
         s.trial_end_date::text AS trial_end_date,
         s.subscription_start_date::text AS subscription_start_date,
         s.subscription_end_date::text AS subscription_end_date,
         s.billing_cycle,
         s.last_payment_date::text AS last_payment_date,
         s.last_payment_amount,
         s.next_billing_date::text AS next_billing_date,
         s.auto_renew,
         p.id::text AS plan_id,
         p.name AS plan_name,
         p.price_monthly,
         p.price_yearly,
         p.max_users,
         p.max_stores
  FROM public.tec_tenants t
  LEFT JOIN LATERAL (
    SELECT sub.*
    FROM public.tec_tenant_subscriptions sub
    WHERE sub.tenant_id = t.id
    ORDER BY sub.created_at DESC NULLS LAST, sub.id DESC
    LIMIT 1
  ) s ON true
  LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id`;

const PAYMENT_FIELDS = `
  pay.id::text AS id,
  pay.subscription_id::text AS subscription_id,
  pay.tenant_id::text AS tenant_id,
  t.name AS tenant_name,
  p.name AS plan_name,
  pay.amount,
  pay.payment_date::text AS payment_date,
  pay.payment_method,
  pay.status,
  pay.invoice_url,
  pay.notes,
  pay.created_at`;

function mapPlan(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price_monthly: row.price_monthly,
    price_yearly: row.price_yearly,
    max_users: row.max_users,
    max_stores: row.max_stores,
    features: Array.isArray(row.features)
      ? row.features.filter((feature): feature is string => typeof feature === 'string')
      : [],
    is_active: row.is_active,
    created_at: row.created_at,
    tenants_count: row.tenants_count ?? 0
  };
}

@Injectable()
export class TenantManagementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantManagementService.name);
  private ready = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    try {
      const result = await this.database.query<CountRow>(
        `SELECT COUNT(*)::integer AS count
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [TABLES]
      );
      this.ready = (result.rows[0]?.count ?? 0) === TABLES.length;
    } catch (_error: unknown) {
      this.ready = false;
    }
    if (!this.ready) {
      this.logger.warn(
        'Tenant management tables are missing; run docs/migrations/v0.3.11-tenant-management.sql and restart the API. Subscription endpoints return 503 until then.'
      );
      return;
    }
    await this.refreshLifecycleStatuses();
    this.timer = setInterval(() => { void this.refreshLifecycleStatuses(); }, 6 * 60 * 60 * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  isReady(): boolean {
    return this.ready;
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new ServiceUnavailableException(
        'La gestión de tenants no está disponible: falta ejecutar la migración v0.3.11 y reiniciar la API.'
      );
    }
  }

  async refreshLifecycleStatuses(): Promise<{ trials: number; subscriptions: number }> {
    if (!this.ready) return { trials: 0, subscriptions: 0 };
    try {
      const trials = await this.database.query(
        `UPDATE public.tec_tenant_subscriptions
         SET status = 'expired', updated_at = now()
         WHERE status = 'trial'
           AND trial_end_date IS NOT NULL
           AND trial_end_date < CURRENT_DATE
           AND subscription_start_date IS NULL`
      );
      const subscriptions = await this.database.query(
        `UPDATE public.tec_tenant_subscriptions
         SET status = 'expired', updated_at = now()
         WHERE status = 'active'
           AND auto_renew = false
           AND subscription_end_date IS NOT NULL
           AND subscription_end_date < CURRENT_DATE`
      );
      const trialsCount = trials.rowCount ?? 0;
      const subscriptionsCount = subscriptions.rowCount ?? 0;
      if (trialsCount + subscriptionsCount > 0) {
        this.logger.log(
          `Tenant lifecycle refresh: ${trialsCount} trial(s) expired, ${subscriptionsCount} subscription(s) expired`
        );
      }
      return { trials: trialsCount, subscriptions: subscriptionsCount };
    } catch (error: unknown) {
      this.logger.warn(`Tenant lifecycle refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return { trials: 0, subscriptions: 0 };
    }
  }

  async logActivity(
    tenantId: string,
    action: string,
    details: Record<string, unknown> | null,
    performedBy?: number | null
  ): Promise<void> {
    if (!this.ready) return;
    try {
      await this.database.query(
        `INSERT INTO public.tec_tenant_activity_logs (tenant_id, action, details, performed_by)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [tenantId, action, details === null ? null : JSON.stringify(details), performedBy ?? null]
      );
    } catch (error: unknown) {
      this.logger.warn(`Could not record tenant activity "${action}": ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  async listPlans(): Promise<PlanRecord[]> {
    this.assertReady();
    const result = await this.database.query<PlanRow>(
      `SELECT p.id::text AS id, p.name, p.description, p.price_monthly, p.price_yearly,
              p.max_users, p.max_stores, p.features, p.is_active, p.created_at,
              (SELECT COUNT(*) FROM public.tec_tenant_subscriptions s
                WHERE s.plan_id = p.id AND s.status IN ('trial', 'active', 'suspended'))::integer AS tenants_count
       FROM public.tec_subscription_plans p
       ORDER BY COALESCE(p.price_monthly, 0) ASC, p.name ASC`
    );
    return result.rows.map(mapPlan);
  }

  async createPlan(input: CreatePlanDto): Promise<PlanRecord> {
    this.assertReady();
    const result = await this.database.query<PlanRow>(
      `INSERT INTO public.tec_subscription_plans
         (name, description, price_monthly, price_yearly, max_users, max_stores, features, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8, true))
       RETURNING id::text AS id, name, description, price_monthly, price_yearly,
                 max_users, max_stores, features, is_active, created_at`,
      [
        input.name.trim(),
        input.description?.trim() ?? null,
        input.price_monthly ?? null,
        input.price_yearly ?? null,
        input.max_users ?? -1,
        input.max_stores ?? -1,
        JSON.stringify(input.features ?? []),
        input.is_active ?? null
      ]
    );
    return mapPlan({ ...result.rows[0], tenants_count: 0 });
  }

  async updatePlan(id: string, input: UpdatePlanDto): Promise<PlanRecord> {
    this.assertReady();
    const existing = await this.database.query<{ id: string }>(
      'SELECT id::text AS id FROM public.tec_subscription_plans WHERE id = $1 LIMIT 1',
      [id]
    );
    if (existing.rowCount !== 1) throw new NotFoundException('Plan not found');

    const sets: string[] = [];
    const values: unknown[] = [id];
    if (input.name !== undefined) {
      values.push(input.name.trim());
      sets.push(`name = $${values.length}`);
    }
    if (input.description !== undefined) {
      values.push(input.description.trim());
      sets.push(`description = $${values.length}`);
    }
    if (input.price_monthly !== undefined) {
      values.push(input.price_monthly);
      sets.push(`price_monthly = $${values.length}`);
    }
    if (input.price_yearly !== undefined) {
      values.push(input.price_yearly);
      sets.push(`price_yearly = $${values.length}`);
    }
    if (input.max_users !== undefined) {
      values.push(input.max_users);
      sets.push(`max_users = $${values.length}`);
    }
    if (input.max_stores !== undefined) {
      values.push(input.max_stores);
      sets.push(`max_stores = $${values.length}`);
    }
    if (input.features !== undefined) {
      values.push(JSON.stringify(input.features));
      sets.push(`features = $${values.length}::jsonb`);
    }
    if (input.is_active !== undefined) {
      values.push(input.is_active);
      sets.push(`is_active = $${values.length}`);
    }
    if (sets.length === 0) throw new BadRequestException('Nothing to update');

    await this.database.query(
      `UPDATE public.tec_subscription_plans SET ${sets.join(', ')} WHERE id = $1`,
      values
    );
    const result = await this.database.query<PlanRow>(
      `SELECT p.id::text AS id, p.name, p.description, p.price_monthly, p.price_yearly,
              p.max_users, p.max_stores, p.features, p.is_active, p.created_at,
              (SELECT COUNT(*) FROM public.tec_tenant_subscriptions s
                WHERE s.plan_id = p.id AND s.status IN ('trial', 'active', 'suspended'))::integer AS tenants_count
       FROM public.tec_subscription_plans p
       WHERE p.id = $1
       LIMIT 1`,
      [id]
    );
    const plan = result.rows[0];
    if (!plan) throw new NotFoundException('Plan not found');
    return mapPlan(plan);
  }

  async listTenants(): Promise<TenantManagementRow[]> {
    this.assertReady();
    const result = await this.database.query<TenantManagementRow>(
      `${TENANT_SELECT}
       WHERE t.status <> 'deleted'
       ORDER BY t.name ASC`
    );
    return result.rows;
  }

  async getTenantSubscription(tenantId: string): Promise<TenantManagementRow> {
    this.assertReady();
    await this.assertTenant(tenantId);
    const result = await this.database.query<TenantManagementRow>(
      `${TENANT_SELECT}
       WHERE t.id = $1 AND t.status <> 'deleted'
       LIMIT 1`,
      [tenantId]
    );
    const tenant = result.rows[0];
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateSubscription(
    tenantId: string,
    input: UpdateSubscriptionDto,
    performedBy?: number | null
  ): Promise<TenantManagementRow> {
    this.assertReady();
    await this.assertTenant(tenantId);
    let subscription = await this.latestSubscription(tenantId);
    if (!subscription) {
      await this.createSubscription(tenantId, input.plan_id ?? null, 'trial');
      subscription = await this.latestSubscription(tenantId);
    }
    if (!subscription) throw new BadRequestException('Subscription could not be created');

    if (input.plan_id !== undefined && input.plan_id !== subscription.plan_id) {
      const plan = await this.getActivePlan(input.plan_id);
      if (plan.id !== subscription.plan_id) {
        await this.logActivity(
          tenantId,
          'plan_changed',
          { from: subscription.plan_name, to: plan.name, plan_id: plan.id },
          performedBy
        );
      }
    }

    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [subscription.id];
    if (input.plan_id !== undefined) {
      values.push(input.plan_id);
      sets.push(`plan_id = $${values.length}`);
    }
    if (input.billing_cycle !== undefined) {
      values.push(input.billing_cycle);
      sets.push(`billing_cycle = $${values.length}`);
    }
    if (input.auto_renew !== undefined) {
      values.push(input.auto_renew);
      sets.push(`auto_renew = $${values.length}`);
    }
    await this.database.query(
      `UPDATE public.tec_tenant_subscriptions SET ${sets.join(', ')} WHERE id = $1`,
      values
    );
    return this.getTenantSubscription(tenantId);
  }

  async extendTrial(
    tenantId: string,
    input: ExtendTrialDto,
    performedBy?: number | null
  ): Promise<TenantManagementRow> {
    this.assertReady();
    await this.assertTenant(tenantId);
    const requested = input.trial_end_date.slice(0, 10);
    if (requested < todayInBusinessTimezone()) {
      throw new BadRequestException('trial_end_date must be today or later');
    }
    let subscription = await this.latestSubscription(tenantId);
    if (!subscription) {
      await this.createSubscription(tenantId, null, 'trial');
      subscription = await this.latestSubscription(tenantId);
    }
    if (!subscription) throw new BadRequestException('Subscription could not be created');

    await this.database.query(
      `UPDATE public.tec_tenant_subscriptions
       SET trial_end_date = $2::date,
           status = CASE
             WHEN subscription_start_date IS NULL AND status IN ('trial', 'expired') THEN 'trial'
             ELSE status
           END,
           updated_at = now()
       WHERE id = $1`,
      [subscription.id, requested]
    );
    await this.logActivity(
      tenantId,
      'trial_extended',
      { trial_end_date: requested, reason: input.reason ?? null },
      performedBy
    );
    return this.getTenantSubscription(tenantId);
  }

  async suspendTenant(
    tenantId: string,
    input: SuspendTenantDto,
    performedBy?: number | null
  ): Promise<TenantManagementRow> {
    this.assertReady();
    await this.assertTenant(tenantId);
    let subscription = await this.latestSubscription(tenantId);
    if (!subscription) {
      await this.createSubscription(tenantId, null, 'trial');
      subscription = await this.latestSubscription(tenantId);
    }
    if (!subscription) throw new BadRequestException('Subscription could not be created');

    await this.database.transaction(async (client) => {
      await client.query(
        `UPDATE public.tec_tenant_subscriptions
         SET status = 'suspended', updated_at = now()
         WHERE id = $1`,
        [subscription.id]
      );
      await client.query(
        `UPDATE public.tec_tenants SET status = 'inactive' WHERE id = $1 AND status <> 'deleted'`,
        [tenantId]
      );
    });
    await this.logActivity(
      tenantId,
      'tenant_suspended',
      { reason: input.reason, end_date: input.end_date?.slice(0, 10) ?? null },
      performedBy
    );
    return this.getTenantSubscription(tenantId);
  }

  async reactivateTenant(tenantId: string, performedBy?: number | null): Promise<TenantManagementRow> {
    this.assertReady();
    await this.assertTenant(tenantId);
    let subscription = await this.latestSubscription(tenantId);
    if (!subscription) {
      await this.createSubscription(tenantId, null, 'active');
      subscription = await this.latestSubscription(tenantId);
    }
    if (!subscription) throw new BadRequestException('Subscription could not be created');

    await this.database.transaction(async (client) => {
      await client.query(
        `UPDATE public.tec_tenant_subscriptions
         SET status = 'active', updated_at = now()
         WHERE id = $1`,
        [subscription.id]
      );
      await client.query(
        `UPDATE public.tec_tenants SET status = 'active' WHERE id = $1 AND status <> 'deleted'`,
        [tenantId]
      );
    });
    await this.logActivity(tenantId, 'tenant_reactivated', null, performedBy);
    return this.getTenantSubscription(tenantId);
  }

  async listPayments(filters: PaymentFilters, pagination: PaginationQuery): Promise<Paginated<TenantPaymentRow>> {
    this.assertReady();
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    if (filters.tenantId) add('pay.tenant_id = ?::uuid', filters.tenantId);
    if (filters.status) add('pay.status = ?', filters.status);
    if (filters.method) add('lower(COALESCE(pay.payment_method, \'\')) = lower(?)', filters.method);
    if (filters.from) add('pay.payment_date >= ?::date', filters.from);
    if (filters.to) add('pay.payment_date <= ?::date', filters.to);
    if (filters.minAmount) add('pay.amount >= ?::numeric', filters.minAmount);
    if (filters.maxAmount) add('pay.amount <= ?::numeric', filters.maxAmount);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    values.push(pagination.limit, pagination.offset);
    const result = await this.database.query<TenantPaymentRow & { total_count: number }>(
      `SELECT ${PAYMENT_FIELDS}, COUNT(*) OVER() AS total_count
       FROM public.tec_tenant_payments pay
       JOIN public.tec_tenants t ON t.id = pay.tenant_id
       LEFT JOIN public.tec_tenant_subscriptions s ON s.id = pay.subscription_id
       LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id
       ${where}
       ORDER BY pay.payment_date DESC NULLS LAST, pay.created_at DESC NULLS LAST
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async listTenantPayments(tenantId: string, pagination: PaginationQuery): Promise<Paginated<TenantPaymentRow>> {
    await this.assertTenant(tenantId);
    return this.listPayments({ tenantId }, pagination);
  }

  async paymentSummary(): Promise<{
    month: string;
    revenue_this_month: string;
    pending_total: string;
    failed_total: string;
    refunded_total: string;
    completed_this_month: number;
  }> {
    this.assertReady();
    const today = todayInBusinessTimezone();
    const result = await this.database.query<PaymentSummaryRow>(
      `SELECT COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'completed' AND pay.payment_date >= date_trunc('month', $1::date)::date), 0)::text AS revenue_this_month,
              COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'pending'), 0)::text AS pending_total,
              COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'failed'), 0)::text AS failed_total,
              COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'refunded'), 0)::text AS refunded_total,
              COUNT(*) FILTER (WHERE pay.status = 'completed' AND pay.payment_date >= date_trunc('month', $1::date)::date)::integer AS completed_this_month
       FROM public.tec_tenant_payments pay`,
      [today]
    );
    const row = result.rows[0];
    return {
      month: today.slice(0, 7),
      revenue_this_month: row?.revenue_this_month ?? '0',
      pending_total: row?.pending_total ?? '0',
      failed_total: row?.failed_total ?? '0',
      refunded_total: row?.refunded_total ?? '0',
      completed_this_month: row?.completed_this_month ?? 0
    };
  }

  async recordPayment(
    tenantId: string,
    input: RecordPaymentDto,
    performedBy?: number | null
  ): Promise<{ payment: TenantPaymentRow; tenant_id: string; subscription_id: string }> {
    this.assertReady();
    const tenant = await this.assertTenant(tenantId);
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount must be greater than 0');
    }
    const paymentDate = (input.payment_date ?? todayInBusinessTimezone()).slice(0, 10);

    const result = await this.database.transaction(async (client) => {
      const existing = await client.query<SubscriptionIdRow>(
        `SELECT id::text AS id, billing_cycle
         FROM public.tec_tenant_subscriptions
         WHERE tenant_id = $1
         ORDER BY created_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [tenantId]
      );
      let subscriptionId = existing.rows[0]?.id ?? null;
      let cycle = existing.rows[0]?.billing_cycle ?? 'monthly';
      if (!subscriptionId) {
        const planId = await this.defaultPlanId(client);
        const created = await client.query<{ id: string }>(
          `INSERT INTO public.tec_tenant_subscriptions
             (tenant_id, plan_id, status, trial_start_date, trial_end_date, billing_cycle, auto_renew)
           VALUES ($1, $2, 'trial', $3::date, ($3::date + INTERVAL '14 days')::date, 'monthly', true)
           RETURNING id::text AS id`,
          [tenantId, planId, paymentDate]
        );
        subscriptionId = created.rows[0]?.id ?? null;
        cycle = 'monthly';
      }
      if (!subscriptionId) throw new BadRequestException('Subscription could not be created');
      const effectiveCycle = cycle === 'yearly' ? 'yearly' : 'monthly';

      const payment = await client.query<TenantPaymentRow>(
        `INSERT INTO public.tec_tenant_payments
           (subscription_id, tenant_id, amount, payment_date, payment_method, status, notes)
         VALUES ($1, $2, $3, $4::date, $5, 'completed', $6)
         RETURNING id::text AS id, subscription_id::text AS subscription_id, tenant_id::text AS tenant_id,
                   amount, payment_date::text AS payment_date, payment_method, status, invoice_url, notes, created_at`,
        [subscriptionId, tenantId, input.amount, paymentDate, input.payment_method?.trim() ?? null, input.notes?.trim() ?? null]
      );

      await client.query(
        `UPDATE public.tec_tenant_subscriptions
         SET status = 'active',
             last_payment_date = $2::date,
             last_payment_amount = $3,
             subscription_start_date = COALESCE(subscription_start_date, $2::date),
             subscription_end_date = CASE WHEN $4 = 'yearly'
               THEN ($2::date + INTERVAL '1 year')::date
               ELSE ($2::date + INTERVAL '1 month')::date END,
             next_billing_date = CASE WHEN $4 = 'yearly'
               THEN ($2::date + INTERVAL '1 year')::date
               ELSE ($2::date + INTERVAL '1 month')::date END,
             updated_at = now()
         WHERE id = $1`,
        [subscriptionId, paymentDate, input.amount, effectiveCycle]
      );

      return { payment: payment.rows[0], tenant_id: tenantId, subscription_id: subscriptionId };
    });

    await this.logActivity(
      tenantId,
      'payment_recorded',
      { amount: input.amount, payment_method: input.payment_method ?? null, payment_date: paymentDate, tenant: tenant.name },
      performedBy
    );
    return result;
  }

  async listTenantActivity(tenantId: string, pagination: PaginationQuery): Promise<Paginated<TenantActivityRow>> {
    this.assertReady();
    await this.assertTenant(tenantId);
    const result = await this.database.query<TenantActivityRow & { total_count: number }>(
      `SELECT a.id::text AS id, a.tenant_id::text AS tenant_id, a.action, a.details,
              a.performed_by, a.performed_at, COUNT(*) OVER() AS total_count
       FROM public.tec_tenant_activity_logs a
       WHERE a.tenant_id = $1
       ORDER BY a.performed_at DESC, a.id DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, pagination.limit, pagination.offset]
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async assertCanAddUser(tenantId: string): Promise<void> {
    if (!this.ready) return;
    const limits = await this.limitsFor(tenantId);
    if (!limits || limits.max_users === null || limits.max_users === -1) return;
    const count = await this.database.query<CountRow>(
      'SELECT COUNT(*)::integer AS count FROM public.tec_users WHERE tenant_id = $1 AND active = 1',
      [tenantId]
    );
    if ((count.rows[0]?.count ?? 0) >= limits.max_users) {
      throw new BadRequestException(
        `El plan ${limits.plan_name ?? 'actual'} permite hasta ${limits.max_users} usuario(s) activo(s). Mejora el plan para agregar más.`
      );
    }
  }

  async assertCanAddStore(tenantId: string): Promise<void> {
    if (!this.ready) return;
    const limits = await this.limitsFor(tenantId);
    if (!limits || limits.max_stores === null || limits.max_stores === -1) return;
    const count = await this.database.query<CountRow>(
      'SELECT COUNT(*)::integer AS count FROM public.tec_stores WHERE tenant_id = $1',
      [tenantId]
    );
    if ((count.rows[0]?.count ?? 0) >= limits.max_stores) {
      throw new BadRequestException(
        `El plan ${limits.plan_name ?? 'actual'} permite hasta ${limits.max_stores} tienda(s). Mejora el plan para agregar más.`
      );
    }
  }

  async bootstrapSubscription(
    client: SqlExecutor,
    tenantId: string,
    plan: PlanRecord | null
  ): Promise<string | null> {
    if (!this.ready) return null;
    const resolvedPlanId = plan?.id ?? (await this.defaultPlanId(client));
    const today = todayInBusinessTimezone();
    const isPaidPlan = plan !== null
      && (Number(plan.price_monthly ?? 0) > 0 || Number(plan.price_yearly ?? 0) > 0);
    if (isPaidPlan) {
      const active = await client.query<{ id: string }>(
        `INSERT INTO public.tec_tenant_subscriptions
           (tenant_id, plan_id, status, subscription_start_date, subscription_end_date,
            next_billing_date, billing_cycle, auto_renew)
         VALUES ($1, $2, 'active', $3::date, ($3::date + INTERVAL '1 month')::date,
                 ($3::date + INTERVAL '1 month')::date, 'monthly', true)
         RETURNING id::text AS id`,
        [tenantId, resolvedPlanId, today]
      );
      return active.rows[0]?.id ?? null;
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO public.tec_tenant_subscriptions
         (tenant_id, plan_id, status, trial_start_date, trial_end_date, billing_cycle, auto_renew)
       VALUES ($1, $2, 'trial', $3::date, ($3::date + INTERVAL '14 days')::date, 'monthly', true)
       RETURNING id::text AS id`,
      [tenantId, resolvedPlanId, today]
    );
    return result.rows[0]?.id ?? null;
  }

  async resolvePlanForCreation(planId?: string): Promise<PlanRecord | null> {
    if (!this.ready) return null;
    if (planId) {
      const result = await this.database.query<PlanRow>(
        `SELECT id::text AS id, name, description, price_monthly, price_yearly,
                max_users, max_stores, features, is_active, created_at
         FROM public.tec_subscription_plans
         WHERE id = $1 AND is_active = true
         LIMIT 1`,
        [planId]
      );
      const plan = result.rows[0];
      if (!plan) throw new BadRequestException('plan_id does not match an active plan');
      return mapPlan({ ...plan, tenants_count: 0 });
    }
    const defaultId = await this.defaultPlanId();
    if (!defaultId) return null;
    const result = await this.database.query<PlanRow>(
      `SELECT id::text AS id, name, description, price_monthly, price_yearly,
              max_users, max_stores, features, is_active, created_at
       FROM public.tec_subscription_plans
       WHERE id = $1
       LIMIT 1`,
      [defaultId]
    );
    const plan = result.rows[0];
    return plan ? mapPlan({ ...plan, tenants_count: 0 }) : null;
  }

  private async limitsFor(tenantId: string): Promise<PlanLimits | null> {
    const result = await this.database.query<PlanLimits>(
      `SELECT p.name AS plan_name, p.max_users, p.max_stores
       FROM public.tec_tenant_subscriptions s
       LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1
       ORDER BY s.created_at DESC NULLS LAST, s.id DESC
       LIMIT 1`,
      [tenantId]
    );
    return result.rows[0] ?? null;
  }

  private async defaultPlanId(client?: SqlExecutor): Promise<string | null> {
    const executor = client ?? this.database;
    const result = await executor.query<{ id: string }>(
      `SELECT id::text AS id
       FROM public.tec_subscription_plans
       WHERE is_active = true
       ORDER BY (lower(name) = 'plan gratuito') DESC, COALESCE(price_monthly, 0) ASC, created_at ASC
       LIMIT 1`
    );
    return result.rows[0]?.id ?? null;
  }

  private async getActivePlan(planId: string): Promise<PlanRecord> {
    const result = await this.database.query<PlanRow>(
      `SELECT id::text AS id, name, description, price_monthly, price_yearly,
              max_users, max_stores, features, is_active, created_at
       FROM public.tec_subscription_plans
       WHERE id = $1
       LIMIT 1`,
      [planId]
    );
    const plan = result.rows[0];
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.is_active) throw new BadRequestException('Plan is inactive');
    return mapPlan({ ...plan, tenants_count: 0 });
  }

  private async latestSubscription(tenantId: string): Promise<SubscriptionPatchRow | null> {
    const result = await this.database.query<SubscriptionPatchRow>(
      `SELECT s.id::text AS id, s.plan_id::text AS plan_id, p.name AS plan_name, s.billing_cycle
       FROM public.tec_tenant_subscriptions s
       LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1
       ORDER BY s.created_at DESC NULLS LAST, s.id DESC
       LIMIT 1`,
      [tenantId]
    );
    return result.rows[0] ?? null;
  }

  private async createSubscription(tenantId: string, planId: string | null, status: string): Promise<void> {
    const resolvedPlanId = planId ?? (await this.defaultPlanId());
    const today = todayInBusinessTimezone();
    await this.database.query(
      `INSERT INTO public.tec_tenant_subscriptions
         (tenant_id, plan_id, status, trial_start_date, trial_end_date, billing_cycle, auto_renew)
       VALUES ($1, $2, $3, $4::date, ($4::date + INTERVAL '14 days')::date, 'monthly', true)`,
      [tenantId, resolvedPlanId, status, today]
    );
  }

  private async assertTenant(tenantId: string): Promise<TenantBasicRow> {
    const result = await this.database.query<TenantBasicRow>(
      `SELECT id::text AS id, name, status
       FROM public.tec_tenants
       WHERE id = $1 AND status <> 'deleted'
       LIMIT 1`,
      [tenantId]
    );
    const tenant = result.rows[0];
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }
}
