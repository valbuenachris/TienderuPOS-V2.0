import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Pagination, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import {
  useApiMutation,
  useSubscriptionPlansQuery,
  useTenantActivityQuery,
  useTenantPaymentsQuery,
  useTenantSubscriptionQuery
} from '../../pos-queries';
import {
  deleteTenant,
  extendTenantTrial,
  reactivateManagedTenant,
  recordTenantPayment,
  suspendManagedTenant,
  updateTenantSubscription
} from '../../api';
import type { RecordTenantPaymentPayload, TenantManagementRow } from '../../api';
import { formatDateOnly, formatMoney } from '../../format';
import StatusBadge from './components/StatusBadge';
import UsageIndicator from './components/UsageIndicator';
import PlanSelector from './components/PlanSelector';
import TrialExtensionModal from './components/TrialExtensionModal';
import SuspensionModal from './components/SuspensionModal';
import PaymentRecordModal from './components/PaymentRecordModal';
import { daysUntil, formatDetails, planLimitLabel } from './utils';

type Tab = 'overview' | 'payments' | 'activity' | 'actions';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'overview', label: 'Resumen' },
  { value: 'payments', label: 'Pagos' },
  { value: 'activity', label: 'Actividad' },
  { value: 'actions', label: 'Acciones' }
];

const ACTION_LABELS: Record<string, string> = {
  tenant_created: 'Tenant creado',
  tenant_deleted: 'Tenant eliminado',
  plan_changed: 'Cambio de plan',
  trial_extended: 'Prueba extendida',
  tenant_suspended: 'Tenant suspendido',
  tenant_reactivated: 'Tenant reactivado',
  payment_recorded: 'Pago registrado'
};

