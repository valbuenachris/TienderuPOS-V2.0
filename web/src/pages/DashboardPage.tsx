import { Link } from 'react-router-dom';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useDailyReportQuery, useSalesQuery } from '../pos-queries';
import { formatDate, formatMoney } from '../format';
import { saleStatusLabel } from '../payments';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const { token, tenantId, settings, isAdmin } = useSession();
  const date = today();
  const daily = useDailyReportQuery(token, tenantId, date);
  const recent = useSalesQuery(token, tenantId, undefined, undefined, 1, 5);
  const currency = settings?.currency_prefix || 'COP';
  const report = daily.data;

  return (
    <>
      <PageHeader
        eyebrow="RESUMEN"
        title={isAdmin ? 'Dashboard' : 'Mi jornada'}
        actions={<Link className="primary link-button" to="/pos">Ir al punto de venta</Link>}
      />
      {daily.isError ? <Notice tone="error">No fue posible cargar el resumen del día.</Notice> : null}
      <div className="stat-grid">
        <article className="stat-card">
          <span>Ventas de hoy</span>
          <strong>{report?.sales_count ?? '—'}</strong>
          <small>{date}</small>
        </article>
        <article className="stat-card">
          <span>Subtotal facturado</span>
          <strong>{formatMoney(report?.total, currency)}</strong>
          <small>Antes de impuestos</small>
        </article>
        <article className="stat-card">
          <span>Total con impuestos</span>
          <strong>{formatMoney(report?.grand_total, currency)}</strong>
          <small>Recaudo esperado</small>
        </article>
        <article className="stat-card">
          <span>Cobrado</span>
          <strong>{formatMoney(report?.paid, currency)}</strong>
          <small>Pagos registrados</small>
        </article>
      </div>

      <Panel className="stack">
        <div className="section-heading">
          <div><p className="eyebrow">ACTIVIDAD</p><h2>Últimas ventas</h2></div>
          <Link className="quiet" to="/ventas">Ver historial</Link>
        </div>
        {recent.isError ? <Notice tone="error">No fue posible cargar las ventas recientes.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {(recent.data?.data ?? []).map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.id}</td>
                  <td>{formatDate(sale.created_at)}</td>
                  <td>{sale.customer_name || 'Cliente ocasional'}</td>
                  <td>{formatMoney(sale.grand_total, currency)}</td>
                  <td><span className={`badge ${sale.status ?? ''}`}>{saleStatusLabel(sale.status)}</span></td>
                </tr>
              ))}
              {(recent.data?.data ?? []).length === 0 && !recent.isPending ? (
                <tr><td colSpan={5} className="empty">Todavía no hay ventas registradas.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
