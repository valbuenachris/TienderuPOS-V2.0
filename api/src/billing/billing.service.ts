import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { todayInBusinessTimezone } from '../common/timezone';
import { DatabaseService } from '../database/database.service';
import { TenantManagementService } from '../tenant-management/tenant-management.service';
import { BoldService, BoldWebhookEvent } from './bold.service';
import { RequestPaymentDto } from './billing.dto';

export type BillingInvoiceStatus = 'paid' | 'pending' | 'overdue' | 'cancelled';

export interface BillingInvoice {
  id: string;
  invoice_number: string;
  tenant_id: string;
  subscription_id: string;
  plan_name: string | null;
  amount: string;
  issue_date: string;
  due_date: string;
  paid_date: string | null;
  status: BillingInvoiceStatus;
  payment_method: string | null;
  billing_cycle: string | null;
  notes: string | null;
}

export interface BillingSubscriptionInfo {
  subscription_id: string;
  status: string | null;
  plan_name: string | null;
  billing_cycle: string | null;
  auto_renew: boolean | null;
  next_billing_date: string | null;
  subscription_end_date: string | null;
  trial_end_date: string | null;
}

export interface CurrentInvoiceResult {
  subscription: BillingSubscriptionInfo | null;
  overdue: BillingInvoice | null;
  upcoming: BillingInvoice | null;
}

type SubscriptionRow = {
  id: string | null;
  status: string | null;
  plan_name: string | null;
  price_monthly: string | null;
  price_yearly: string | null;
  billing_cycle: string | null;
  auto_renew: boolean | null;
  trial_end_date: string | null;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
  next_billing_date: string | null;
  last_payment_date: string | null;
  last_payment_amount: string | null;
};

type PaymentRow = {
  id: string;
  amount: string;
  payment_date: string | null;
  payment_method: string | null;
  status: string | null;
  notes: string | null;
};

const PAYMENT_STATUS_MAP: Record<string, BillingInvoiceStatus> = {
  completed: 'paid',
  pending: 'pending',
  failed: 'cancelled',
  refunded: 'cancelled'
};

function shiftDate(date: string, cycle: 'monthly' | 'yearly', direction: -1 | 1): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));
  if (cycle === 'yearly') base.setUTCFullYear(base.getUTCFullYear() + direction);
  else base.setUTCMonth(base.getUTCMonth() + direction);
  return base.toISOString().slice(0, 10);
}

