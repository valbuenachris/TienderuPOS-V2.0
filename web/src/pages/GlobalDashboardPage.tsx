import { Link } from 'react-router-dom';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useGlobalDashboardQuery } from '../pos-queries';
import { formatDateOnly, formatMoney } from '../format';
import StatusBadge from './tenant-management/components/StatusBadge';

export default function GlobalDashboardPage() {
  const { token, tenantId, isSuperAdmin, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const query = useGlobalDashboardQuery(token, tenantId, isSuperAdmin);
  const data = query.data;

  const byPlan = data?.active_subscriptions.by_plan ?? [];
  const activeTotal = data?.active_subscriptions.total ?? 0;
  const recentSales = data?.recent_sales ?? [];

  return (
    <>
      <PageHeader
        eyebrow="GLOBAL"
        title="Dashboard global"
        actions={<Link className="primary link-button" to="/tenant-management/tenants">Administrar tenants</Link>}
      />
      {query.isError ? (
        <Notice tone="error">No fue posible cargar las métricas de suscripciones. ¿Ejecutaste la migración v0.3.11?</Notice>
      ) : null}
      {query.isPending ? <Notice>Cargando métricas de negocio…</Notice> : null}

      <div className="stats-grid">
        <article className="stat-card stat-card--ganancia">
          <span>Planes vendidos hoy</span>
          <strong>{data?.plan_sales_today.count ?? '—'}</strong>
          <small>{formatMoney(data?.plan_sales_today.revenue, currency)} · {data?.date ?? ''}</small>
        </article>
        <article className="stat-card stat-card--ventas">
          <span>Suscripciones activas</span>
          <strong>{activeTotal}</strong>
          <small>{data?.tenants.active ?? 0} tenants activos de {data?.tenants.total ?? 0}</small>
        </article>
        <article className="stat-card money">
          <span>Ingresos del mes</span>
          <strong className="stat-value">{formatMoney(data?.monthly_revenue.total, currency)}</strong>
          <small>
            MRR {formatMoney(data?.mrr, currency)}/mes · {data?.monthly_revenue.payments_count ?? 0} pago(s)
          </small>
        </article>
        <article className="stat-card stat-card--gastos">
          <span>Cobros vencidos</span>
          <strong>{data?.payments_status.overdue_count ?? 0}</strong>
          <small>
            {formatMoney(data?.payments_status.overdue_amount, currency)} vencido ·{' '}
            {data?.payments_status.pending_count ?? 0} por confirmar ({formatMoney(data?.payments_status.pending_amount, currency)})
          </small>
        </article>
      </div>

      <Panel className="stack full-width">
        <div className="section-heading">
          <div><p className="eyebrow">DISTRIBUCIÓN</p><h2>Suscripciones activas por plan</h2></div>
          <span className="muted">{activeTotal} en total</span>
        </div>
        {byPlan.length === 0 ? (
          <div className="empty">Sin suscripciones activas.</div>
        ) : (
          <div className="plan-bars">
            {byPlan.map((row) => {
              const percent = activeTotal > 0 ? Math.round((row.count / activeTotal) * 100) : 0;
              return (
                <div className="plan-bar" key={row.plan_id ?? row.plan_name ?? 'sin-plan'}>
                  <div className="plan-bar-head"><span>{row.plan_name ?? 'Sin plan'}</span><strong>{row.count}</strong></div>
                  <div className="usage-bar"><span style={{ width: `${percent}%` }} /></div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel className="stack full-width">
        <div className="section-heading">
          <div><p className="eyebrow">ÚLTIMOS MOVIMIENTOS</p><h2>Planes vendidos recientemente</h2></div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Tenant</th><th>Plan</th><th>Fecha</th><th>Monto</th><th>Estado</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {recentSales.map((sale, index) => (
                <tr key={`${sale.tenant_id}-${sale.date ?? 'sin-fecha'}-${index}`}>
                  <td>{sale.tenant_name}</td>
                  <td>{sale.plan_name ?? '—'}</td>
                  <td>{formatDateOnly(sale.date)}</td>
                  <td className="money-cell">{formatMoney(sale.amount, currency)}</td>
                  <td><StatusBadge status={sale.subscription_status ?? 'active'} /></td>
                  <td className="row-actions">
                    <Link className="quiet link-button" to={`/tenant-management/tenants/${sale.tenant_id}`}>Ver tenant</Link>
                  </td>
                </tr>
              ))}
              {recentSales.length === 0 && !query.isPending ? (
                <tr><td colSpan={6} className="empty">Sin pagos de suscripción registrados.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="stack full-width">
        <div className="section-heading">
          <div><p className="eyebrow">ACTIVIDAD DEL MES</p><h2>Suscripciones y pruebas</h2></div>
        </div>
        <div className="detail-grid">
          <div className="detail-item"><span>Nuevas suscripciones</span><strong>{data?.monthly_revenue.new_subscriptions ?? 0}</strong></div>
          <div className="detail-item"><span>Cambios de plan</span><strong>{data?.monthly_revenue.plan_changes ?? 0}</strong></div>
          <div className="detail-item"><span>Cancelaciones</span><strong>{data?.monthly_revenue.cancellations ?? 0}</strong></div>
          <div className="detail-item"><span>Pruebas activas</span><strong>{data?.trials.active ?? 0}</strong></div>
          <div className="detail-item"><span>Pruebas por vencer (7 días)</span><strong>{data?.trials.expiring_soon ?? 0}</strong></div>
          <div className="detail-item"><span>Conversiones este mes</span><strong>{data?.trials.converted ?? 0}</strong></div>
        </div>
      </Panel>
    </>
  );
}
