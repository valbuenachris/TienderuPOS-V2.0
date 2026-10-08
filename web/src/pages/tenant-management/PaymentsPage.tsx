import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Pagination, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import { useApiMutation, useGlobalTenantPaymentsQuery, useTenantManagementQuery, useTenantPaymentSummaryQuery } from '../../pos-queries';
import { confirmTenantPayment } from '../../api';
import type { TenantPaymentFilters } from '../../api';
import { formatDateOnly, formatMoney, todayInBusinessTimezone } from '../../format';

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'completed', label: 'Completados' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'failed', label: 'Fallidos' },
  { value: 'refunded', label: 'Reembolsados' }
];

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function PaymentsPage() {
  const today = todayInBusinessTimezone();
  const queryClient = useQueryClient();
  const { token, tenantId, isSuperAdmin, settings } = useSession();
  const currency = settings?.currency_prefix || '$';

  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [tenantFilter, setTenantFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');

  const confirmMutation = useApiMutation((paymentId: string) => confirmTenantPayment(paymentId));

  const filters = useMemo<TenantPaymentFilters>(() => ({
    tenant_id: tenantFilter || undefined,
    status: statusFilter || undefined,
    method: methodFilter.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    min_amount: minAmount.trim() || undefined,
    max_amount: maxAmount.trim() || undefined
  }), [tenantFilter, statusFilter, methodFilter, from, to, minAmount, maxAmount]);

  const tenantsQuery = useTenantManagementQuery(token, tenantId, isSuperAdmin);
  const summaryQuery = useTenantPaymentSummaryQuery(token, tenantId, isSuperAdmin);
  const paymentsQuery = useGlobalTenantPaymentsQuery(token, tenantId, filters, page, 20, isSuperAdmin);

  const payments = paymentsQuery.data?.data ?? [];
  const summary = summaryQuery.data;

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  function exportCsv() {
    const header = ['Tenant', 'Plan', 'Monto', 'Fecha', 'Método', 'Estado', 'Notas'];
    const lines = payments.map((payment) => [
      payment.tenant_name ?? '',
      payment.plan_name ?? '',
      payment.amount,
      payment.payment_date ?? '',
      payment.payment_method ?? '',
      payment.status ?? '',
      payment.notes ?? ''
    ].map(csvCell).join(','));
    const csv = [header.map(csvCell).join(','), ...lines].join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pagos-tenants-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        eyebrow="GESTIÓN"
        title="Pagos de tenants"
        actions={<button className="quiet" type="button" onClick={exportCsv} disabled={payments.length === 0}>⬇️ Exportar CSV</button>}
      />
      {paymentsQuery.isError ? <Notice tone="error">No fue posible cargar los pagos. ¿Ejecutaste la migración v0.3.11?</Notice> : null}
      {notice ? <Notice tone={/error|no fue|inválid|invalid|no se pudo|solo/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}

      <div className="stats-grid">
        <article className="stat-card stat-card--ganancia">
          <span>Ingresos del mes</span>
          <strong className="stat-value">{formatMoney(summary?.revenue_this_month, currency)}</strong>
          <small>{summary?.month ?? today.slice(0, 7)}</small>
        </article>
        <article className="stat-card stat-card--ventas">
          <span>Pagos completados</span>
          <strong>{summary?.completed_this_month ?? 0}</strong>
          <small>Este mes</small>
        </article>
        <article className="stat-card stat-card--compras">
          <span>Pendientes</span>
          <strong className="stat-value">{formatMoney(summary?.pending_total, currency)}</strong>
          <small>Todo el historial</small>
        </article>
        <article className="stat-card stat-card--gastos">
          <span>Fallidos</span>
          <strong className="stat-value">{formatMoney(summary?.failed_total, currency)}</strong>
          <small>Todo el historial</small>
        </article>
      </div>

      <Panel className="stack full-width">
        <div className="toolbar">
          <label>Desde<input type="date" value={from} onChange={(event) => resetPage(setFrom)(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} onChange={(event) => resetPage(setTo)(event.target.value)} /></label>
          <label>Tenant
            <select value={tenantFilter} onChange={(event) => resetPage(setTenantFilter)(event.target.value)}>
              <option value="">Todos los tenants</option>
              {(tenantsQuery.data ?? []).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
              ))}
            </select>
          </label>
          <label>Estado
            <select value={statusFilter} onChange={(event) => resetPage(setStatusFilter)(event.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>Método<input value={methodFilter} maxLength={50} onChange={(event) => resetPage(setMethodFilter)(event.target.value)} placeholder="Transferencia" /></label>
          <label>Monto mín.<input value={minAmount} inputMode="decimal" onChange={(event) => resetPage(setMinAmount)(event.target.value)} /></label>
          <label>Monto máx.<input value={maxAmount} inputMode="decimal" onChange={(event) => resetPage(setMaxAmount)(event.target.value)} /></label>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Fecha</th><th>Tenant</th><th>Plan</th><th>Monto</th><th>Método</th><th>Estado</th><th>Notas</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{formatDateOnly(payment.payment_date)}</td>
                  <td><Link to={`/tenant-management/tenants/${payment.tenant_id}`}>{payment.tenant_name ?? payment.tenant_id}</Link></td>
                  <td>{payment.plan_name || '—'}</td>
                  <td className="money-cell">{formatMoney(payment.amount, currency)}</td>
                  <td>{payment.payment_method || '—'}</td>
                  <td>
                    <span className={`badge ${payment.status === 'completed' ? 'paid' : payment.status === 'failed' ? 'due' : 'partial'}`}>
                      {payment.status}
                    </span>
                  </td>
                  <td>{payment.notes || '—'}</td>
                  <td className="row-actions">
                    {payment.status === 'pending' ? (
                      <button
                        className="quiet"
                        type="button"
                        disabled={confirmMutation.isPending}
                        title="Confirmar el pago y renovar la suscripción"
                        onClick={() => {
                          setNotice('');
                          confirmMutation.mutate(payment.id, {
                            onSuccess: async () => {
                              setNotice('Pago confirmado: suscripción activada/renovada.');
                              await queryClient.invalidateQueries({ queryKey: ['tenant-payments-global'] });
                              await queryClient.invalidateQueries({ queryKey: ['tenant-payments-summary'] });
                              await queryClient.invalidateQueries({ queryKey: ['tenant-management'] });
                              await queryClient.invalidateQueries({ queryKey: ['billing-invoices'] });
                              await queryClient.invalidateQueries({ queryKey: ['billing-current'] });
                            },
                            onError: (error: Error) => setNotice(error.message)
                          });
                        }}
                      >
                        ✅ Confirmar
                      </button>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && !paymentsQuery.isPending ? (
                <tr><td colSpan={8} className="empty">Sin pagos para los filtros seleccionados.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {paymentsQuery.data ? (
          <Pagination
            page={paymentsQuery.data.meta.page}
            totalPages={paymentsQuery.data.meta.totalPages}
            total={paymentsQuery.data.meta.total}
            onChange={setPage}
          />
        ) : null}
      </Panel>
    </>
  );
}