function formatInvoiceNumber(referenceDate: string, suffix: string): string {
  return `FAC-${referenceDate.replace(/-/g, '')}-${suffix}`;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly tenantManagement: TenantManagementService,
    private readonly bold: BoldService
  ) {}

  async listInvoices(tenantId: string): Promise<BillingInvoice[]> {
    const [subscription, payments] = await Promise.all([
      this.subscriptionFor(tenantId),
      this.paymentsFor(tenantId)
    ]);
    const invoices = payments.map((payment) => this.paymentInvoice(tenantId, subscription, payment));
    const current = this.currentPeriodInvoice(tenantId, subscription);
    if (current) invoices.unshift(current);
    return invoices.sort((a, b) => {
      if (a.issue_date === b.issue_date) return a.invoice_number < b.invoice_number ? 1 : -1;
      return a.issue_date < b.issue_date ? 1 : -1;
    });
  }

  async currentInvoice(tenantId: string): Promise<CurrentInvoiceResult> {
    const subscription = await this.subscriptionFor(tenantId);
    const current = this.currentPeriodInvoice(tenantId, subscription);
    return {
      subscription: subscription?.id
        ? {
            subscription_id: subscription.id,
            status: subscription.status,
            plan_name: subscription.plan_name,
            billing_cycle: subscription.billing_cycle,
            auto_renew: subscription.auto_renew,
            next_billing_date: subscription.next_billing_date,
            subscription_end_date: subscription.subscription_end_date,
            trial_end_date: subscription.trial_end_date
          }
        : null,
      overdue: current?.status === 'overdue' ? current : null,
      upcoming: current?.status === 'pending' ? current : null
    };
  }

  async requestPayment(tenantId: string, input: RequestPaymentDto, performedBy?: number | null) {
    const subscription = await this.subscriptionFor(tenantId);
    if (!subscription?.id) throw new BadRequestException('El tenant no tiene una suscripción registrada');
    if (!input.invoice_id.startsWith('period:')) {
      throw new BadRequestException('Solo se pueden pagar facturas vigentes');
    }
    const current = this.currentPeriodInvoice(tenantId, subscription);
    if (!current || current.id !== input.invoice_id) {
      throw new BadRequestException('La factura ya no está vigente; recarga la página');
    }
    const existing = await this.database.query<{ id: string }>(
      `SELECT id::text AS id FROM public.tec_tenant_payments
       WHERE tenant_id = $1 AND status = 'pending' AND notes LIKE $2
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [tenantId, `%${current.invoice_number}%`]
    );
    if (existing.rows[0]) {
      throw new BadRequestException('Ya existe una solicitud de pago pendiente para esta factura');
    }

    const paymentDate = todayInBusinessTimezone();
    const notes = `Solicitud del tenant · ${current.invoice_number}${input.notes ? ` · ${input.notes}` : ''}`;
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO public.tec_tenant_payments
         (subscription_id, tenant_id, amount, payment_date, payment_method, status, notes)
       VALUES ($1, $2, $3, $4::date, $5, 'pending', $6)
       RETURNING id::text AS id`,
      [subscription.id, tenantId, current.amount, paymentDate, input.payment_method, notes]
    );
    await this.tenantManagement.logActivity(
      tenantId,
      'payment_requested',
      { invoice_number: current.invoice_number, amount: current.amount, payment_method: input.payment_method },
      performedBy ?? null
    );
    return {
      id: result.rows[0]?.id ?? null,
      invoice_number: current.invoice_number,
      amount: current.amount,
      status: 'pending'
    };
  }

  async createBoldCheckout(tenantId: string, invoiceId: string, performedBy?: number | null) {
    if (!this.bold.isEnabled()) {
      throw new ServiceUnavailableException('Bold no está configurado; usa el registro manual de pago');
    }
    const subscription = await this.subscriptionFor(tenantId);
    if (!subscription?.id) {
      this.logger.warn(`Bold checkout: tenant ${tenantId} sin suscripción`);
      throw new BadRequestException('El tenant no tiene una suscripción registrada');
    }
    if (!invoiceId.startsWith('period:')) {
      this.logger.warn(`Bold checkout: invoice_id no es de período (${invoiceId.slice(0, 40)})`);
      throw new BadRequestException('Solo se pueden pagar facturas vigentes');
    }
    const current = this.currentPeriodInvoice(tenantId, subscription);
    if (!current || current.id !== invoiceId) {
      this.logger.warn(`Bold checkout: factura no vigente (recibida ${invoiceId.slice(0, 60)})`);
      throw new BadRequestException('La factura ya no está vigente; recarga la página');
    }

    // Reutiliza un checkout Bold activo; si el link murió, se reutiliza la MISMA fila
    // (Opción A) con una referencia única nueva. Los pendientes manuales se liberan.
    const pending = await this.database.query<{
      id: string;
      bold_payment_id: string | null;
      invoice_url: string | null;
    }>(
      `SELECT id::text AS id, bold_payment_id, invoice_url
       FROM public.tec_tenant_payments
       WHERE tenant_id = $1 AND status = 'pending' AND notes LIKE $2
       ORDER BY created_at DESC NULLS LAST`,
      [tenantId, `%${current.invoice_number}%`]
    );
    let reuseRowId: string | null = null;
    for (const row of pending.rows) {
      if (row.bold_payment_id && row.invoice_url) {
        if (reuseRowId !== null) continue;
        let reusable = true;
        try {
          const link = await this.bold.getPaymentLinkStatus(row.bold_payment_id);
          if (link.status === 'REJECTED' || link.status === 'CANCELLED' || link.status === 'EXPIRED') {
            reusable = false;
            reuseRowId = row.id;
          }
        } catch (_error: unknown) {
          // Si Bold no responde, preferimos reutilizar el link ya guardado.
          reusable = true;
        }
        if (reusable) {
          this.logger.log(`Bold checkout reutilizado para ${current.invoice_number}`);
          return {
            id: row.id,
            invoice_number: current.invoice_number,
            amount: current.amount,
            checkout_url: row.invoice_url
          };
        }
      } else {
        await this.database.query(
          `UPDATE public.tec_tenant_payments
           SET status = 'failed', notes = COALESCE(notes, '') || $2
           WHERE id = $1 AND status = 'pending'`,
          [row.id, ' · reemplazado por checkout Bold']
        );
        await this.tenantManagement.logActivity(
          tenantId,
          'payment_superseded',
          { payment_id: row.id, gateway: 'bold' },
          performedBy ?? null
        );
      }
    }

    const amount = Number(current.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.logger.warn(`Bold checkout: monto inválido (${current.amount})`);
      throw new BadRequestException('El monto de la factura no es válido');
    }
    // Bold exige referencias únicas por link (PL_000); sufijo base36 en reintentos.
    const reference = `${current.invoice_number}-${Date.now().toString(36)}`.slice(0, 60);
    const link = await this.bold.createPaymentLink({
      amount,
      description: `Plan ${current.plan_name ?? 'POS'} · ${current.invoice_number}`,
      reference
    });
    const paymentDate = todayInBusinessTimezone();
    const notes = `Bold · ${current.invoice_number}`;
    let paymentId: string | null = null;
    if (reuseRowId !== null) {
      const updated = await this.database.query<{ id: string }>(
        `UPDATE public.tec_tenant_payments
         SET status = 'pending', bold_payment_id = $2, invoice_url = $3,
             notes = $4, payment_date = $5::date, amount = $6
         WHERE id = $1
         RETURNING id::text AS id`,
        [reuseRowId, link.paymentLink, link.url, notes, paymentDate, current.amount]
      );
      paymentId = updated.rows[0]?.id ?? null;
    } else {
      const inserted = await this.database.query<{ id: string }>(
        `INSERT INTO public.tec_tenant_payments
           (subscription_id, tenant_id, amount, payment_date, payment_method, status, notes, bold_payment_id, invoice_url)
         VALUES ($1, $2, $3, $4::date, 'bold', 'pending', $5, $6, $7)
         RETURNING id::text AS id`,
        [subscription.id, tenantId, current.amount, paymentDate, notes, link.paymentLink, link.url]
      );
      paymentId = inserted.rows[0]?.id ?? null;
    }
    await this.tenantManagement.logActivity(
      tenantId,
      'payment_requested',
      {
        invoice_number: current.invoice_number,
        amount: current.amount,
        gateway: 'bold',
        payment_link: link.paymentLink
      },
      performedBy ?? null
    );
    return {
      id: paymentId,
      invoice_number: current.invoice_number,
      amount: current.amount,
      checkout_url: link.url
    };
  }

  async verifyBoldPayments(tenantId: string, performedBy?: number | null) {
    if (!this.bold.isEnabled()) throw new ServiceUnavailableException('Bold no está configurado');
    const rows = await this.database.query<{ id: string; bold_payment_id: string }>(
      `SELECT id::text AS id, bold_payment_id FROM public.tec_tenant_payments
       WHERE tenant_id = $1 AND status = 'pending' AND bold_payment_id IS NOT NULL
       ORDER BY created_at DESC NULLS LAST
       LIMIT 10`,
      [tenantId]
    );
    let confirmed = 0;
    let failed = 0;
    let pending = 0;
    for (const row of rows.rows) {
      try {
        const link = await this.bold.getPaymentLinkStatus(row.bold_payment_id);
        if (link.status === 'PAID') {
          if (await this.settleBoldPayment(row.id, link.transactionId, performedBy, 'bold_verify')) confirmed += 1;
          else pending += 1;
        } else if (link.status === 'REJECTED' || link.status === 'CANCELLED' || link.status === 'EXPIRED') {
          await this.markBoldPaymentFailed(tenantId, row.id, link.status, performedBy);
          failed += 1;
        } else {
          pending += 1;
        }
      } catch (error: unknown) {
        this.logger.warn(
          `Bold verify failed for payment ${row.id}: ${error instanceof Error ? error.message : 'unknown'}`
        );
        pending += 1;
      }
    }
    return { confirmed, failed, pending };
  }

  async handleBoldWebhook(event: BoldWebhookEvent): Promise<{ handled: boolean }> {
    const type = event.type ?? '';
    const data = event.data ?? {};
    const paymentId = typeof data.payment_id === 'string' ? data.payment_id : null;
    const metadata = typeof data.metadata === 'object' && data.metadata !== null && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown>
      : null;
    const reference = typeof metadata?.reference === 'string' ? metadata.reference : null;
    const amountData = typeof data.amount === 'object' && data.amount !== null && !Array.isArray(data.amount)
      ? data.amount as Record<string, unknown>
      : null;
    const eventAmount = amountData?.total !== undefined && amountData?.total !== null
      ? Number(amountData.total)
      : null;
    const candidates = [reference, paymentId].filter((value): value is string => Boolean(value));
    if (candidates.length === 0) return { handled: false };

    const found = await this.database.query<{ id: string; status: string | null; tenant_id: string; amount: string }>(
      `SELECT id::text AS id, status, tenant_id::text AS tenant_id, amount
       FROM public.tec_tenant_payments
       WHERE bold_payment_id = ANY($1::text[])
          OR invoice_url LIKE ANY($2::text[])
          OR notes LIKE ANY($2::text[])
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [candidates, candidates.map((candidate) => `%${candidate}%`)]
    );
    const payment = found.rows[0];
    if (!payment) {
      this.logger.warn(`Bold webhook ${type}: pago no encontrado (${candidates.join(', ')})`);
      return { handled: false };
    }

    if (type === 'SALE_APPROVED') {
      if (payment.status !== 'pending') return { handled: true };
      if (eventAmount !== null && Number.isFinite(eventAmount) && Number(payment.amount) !== eventAmount) {
        this.logger.error(
          `Bold webhook SALE_APPROVED: monto no coincide (evento=${eventAmount} pago=${payment.amount}) id=${payment.id}`
        );
        await this.tenantManagement.logActivity(
          payment.tenant_id,
          'payment_amount_mismatch',
          { payment_id: payment.id, gateway: 'bold', event_amount: eventAmount, payment_amount: payment.amount },
          null
        );
        return { handled: false };
      }
      const settled = await this.settleBoldPayment(payment.id, paymentId, null, 'bold_webhook');
      return { handled: settled };
    }
    if (type === 'SALE_REJECTED') {
      if (payment.status === 'pending') {
        await this.markBoldPaymentFailed(payment.tenant_id, payment.id, 'REJECTED', null);
      }
      return { handled: true };
    }
    await this.tenantManagement.logActivity(
      payment.tenant_id,
      'gateway_event',
      { gateway: 'bold', type, payment_id: paymentId },
      null
    );
    return { handled: true };
  }

  private async settleBoldPayment(
    paymentId: string,
    transactionId: string | null,
    performedBy: number | null | undefined,
    source: 'bold_webhook' | 'bold_verify'
  ): Promise<boolean> {
    try {
      await this.tenantManagement.confirmPayment(paymentId, performedBy ?? null, source);
    } catch (error: unknown) {
      this.logger.warn(
        `Bold settle skipped for payment ${paymentId}: ${error instanceof Error ? error.message : 'unknown'}`
      );
      return false;
    }
    if (transactionId) {
      await this.database.query(
        `UPDATE public.tec_tenant_payments SET notes = COALESCE(notes, '') || $2 WHERE id = $1`,
        [paymentId, ` · txn:${transactionId}`]
      );
    }
    return true;
  }

  private async markBoldPaymentFailed(
    tenantId: string,
    paymentId: string,
    status: string,
    performedBy?: number | null
  ): Promise<void> {
    await this.database.query(
      `UPDATE public.tec_tenant_payments
       SET status = 'failed', notes = COALESCE(notes, '') || $2
       WHERE id = $1 AND status = 'pending'`,
      [paymentId, ` · bold:${status}`]
    );
    await this.tenantManagement.logActivity(
      tenantId,
      'payment_failed',
      { payment_id: paymentId, gateway: 'bold', status },
      performedBy ?? null
    );
  }

  private async subscriptionFor(tenantId: string): Promise<SubscriptionRow | null> {
    const result = await this.database.query<SubscriptionRow>(
      `SELECT s.id::text AS id, s.status, p.name AS plan_name, p.price_monthly, p.price_yearly,
              s.billing_cycle, s.auto_renew,
              s.trial_end_date::text AS trial_end_date,
              s.subscription_start_date::text AS subscription_start_date,
              s.subscription_end_date::text AS subscription_end_date,
              s.next_billing_date::text AS next_billing_date,
              s.last_payment_date::text AS last_payment_date,
              s.last_payment_amount
       FROM public.tec_tenant_subscriptions s
       LEFT JOIN public.tec_subscription_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1
       ORDER BY s.created_at DESC NULLS LAST, s.id DESC
       LIMIT 1`,
      [tenantId]
    );
    return result.rows[0] ?? null;
  }

  private async paymentsFor(tenantId: string): Promise<PaymentRow[]> {
    const result = await this.database.query<PaymentRow>(
      `SELECT id::text AS id, amount, payment_date::text AS payment_date,
              payment_method, status, notes
       FROM public.tec_tenant_payments
       WHERE tenant_id = $1
       ORDER BY payment_date DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 200`,
      [tenantId]
    );
    return result.rows;
  }

  private paymentInvoice(
    tenantId: string,
    subscription: SubscriptionRow | null,
    payment: PaymentRow
  ): BillingInvoice {
    const date = (payment.payment_date ?? todayInBusinessTimezone()).slice(0, 10);
    const status = PAYMENT_STATUS_MAP[(payment.status ?? 'completed').toLowerCase()] ?? 'pending';
    return {
      id: `payment:${payment.id}`,
      invoice_number: formatInvoiceNumber(date, payment.id.slice(0, 6).toUpperCase()),
      tenant_id: tenantId,
      subscription_id: subscription?.id ?? '',
      plan_name: subscription?.plan_name ?? null,
      amount: payment.amount,
      issue_date: date,
      due_date: date,
      paid_date: status === 'paid' ? date : null,
      status,
      payment_method: payment.payment_method,
      billing_cycle: subscription?.billing_cycle ?? null,
      notes: payment.notes
    };
  }

  private currentPeriodInvoice(tenantId: string, subscription: SubscriptionRow | null): BillingInvoice | null {
    if (!subscription?.id) return null;
    const status = (subscription.status ?? '').toLowerCase();
    if (!['active', 'suspended', 'expired'].includes(status)) return null;
    const dueDate = subscription.next_billing_date ?? subscription.subscription_end_date;
    if (!dueDate) return null;
    const cycle: 'monthly' | 'yearly' = subscription.billing_cycle === 'yearly' ? 'yearly' : 'monthly';
    const amount = cycle === 'yearly'
      ? subscription.price_yearly ?? subscription.price_monthly
      : subscription.price_monthly ?? subscription.price_yearly;
    if (amount === null) return null;
    const isOverdue = dueDate.slice(0, 10) < todayInBusinessTimezone();
    return {
      id: `period:${subscription.id}:${dueDate.slice(0, 10)}`,
      invoice_number: formatInvoiceNumber(dueDate.slice(0, 10), isOverdue ? 'VENC' : 'PEND'),
      tenant_id: tenantId,
      subscription_id: subscription.id,
      plan_name: subscription.plan_name,
      amount,
      issue_date: shiftDate(dueDate, cycle, -1),
      due_date: dueDate.slice(0, 10),
      paid_date: null,
      status: isOverdue ? 'overdue' : 'pending',
      payment_method: null,
      billing_cycle: cycle,
      notes: null
    };
  }
}
