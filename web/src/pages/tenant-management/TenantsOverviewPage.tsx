import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import { useApiMutation, useSubscriptionPlansQuery, useTenantManagementQuery } from '../../pos-queries';
import { extendTenantTrial, reactivateManagedTenant, suspendManagedTenant, updateTenantSubscription } from '../../api';
import type { TenantManagementRow } from '../../api';
import { formatDateOnly, formatMoney } from '../../format';
import StatusBadge from './components/StatusBadge';
import PlanSelector from './components/PlanSelector';
import TrialExtensionModal from './components/TrialExtensionModal';
import SuspensionModal from './components/SuspensionModal';
import { daysUntil, isExpiringSoon } from './utils';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'trial', label: 'En prueba' },
  { value: 'active', label: 'Activas' },
  { value: 'suspended', label: 'Suspendidas' },
  { value: 'expired', label: 'Vencidas' },
  { value: 'cancelled', label: 'Canceladas' }
];

const getDaysRemaining = (endDate: string): number => daysUntil(endDate) ?? 0;

const formatDate = (value: string | null | undefined): string => formatDateOnly(value);

function remainingLabel(endDate: string): string {
  const days = getDaysRemaining(endDate);
  if (days < 0) return `vencida hace ${Math.abs(days)} día(s)`;
  if (days === 0) return 'vence hoy';
  return `${days} día(s) restantes`;
}

function remainingClass(endDate: string): string {
  const days = getDaysRemaining(endDate);
  if (days < 0) return 'text-danger';
  if (days < 7) return 'text-warn';
  return 'text-green';
}

