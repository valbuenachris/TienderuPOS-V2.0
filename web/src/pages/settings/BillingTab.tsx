import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import { useApiMutation, useBillingInvoicesQuery, useCurrentInvoiceQuery } from '../../pos-queries';
import { requestBillingPayment, startBoldPayment, verifyBoldPayments } from '../../api';
import type { BillingInvoice, BillingInvoiceStatus } from '../../api';
import { formatDateOnly, formatMoney } from '../../format';
import { daysUntil } from '../tenant-management/utils';

const STATUS_LABELS: Record<BillingInvoiceStatus, string> = {
  paid: 'Pagado',
  pending: 'Pendiente',
  overdue: 'Vencido',
  cancelled: 'Cancelado'
};

const STATUS_BADGES: Record<BillingInvoiceStatus, string> = {
  paid: 'badge paid',
  pending: 'badge partial',
  overdue: 'badge due',
  cancelled: 'badge'
};

const PAY_METHODS = [
  { value: 'Transferencia', label: 'Transferencia bancaria' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'Sistecredito', label: 'Sistecrédito' },
  { value: 'ADI', label: 'Addi' },
  { value: 'credito', label: 'Crédito tienda' }
];

export default function BillingTab() {
  const queryClient = useQueryClient();
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const invoicesQuery = useBillingInvoicesQuery(token, tenantId, Boolean(token && tenantId));
  const currentQuery = useCurrentInvoiceQuery(token, tenantId, Boolean(token && tenantId));

  const [notice, setNotice] = useState('');
  const [payTarget, setPayTarget] = useState<BillingInvoice | null>(null);
  const [detailTarget, setDetailTarget] = useState<BillingInvoice | null>(null);
  const [method, setMethod] = useState(PAY_METHODS[0].value);
  const [notes, setNotes] = useState('');
  const [payError, setPayError] = useState('');

  const payMutation = useApiMutation((input: { invoiceId: string; method: string; notes: string }) =>
    requestBillingPayment(input.invoiceId, { payment_method: input.method, notes: input.notes || undefined })
  );
  const boldMutation = useApiMutation((invoiceId: string) => startBoldPayment(invoiceId));
  const verifyMutation = useApiMutation(() => verifyBoldPayments());
  const [searchParams] = useSearchParams();
  const verifiedRef = useRef(false);

  useEffect(() => {
    const payment = searchParams.get('payment');
    if (!payment || verifiedRef.current) return;
    verifiedRef.current = true;
    window.history.replaceState({}, '', window.location.pathname);
    if (payment === 'cancelled') {
      setNotice('Pago cancelado en Bold. Puedes intentarlo de nuevo.');
      return;
    }
    if (payment === 'success' || payment === 'return') {
      verifyMutation.mutate(undefined, {
        onSuccess: async (result) => {
          setNotice(result.confirmed > 0
            ? 'Pago confirmado por Bold: suscripción activada/renovada.'
            : 'Estamos confirmando tu pago con Bold; si no se refleja en unos minutos, actualiza la página.');
          await refresh();
        },
        onError: (error: Error) => setNotice(error.message)
      });
    }
  }, [searchParams, verifyMutation]);

  const current = currentQuery.data;
  const overdue = current?.overdue ?? null;
  const upcoming = current?.upcoming ?? null;
  const subscription = current?.subscription ?? null;
  const invoices = invoicesQuery.data ?? [];

  const overdueDays = overdue ? Math.abs(daysUntil(overdue.due_date) ?? 0) : 0;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['billing-invoices'] });
    await queryClient.invalidateQueries({ queryKey: ['billing-current'] });
  }

  function openPay(invoice: BillingInvoice) {
    setNotice('');
    setPayError('');
    setMethod(PAY_METHODS[0].value);
    setNotes('');
    setPayTarget(invoice);
  }

  return (
    <>
      {notice ? <Notice tone={/error|no fue|inválid|invalid|no se pudo|ya existe|no está/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {invoicesQuery.isError || currentQuery.isError ? (
        <Notice tone="error">No fue posible cargar la facturación del tenant.</Notice>
      ) : null}

      {overdue ? (
        <Notice tone="error">
          ⚠️ <strong>Factura vencida</strong> · {overdue.invoice_number} por {formatMoney(overdue.amount, currency)}
          {overdueDays > 0 ? ` (venció hace ${overdueDays} día(s))` : ''}.
          <button className="quiet" type="button" onClick={() => openPay(overdue)}> Pagar ahora</button>
        </Notice>
      ) : null}

      <Panel className="stack full-width">
        <div className="section-heading">
          <div><p className="eyebrow">SUSCRIPCIÓN</p><h2>Estado de facturación</h2></div>
        </div>
        {!subscription ? (
          <Notice>No hay una suscripción registrada para este tenant.</Notice>
        ) : subscription.status === 'trial' ? (
          <Notice>
            Período de prueba{subscription.trial_end_date ? ` hasta ${formatDateOnly(subscription.trial_end_date)}` : ''} —
            sin pago requerido. Al finalizar podrás contratar un plan con el administrador.
          </Notice>
        ) : (
          <div className="detail-grid">
            <div className="detail-item"><span>Plan</span><strong>{subscription.plan_name ?? '—'}</strong></div>
            <div className="detail-item"><span>Estado</span><strong>{subscription.status ?? '—'}</strong></div>
            <div className="detail-item"><span>Ciclo</span><strong>{subscription.billing_cycle === 'yearly' ? 'Anual' : subscription.billing_cycle === 'monthly' ? 'Mensual' : '—'}</strong></div>
            <div className="detail-item"><span>Próximo cobro</span><strong>{formatDateOnly(subscription.next_billing_date ?? subscription.subscription_end_date)}</strong></div>
            <div className="detail-item"><span>Auto-renovación</span><strong>{subscription.auto_renew ? 'Sí' : 'No'}</strong></div>
            {upcoming ? (
              <div className="detail-item"><span>Factura vigente</span><strong>{upcoming.invoice_number} · {formatMoney(upcoming.amount, currency)}</strong></div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel className="stack full-width">
        <div className="section-heading">
          <div><p className="eyebrow">HISTORIAL</p><h2>Facturas y pagos</h2></div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Factura #</th><th>Emisión</th><th>Vencimiento</th><th>Plan</th>
                <th>Monto</th><th>Estado</th><th>Forma de pago</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoice_number}</td>
                  <td>{formatDateOnly(invoice.issue_date)}</td>
                  <td>{formatDateOnly(invoice.due_date)}</td>
                  <td>{invoice.plan_name ?? '—'}</td>
                  <td className="money-cell">{formatMoney(invoice.amount, currency)}</td>
                  <td><span className={STATUS_BADGES[invoice.status]}>{STATUS_LABELS[invoice.status]}</span></td>
                  <td>{invoice.payment_method || '—'}</td>
                  <td className="row-actions">
                    <button className="quiet" type="button" onClick={() => setDetailTarget(invoice)}>Ver</button>
                    {invoice.status === 'pending' || invoice.status === 'overdue' ? (
                      <button className="quiet" type="button" onClick={() => openPay(invoice)}>Pagar</button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && !invoicesQuery.isPending ? (
                <tr><td colSpan={8} className="empty">No hay facturas registradas.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Modal
        open={payTarget !== null}
        eyebrow="PAGO"
        title={payTarget ? `Pagar · ${payTarget.invoice_number}` : 'Pagar factura'}
        onClose={() => setPayTarget(null)}
      >
        {payTarget ? (
          <div className="stack">
            <Notice>
              Monto a pagar: <strong>{formatMoney(payTarget.amount, currency)}</strong> ({payTarget.plan_name ?? 'plan'} ·{' '}
              {payTarget.billing_cycle === 'yearly' ? 'anual' : 'mensual'}). Al continuar serás redirigido a{' '}
              <strong>Bold</strong> para pagar de forma segura; al volver confirmaremos el pago automáticamente.
            </Notice>
            {payError ? <Notice tone="error">{payError}</Notice> : null}
            <label>Método de pago
              <select value={method} onChange={(event) => setMethod(event.target.value)}>
                {PAY_METHODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>Referencia / notas (opcional)
              <input value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} placeholder="Ej: transferencia #1234" />
            </label>
            <div className="modal-actions">
              <button className="quiet" type="button" onClick={() => setPayTarget(null)} disabled={payMutation.isPending || boldMutation.isPending}>
                Cancelar
              </button>
              <a
                className="quiet link-button"
                href={`mailto:${settings?.email || ''}?subject=Solicitud%20de%20pago%20${encodeURIComponent(payTarget.invoice_number)}`}
              >
                ✉️ Contactar administrador
              </a>
              <button
                className="quiet"
                type="button"
                disabled={payMutation.isPending || boldMutation.isPending}
                title="Sin pasarela: deja la solicitud pendiente para que el administrador la confirme"
                onClick={() => {
                  payMutation.mutate(
                    { invoiceId: payTarget.id, method, notes: notes.trim() },
                    {
                      onSuccess: async () => {
                        setNotice(`Solicitud de pago para ${payTarget.invoice_number} enviada. Queda pendiente de confirmación.`);
                        setPayTarget(null);
                        await refresh();
                      },
                      onError: (error: Error) => setPayError(error.message)
                    }
                  );
                }}
              >
                {payMutation.isPending ? 'Enviando…' : 'Registro manual'}
              </button>
              <button
                className="primary"
                type="button"
                disabled={payMutation.isPending || boldMutation.isPending}
                onClick={() => {
                  boldMutation.mutate(payTarget.id, {
                    onSuccess: (result) => {
                      window.location.href = result.checkout_url;
                    },
                    onError: (error: Error) => setPayError(error.message)
                  });
                }}
              >
                {boldMutation.isPending ? 'Redirigiendo…' : '💳 Pagar con Bold'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={detailTarget !== null}
        eyebrow="FACTURA"
        title={detailTarget?.invoice_number ?? 'Factura'}
        onClose={() => setDetailTarget(null)}
      >
        {detailTarget ? (
          <div className="stack">
            <div className="print-receipt invoice-print">
              <header>
                <div>
                  <strong>{settings?.site_name || 'POS'}</strong>
                  {settings?.nit ? <small className="block muted">NIT {settings.nit}</small> : null}
                  {settings?.address ? <small className="block muted">{settings.address}</small> : null}
                  {settings?.phone ? <small className="block muted">Tel. {settings.phone}</small> : null}
                </div>
                <div>
                  <strong>{detailTarget.invoice_number}</strong>
                  <small className="block muted">Estado: {STATUS_LABELS[detailTarget.status]}</small>
                </div>
              </header>
              <div className="invoice-lines">
                <div className="detail-item"><span>Emisión</span><strong>{formatDateOnly(detailTarget.issue_date)}</strong></div>
                <div className="detail-item"><span>Vencimiento</span><strong>{formatDateOnly(detailTarget.due_date)}</strong></div>
                <div className="detail-item"><span>Plan</span><strong>{detailTarget.plan_name ?? '—'}</strong></div>
                <div className="detail-item"><span>Ciclo</span><strong>{detailTarget.billing_cycle === 'yearly' ? 'Anual' : 'Mensual'}</strong></div>
                <div className="detail-item"><span>Monto</span><strong>{formatMoney(detailTarget.amount, currency)}</strong></div>
                <div className="detail-item"><span>Forma de pago</span><strong>{detailTarget.payment_method || '—'}</strong></div>
                {detailTarget.paid_date ? (
                  <div className="detail-item"><span>Pagado</span><strong>{formatDateOnly(detailTarget.paid_date)}</strong></div>
                ) : null}
              </div>
              {detailTarget.notes ? <p className="muted">{detailTarget.notes}</p> : null}
              <p className="muted-note">Precio final del plan; no incluye impuestos adicionales.</p>
            </div>
            <div className="modal-actions">
              <button className="quiet" type="button" onClick={() => window.print()}>🖨️ Imprimir</button>
              <button className="primary" type="button" onClick={() => setDetailTarget(null)}>Cerrar</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