export default function TenantDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token, tenantId, isSuperAdmin, settings, switchTenant } = useSession();
  const currency = settings?.currency_prefix || '$';

  const rowQuery = useTenantSubscriptionQuery(token, tenantId, id || null);
  const plansQuery = useSubscriptionPlansQuery(token, tenantId, isSuperAdmin);
  const [tab, setTab] = useState<Tab>('overview');
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const paymentsQuery = useTenantPaymentsQuery(token, tenantId, tab === 'payments' ? id : null, paymentsPage);
  const activityQuery = useTenantActivityQuery(token, tenantId, tab === 'activity' ? id : null, activityPage);

  const [notice, setNotice] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [entering, setEntering] = useState(false);

  const planMutation = useApiMutation((planId: string) => updateTenantSubscription(id, { plan_id: planId }));
  const trialMutation = useApiMutation((input: { date: string; reason: string }) =>
    extendTenantTrial(id, { trial_end_date: input.date, reason: input.reason || undefined })
  );
  const suspendMutation = useApiMutation((input: { reason: string; endDate?: string }) =>
    suspendManagedTenant(id, { reason: input.reason, end_date: input.endDate })
  );
  const reactivateMutation = useApiMutation(() => reactivateManagedTenant(id));
  const paymentMutation = useApiMutation((payload: RecordTenantPaymentPayload) => recordTenantPayment(id, payload));
  const deleteMutation = useApiMutation(() => deleteTenant(id));

  const row: TenantManagementRow | null = rowQuery.data ?? null;
  const plans = plansQuery.data ?? [];
  const suggestedAmount = row ? (row.billing_cycle === 'yearly' ? row.price_yearly : row.price_monthly) : null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tenant-subscription'] });
    await queryClient.invalidateQueries({ queryKey: ['tenant-management'] });
    await queryClient.invalidateQueries({ queryKey: ['tenants'] });
    await queryClient.invalidateQueries({ queryKey: ['tenant-payments'] });
    await queryClient.invalidateQueries({ queryKey: ['tenant-payments-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['tenant-activity'] });
  }

  async function enterTenant() {
    if (!row || entering) return;
    setEntering(true);
    setNotice('');
    try {
      await switchTenant(row.id);
      navigate('/dashboard');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No fue posible cambiar de tenant');
    } finally {
      setEntering(false);
    }
  }

  function reactivate() {
    if (!row) return;
    if (!window.confirm(`¿Reactivar el tenant “${row.name}”? Sus usuarios podrán iniciar sesión de nuevo.`)) return;
    reactivateMutation.mutate(undefined, {
      onSuccess: async () => {
        setNotice(`Tenant “${row.name}” reactivado.`);
        await refresh();
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="TENANT"
        title={row?.name ?? 'Detalle del tenant'}
        actions={<Link className="quiet link-button" to="/tenant-management/tenants">← Volver</Link>}
      />
      {notice ? <Notice tone={/error|no fue|inválid|invalid|no se pudo|rechaz|falta/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {rowQuery.isError ? <Notice tone="error">No fue posible cargar la suscripción de este tenant.</Notice> : null}
      {rowQuery.isPending ? <Notice>Cargando suscripción…</Notice> : null}

      {row ? (
        <>
          <div className="tabs">
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`tab ${tab === item.value ? 'active' : ''}`}
                onClick={() => setTab(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'overview' ? (
            <Panel className="stack full-width">
              <div className="section-heading">
                <div><p className="eyebrow">SUSCRIPCIÓN</p><h2>{row.plan_name ?? 'Sin plan'}</h2></div>
                <StatusBadge status={row.subscription_status} />
              </div>
              <div className="detail-grid">
                <div className="detail-item"><span>Host</span><strong>{row.host || 'sin host'}</strong></div>
                <div className="detail-item"><span>Admin</span><strong>{row.admin_email || '—'}</strong></div>
                <div className="detail-item"><span>Estado del tenant</span><strong>{row.tenant_status}</strong></div>
                <div className="detail-item"><span>Ciclo</span><strong>{row.billing_cycle === 'yearly' ? 'Anual' : row.billing_cycle === 'monthly' ? 'Mensual' : '—'}</strong></div>
                <div className="detail-item"><span>Prueba</span><strong>{row.trial_start_date || '—'} → {row.trial_end_date || '—'}</strong><small>{daysUntil(row.trial_end_date) !== null ? `${daysUntil(row.trial_end_date)} día(s)` : ''}</small></div>
                <div className="detail-item"><span>Suscripción</span><strong>{row.subscription_start_date || '—'} → {row.subscription_end_date || '—'}</strong></div>
                <div className="detail-item"><span>Próximo cobro</span><strong>{row.next_billing_date || '—'}</strong></div>
                <div className="detail-item"><span>Auto-renovación</span><strong>{row.auto_renew ? 'Sí' : 'No'}</strong></div>
                <div className="detail-item"><span>Último pago</span><strong>{row.last_payment_date ? `${formatMoney(row.last_payment_amount, currency)} · ${formatDateOnly(row.last_payment_date)}` : '—'}</strong></div>
                <div className="detail-item"><span>Creado</span><strong>{formatDateOnly(row.created_at)}</strong></div>
              </div>
              <div className="usage-grid">
                <UsageIndicator label="Usuarios activos" current={row.users_count} max={row.max_users} />
                <UsageIndicator label="Tiendas" current={row.stores_count} max={row.max_stores} />
              </div>
              <p className="muted-note">
                Límites del plan: {planLimitLabel(row.max_users)} usuario(s), {planLimitLabel(row.max_stores)} tienda(s).
              </p>
            </Panel>
          ) : null}

          {tab === 'payments' ? (
            <Panel className="stack full-width">
              <div className="toolbar">
                <button className="primary" type="button" onClick={() => { setNotice(''); setPaymentOpen(true); }}>
                  + Registrar pago
                </button>
              </div>
              {paymentsQuery.isError ? <Notice tone="error">No fue posible cargar los pagos.</Notice> : null}
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Fecha</th><th>Monto</th><th>Método</th><th>Estado</th><th>Notas</th></tr>
                  </thead>
                  <tbody>
                    {(paymentsQuery.data?.data ?? []).map((payment) => (
                      <tr key={payment.id}>
                        <td>{formatDateOnly(payment.payment_date)}</td>
                        <td className="money-cell">{formatMoney(payment.amount, currency)}</td>
                        <td>{payment.payment_method || '—'}</td>
                        <td><span className={`badge ${payment.status === 'completed' ? 'paid' : payment.status === 'failed' ? 'due' : 'partial'}`}>{payment.status}</span></td>
                        <td>{payment.notes || '—'}</td>
                      </tr>
                    ))}
                    {(paymentsQuery.data?.data ?? []).length === 0 && !paymentsQuery.isPending ? (
                      <tr><td colSpan={5} className="empty">Sin pagos registrados para este tenant.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {paymentsQuery.data ? (
                <Pagination
                  page={paymentsQuery.data.meta.page}
                  totalPages={paymentsQuery.data.meta.totalPages}
                  total={paymentsQuery.data.meta.total}
                  onChange={setPaymentsPage}
                />
              ) : null}
            </Panel>
          ) : null}

          {tab === 'activity' ? (
            <Panel className="stack full-width">
              {activityQuery.isError ? <Notice tone="error">No fue posible cargar la actividad.</Notice> : null}
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>Detalle</th></tr>
                  </thead>
                  <tbody>
                    {(activityQuery.data?.data ?? []).map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatDateOnly(entry.performed_at)}</td>
                        <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                        <td>{entry.performed_by ?? '—'}</td>
                        <td>{formatDetails(entry.details)}</td>
                      </tr>
                    ))}
                    {(activityQuery.data?.data ?? []).length === 0 && !activityQuery.isPending ? (
                      <tr><td colSpan={4} className="empty">Sin actividad registrada.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {activityQuery.data ? (
                <Pagination
                  page={activityQuery.data.meta.page}
                  totalPages={activityQuery.data.meta.totalPages}
                  total={activityQuery.data.meta.total}
                  onChange={setActivityPage}
                />
              ) : null}
            </Panel>
          ) : null}

          {tab === 'actions' ? (
            <Panel className="stack full-width">
              <div className="section-heading">
                <div><p className="eyebrow">ACCIONES</p><h2>Operaciones del tenant</h2></div>
              </div>
              <div className="action-grid">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => { void enterTenant(); }}
                  disabled={entering || row.tenant_status !== 'active'}
                  title={row.tenant_status === 'active' ? 'Entrar al tenant' : 'Tenant inactivo'}
                  aria-label="Entrar al tenant"
                >
                  🚪
                </button>
                <Link className="icon-button" to="/tenants" title="Editar datos" aria-label="Editar datos">✏️</Link>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => { setNotice(''); setPlanOpen(true); }}
                  title="Cambiar plan"
                  aria-label="Cambiar plan"
                >
                  💳
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => { setNotice(''); setTrialOpen(true); }}
                  title="Extender prueba"
                  aria-label="Extender prueba"
                >
                  ⏰
                </button>
                {row.subscription_status === 'suspended' ? (
                  <button
                    className="icon-button success"
                    type="button"
                    onClick={reactivate}
                    disabled={reactivateMutation.isPending}
                    title="Reactivar tenant"
                    aria-label="Reactivar tenant"
                  >
                    ▶️
                  </button>
                ) : (
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={() => { setNotice(''); setSuspendOpen(true); }}
                    title="Suspender tenant"
                    aria-label="Suspender tenant"
                  >
                    ⏸️
                  </button>
                )}
                <button
                  className="icon-button danger"
                  type="button"
                  onClick={() => { setNotice(''); setDeleteOpen(true); }}
                  title="Eliminar tenant"
                  aria-label="Eliminar tenant"
                >
                  🗑️
                </button>
              </div>
              <p className="muted-note">
                Pasa el cursor sobre un icono para ver la acción. Eliminar es un borrado lógico y solo procede si el
                tenant no tiene ventas, usuarios activos ni inventario.
              </p>
            </Panel>
          ) : null}
        </>
      ) : null}

      <PlanSelector
        open={planOpen}
        currentPlanId={row?.plan_id ?? null}
        plans={plans}
        currency={currency}
        pending={planMutation.isPending}
        onClose={() => setPlanOpen(false)}
        onSubmit={(planId) => {
          planMutation.mutate(planId, {
            onSuccess: async () => {
              setNotice('Plan actualizado.');
              setPlanOpen(false);
              await refresh();
            },
            onError: (error: Error) => setNotice(error.message)
          });
        }}
      />

      <TrialExtensionModal
        open={trialOpen}
        tenantName={row?.name ?? ''}
        currentEnd={row?.trial_end_date ?? null}
        pending={trialMutation.isPending}
        onClose={() => setTrialOpen(false)}
        onSubmit={(date, reason) => {
          trialMutation.mutate({ date, reason }, {
            onSuccess: async () => {
              setNotice(`Prueba extendida hasta ${date}.`);
              setTrialOpen(false);
              await refresh();
            },
            onError: (error: Error) => setNotice(error.message)
          });
        }}
      />

      <SuspensionModal
        open={suspendOpen}
        tenantName={row?.name ?? ''}
        pending={suspendMutation.isPending}
        onClose={() => setSuspendOpen(false)}
        onSubmit={(reason, endDate) => {
          suspendMutation.mutate({ reason, endDate }, {
            onSuccess: async () => {
              setNotice('Tenant suspendido.');
              setSuspendOpen(false);
              await refresh();
            },
            onError: (error: Error) => setNotice(error.message)
          });
        }}
      />

      <PaymentRecordModal
        open={paymentOpen}
        tenantName={row?.name ?? ''}
        currency={currency}
        suggestedAmount={suggestedAmount}
        pending={paymentMutation.isPending}
        onClose={() => setPaymentOpen(false)}
        onSubmit={(payload) => {
          paymentMutation.mutate(payload, {
            onSuccess: async () => {
              setNotice('Pago registrado y suscripción activada.');
              setPaymentOpen(false);
              await refresh();
            },
            onError: (error: Error) => setNotice(error.message)
          });
        }}
      />

      <Modal
        open={deleteOpen}
        eyebrow="ELIMINAR"
        title={row ? `Eliminar · ${row.name}` : 'Eliminar tenant'}
        onClose={() => setDeleteOpen(false)}
      >
        <div className="stack">
          <Notice tone="error">
            ⚠️ ¿Estás seguro de eliminar el tenant “{row?.name}”? Esta acción no se puede deshacer.
          </Notice>
          <p className="muted">
            Solo procede si no tiene ventas, usuarios activos ni inventario. El host quedará libre para reutilizarlo.
          </p>
          <div className="modal-actions">
            <button className="quiet" type="button" onClick={() => setDeleteOpen(false)} disabled={deleteMutation.isPending}>Cancelar</button>
            <button
              className="danger"
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => {
                deleteMutation.mutate(undefined, {
                  onSuccess: async () => {
                    await refresh();
                    navigate('/tenant-management/tenants');
                  },
                  onError: (error: Error) => {
                    setNotice(error.message);
                    setDeleteOpen(false);
                  }
                });
              }}
            >
              {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