export default function TenantsOverviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { token, tenantId, isSuperAdmin, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const tenantsQuery = useTenantManagementQuery(token, tenantId, isSuperAdmin);
  const plansQuery = useSubscriptionPlansQuery(token, tenantId, isSuperAdmin);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState(searchParams.get('plan') ?? '');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const [planTargetId, setPlanTargetId] = useState<string | null>(null);
  const [trialTargetId, setTrialTargetId] = useState<string | null>(null);
  const [suspendTargetId, setSuspendTargetId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const planMutation = useApiMutation((input: { id: string; planId: string }) =>
    updateTenantSubscription(input.id, { plan_id: input.planId })
  );
  const trialMutation = useApiMutation((input: { id: string; date: string; reason: string }) =>
    extendTenantTrial(input.id, { trial_end_date: input.date, reason: input.reason || undefined })
  );
  const suspendMutation = useApiMutation((input: { id: string; reason: string; endDate?: string }) =>
    suspendManagedTenant(input.id, { reason: input.reason, end_date: input.endDate })
  );
  const reactivateMutation = useApiMutation((id: string) => reactivateManagedTenant(id));

  const rows = tenantsQuery.data ?? [];
  const plans = plansQuery.data ?? [];

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tenant-management'] });
    await queryClient.invalidateQueries({ queryKey: ['tenants'] });
    await queryClient.invalidateQueries({ queryKey: ['tenant-payments-summary'] });
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && (row.subscription_status ?? '') !== statusFilter) return false;
      if (planFilter && row.plan_id !== planFilter) return false;
      if (expiringOnly && !isExpiringSoon(row)) return false;
      if (term) {
        const haystack = `${row.name} ${row.host ?? ''} ${row.admin_email ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, planFilter, expiringOnly]);

  const activeCount = rows.filter((row) => row.subscription_status === 'active').length;
  const trialCount = rows.filter((row) => row.subscription_status === 'trial').length;
  const expiringCount = rows.filter((row) => isExpiringSoon(row)).length;
  const suspendedCount = rows.filter((row) => row.subscription_status === 'suspended').length;

  const planTarget = planTargetId ? rows.find((row) => row.id === planTargetId) ?? null : null;
  const trialTarget = trialTargetId ? rows.find((row) => row.id === trialTargetId) ?? null : null;
  const suspendTarget = suspendTargetId ? rows.find((row) => row.id === suspendTargetId) ?? null : null;

  function reactivate(row: TenantManagementRow) {
    if (!window.confirm(`¿Reactivar el tenant “${row.name}”? Sus usuarios podrán iniciar sesión de nuevo.`)) return;
    setReactivatingId(row.id);
    reactivateMutation.mutate(row.id, {
      onSuccess: async () => {
        setNotice(`Tenant “${row.name}” reactivado.`);
        setReactivatingId(null);
        await refresh();
      },
      onError: (error: Error) => {
        setNotice(error.message);
        setReactivatingId(null);
      }
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="GESTIÓN"
        title="Tenants"
        actions={<Link className="primary link-button" to="/tenants">Datos y creación</Link>}
      />
      {notice ? <Notice tone={/error|no fue|inválid|invalid|no se pudo|rechaz|falta/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {tenantsQuery.isError ? <Notice tone="error">No fue posible cargar los tenants. ¿Ejecutaste la migración v0.3.11?</Notice> : null}
      {plansQuery.isError ? <Notice tone="error">No fue posible cargar los planes.</Notice> : null}

      <div className="stats-grid">
        <article className="stat-card stat-card--ganancia">
          <span>Activos</span>
          <strong>{activeCount}</strong>
          <small>Suscripción activa</small>
        </article>
        <article className="stat-card stat-card--ventas">
          <span>En prueba</span>
          <strong>{trialCount}</strong>
          <small>Trial de 14 días</small>
        </article>
        <article className="stat-card stat-card--compras">
          <span>Por vencer</span>
          <strong>{expiringCount}</strong>
          <small>Próximos 7 días</small>
        </article>
        <article className="stat-card stat-card--gastos">
          <span>Suspendidos</span>
          <strong>{suspendedCount}</strong>
          <small>Acceso bloqueado</small>
        </article>
      </div>

      <Panel className="stack full-width">
        <div className="toolbar">
          <label>Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, host, email admin" /></label>
          <label>Estado
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>Plan
            <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
              <option value="">Todos los planes</option>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={expiringOnly} onChange={(event) => setExpiringOnly(event.target.checked)} />
            Por vencer (7 días)
          </label>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tenant</th><th>Estado</th><th>Plan</th><th>Prueba / vigencia</th><th>Último pago</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const renewalDate = row.next_billing_date ?? row.subscription_end_date;
                const isSuspended = row.subscription_status === 'suspended';
                const isExpired = row.subscription_status === 'expired';
                return (
                  <tr key={row.id} className={row.subscription_status === 'active' ? '' : 'row-inactive'}>
                    <td>
                      <strong>{row.name}</strong>
                      <small className="block muted">{row.host || 'sin host'}</small>
                      {row.admin_email ? <small className="block muted">{row.admin_email}</small> : null}
                    </td>
                    <td>
                      <StatusBadge status={row.subscription_status} />
                      {row.tenant_status !== 'active' ? (
                        <small className="block muted">Tenant {row.tenant_status === 'inactive' ? 'inactivo' : row.tenant_status}</small>
                      ) : null}
                    </td>
                    <td>{row.plan_name ?? '—'}</td>
                    <td>
                      {row.subscription_status === 'trial' ? (
                        row.trial_end_date ? (
                          <>
                            <div>Prueba</div>
                            <small className="block muted">Hasta: {formatDate(row.trial_end_date)}</small>
                            <small className={`block ${remainingClass(row.trial_end_date)}`}>
                              {remainingLabel(row.trial_end_date)}
                            </small>
                          </>
                        ) : (
                          <small className="text-gray">Sin fecha de prueba</small>
                        )
                      ) : row.subscription_status === 'active' ? (
                        renewalDate ? (
                          <>
                            <div>Activa{row.billing_cycle === 'yearly' ? ' · anual' : row.billing_cycle === 'monthly' ? ' · mensual' : ''}</div>
                            <small className="block muted">
                              {row.next_billing_date ? 'Renueva' : 'Vence'}: {formatDate(renewalDate)}
                            </small>
                            <small className={`block ${remainingClass(renewalDate)}`}>
                              {remainingLabel(renewalDate)}
                            </small>
                          </>
                        ) : (
                          <small className="text-gray">Sin fecha de vencimiento</small>
                        )
                      ) : renewalDate ? (
                        <small className="block muted">Vence: {formatDate(renewalDate)}</small>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {row.last_payment_date ? (
                        <>
                          <div>{formatDate(row.last_payment_date)}</div>
                          <small className="block text-gray">
                            {row.last_payment_amount !== null
                              ? formatMoney(row.last_payment_amount, currency)
                              : 'Pago registrado'}
                          </small>
                        </>
                      ) : (
                        <span className="text-gray">Sin pagos registrados</span>
                      )}
                    </td>
                    <td className="row-actions">
                      <button
                        className="icon-button"
                        type="button"
                        title="Ver detalle"
                        aria-label="Ver detalle"
                        onClick={() => navigate(`/tenant-management/tenants/${row.id}`)}
                      >
                        👁️
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title={row.subscription_id ? 'Cambiar plan' : 'Sin suscripción registrada'}
                        aria-label="Cambiar plan"
                        onClick={() => { setNotice(''); setPlanTargetId(row.id); }}
                        disabled={!row.subscription_id}
                      >
                        💳
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title="Extender prueba"
                        aria-label="Extender prueba"
                        onClick={() => { setNotice(''); setTrialTargetId(row.id); }}
                      >
                        ⏰
                      </button>
                      {isSuspended ? (
                        <button
                          className="icon-button success"
                          type="button"
                          title="Reactivar tenant"
                          aria-label="Reactivar tenant"
                          onClick={() => reactivate(row)}
                          disabled={reactivatingId === row.id}
                        >
                          ▶️
                        </button>
                      ) : (
                        <button
                          className="icon-button danger"
                          type="button"
                          title={isExpired ? 'Vencida: registra un pago o cambia el plan' : 'Suspender tenant'}
                          aria-label="Suspender tenant"
                          onClick={() => { setNotice(''); setSuspendTargetId(row.id); }}
                          disabled={isExpired}
                        >
                          ⏸️
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !tenantsQuery.isPending ? (
                <tr><td colSpan={6} className="empty">No hay tenants que coincidan con los filtros.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <PlanSelector
        open={planTarget !== null}
        currentPlanId={planTarget?.plan_id ?? null}
        plans={plans}
        currency={currency}
        pending={planMutation.isPending}
        onClose={() => setPlanTargetId(null)}
        onSubmit={(planId) => {
          if (!planTarget) return;
          planMutation.mutate({ id: planTarget.id, planId }, {
            onSuccess: async () => {
              setNotice(`Plan de “${planTarget.name}” actualizado.`);
              setPlanTargetId(null);
              await refresh();
            },
            onError: (error: Error) => setNotice(error.message)
          });
        }}
      />

      <TrialExtensionModal
        open={trialTarget !== null}
        tenantName={trialTarget?.name ?? ''}
        currentEnd={trialTarget?.trial_end_date ?? null}
        pending={trialMutation.isPending}
        onClose={() => setTrialTargetId(null)}
        onSubmit={(date, reason) => {
          if (!trialTarget) return;
          trialMutation.mutate({ id: trialTarget.id, date, reason }, {
            onSuccess: async () => {
              setNotice(`Prueba de “${trialTarget.name}” extendida hasta ${date}.`);
              setTrialTargetId(null);
              await refresh();
            },
            onError: (error: Error) => setNotice(error.message)
          });
        }}
      />

      <SuspensionModal
        open={suspendTarget !== null}
        tenantName={suspendTarget?.name ?? ''}
        pending={suspendMutation.isPending}
        onClose={() => setSuspendTargetId(null)}
        onSubmit={(reason, endDate) => {
          if (!suspendTarget) return;
          suspendMutation.mutate({ id: suspendTarget.id, reason, endDate }, {
            onSuccess: async () => {
              setNotice(`Tenant “${suspendTarget.name}” suspendido.`);
              setSuspendTargetId(null);
              await refresh();
            },
            onError: (error: Error) => setNotice(error.message)
          });
        }}
      />
    </>
  );
}
