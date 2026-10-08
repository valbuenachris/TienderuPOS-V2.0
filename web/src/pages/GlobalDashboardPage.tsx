import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useGlobalDashboardQuery } from '../pos-queries';
import { formatDateOnly, formatMoney } from '../format';
import StatusBadge from './tenant-management/components/StatusBadge';

interface PlanChartItem {
  name: string;
  value: number;
  percent: number;
  color: string;
}

function planColor(name: string | null, index: number): string {
  const value = (name ?? '').toLowerCase();
  if (value.includes('gratuito')) return '#8b968e';
  if (value.includes('básico') || value.includes('basico')) return '#2563eb';
  if (value.includes('profesional')) return '#147d4a';
  if (value.includes('empresarial')) return '#7c3aed';
  const fallback = ['#2563eb', '#147d4a', '#7c3aed', '#d97706', '#0ea5e9', '#8b968e'];
  return fallback[index % fallback.length];
}

function PlanTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: PlanChartItem }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <span className="status-dot" style={{ background: item.color, marginRight: 6 }} />
      {item.name}: <strong>{item.value}</strong> ({item.percent}%)
    </div>
  );
}

export default function GlobalDashboardPage() {
  const { token, tenantId, isSuperAdmin, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const query = useGlobalDashboardQuery(token, tenantId, isSuperAdmin);
  const data = query.data;

  const byPlan = data?.active_subscriptions.by_plan ?? [];
  const activeTotal = data?.active_subscriptions.total ?? 0;
  const recentSales = data?.recent_sales ?? [];
  const recentPlanChanges = data?.recent_plan_changes ?? [];
  const chartData: PlanChartItem[] = byPlan.map((row, index) => ({
    name: row.plan_name ?? 'Sin plan',
    value: row.count,
    percent: activeTotal > 0 ? Math.round((row.count / activeTotal) * 100) : 0,
    color: planColor(row.plan_name, index)
  }));

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
        {chartData.length === 0 ? (
          <div className="empty">Sin suscripciones activas.</div>
        ) : (
          <div className="plan-chart-grid">
            <div className="plan-chart">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    {chartData.map((item) => <Cell key={item.name} fill={item.color} />)}
                  </Pie>
                  <Tooltip content={<PlanTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="plan-legend">
              {chartData.map((item) => (
                <div className="plan-legend-row" key={item.name}>
                  <span className="status-dot" style={{ background: item.color }} />
                  <span>{item.name}</span>
                  <strong>{item.value} · {item.percent}%</strong>
                </div>
              ))}
            </div>
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
          <div><p className="eyebrow">CAMBIOS DE PLAN</p><h2>Movimientos recientes de plan</h2></div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Tenant</th><th>Cambio</th><th>Tipo</th><th>Fecha</th><th /></tr>
            </thead>
            <tbody>
              {recentPlanChanges.map((change, index) => (
                <tr key={`${change.tenant_id}-${change.date ?? 'sin-fecha'}-${index}`}>
                  <td>{change.tenant_name}</td>
                  <td>{change.from_plan ?? '—'} → {change.to_plan ?? '—'}</td>
                  <td>
                    {change.direction === 'upgrade' ? <span className="badge paid">↑ Upgrade</span>
                      : change.direction === 'downgrade' ? <span className="badge due">↓ Downgrade</span>
                        : <span className="badge">• Cambio</span>}
                  </td>
                  <td>{formatDateOnly(change.date)}</td>
                  <td className="row-actions">
                    <Link className="quiet link-button" to={`/tenant-management/tenants/${change.tenant_id}`}>Ver tenant</Link>
                  </td>
                </tr>
              ))}
              {recentPlanChanges.length === 0 && !query.isPending ? (
                <tr><td colSpan={5} className="empty">Sin cambios de plan registrados.</td></tr>
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
          <div className="detail-item">
            <span>Cambios de plan</span>
            <strong>
              {data?.monthly_revenue.plan_changes ?? 0}
              {' '}
              <span className="text-green">↑ {data?.monthly_revenue.upgrades ?? 0}</span>
              {' · '}
              <span className="text-danger">↓ {data?.monthly_revenue.downgrades ?? 0}</span>
            </strong>
          </div>
          <div className="detail-item"><span>Cancelaciones</span><strong>{data?.monthly_revenue.cancellations ?? 0}</strong></div>
          <div className="detail-item"><span>Pruebas activas</span><strong>{data?.trials.active ?? 0}</strong></div>
          <div className="detail-item"><span>Pruebas por vencer (7 días)</span><strong>{data?.trials.expiring_soon ?? 0}</strong></div>
          <div className="detail-item"><span>Conversiones este mes</span><strong>{data?.trials.converted ?? 0}</strong></div>
        </div>
      </Panel>
    </>
  );
}
