import { useState } from 'react';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useReportSummaryQuery, useTopProductsQuery } from '../pos-queries';
import { formatDay, formatMoney } from '../format';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || 'COP';
  const [from, setFrom] = useState(() => isoDaysAgo(29));
  const [to, setTo] = useState(() => today());
  const [applied, setApplied] = useState(() => ({ from: isoDaysAgo(29), to: today() }));

  const summaryQuery = useReportSummaryQuery(token, tenantId, applied.from, applied.to);
  const topQuery = useTopProductsQuery(token, tenantId, applied.from, applied.to);

  const days = summaryQuery.data ?? [];
  const totals = days.reduce((acc, day) => ({
    sales: acc.sales + day.sales_count,
    subtotal: acc.subtotal + Number(day.total ?? 0),
    grand: acc.grand + Number(day.grand_total ?? 0),
    paid: acc.paid + Number(day.paid ?? 0),
    due: acc.due + Number(day.due ?? 0)
  }), { sales: 0, subtotal: 0, grand: 0, paid: 0, due: 0 });

  return (
    <>
      <PageHeader eyebrow="ANÁLISIS" title="Reportes" />
      <Panel className="stack">
        <div className="toolbar">
          <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button className="primary" onClick={() => setApplied({ from, to })}>Aplicar</button>
        </div>
        {summaryQuery.isError ? <Notice tone="error">No fue posible cargar el resumen.</Notice> : null}
        <div className="stat-grid">
          <article className="stat-card"><span>Ventas</span><strong>{totals.sales}</strong><small>{applied.from} → {applied.to}</small></article>
          <article className="stat-card"><span>Subtotal</span><strong>{formatMoney(totals.subtotal, currency)}</strong><small>Antes de impuestos</small></article>
          <article className="stat-card"><span>Total</span><strong>{formatMoney(totals.grand, currency)}</strong><small>Con impuestos</small></article>
          <article className="stat-card"><span>Cobrado</span><strong>{formatMoney(totals.paid, currency)}</strong><small>Pagos registrados</small></article>
          <article className="stat-card"><span>Pendiente</span><strong>{formatMoney(totals.due, currency)}</strong><small>Saldo por cobrar</small></article>
        </div>

        <div className="section-heading"><div><p className="eyebrow">DETALLE DIARIO</p><h2>Ventas por día</h2></div></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Día</th><th>Ventas</th><th>Subtotal</th><th>Total</th><th>Cobrado</th><th>Pendiente</th></tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.day}>
                  <td>{formatDay(day.day)}</td>
                  <td>{day.sales_count}</td>
                  <td>{formatMoney(day.total, currency)}</td>
                  <td>{formatMoney(day.grand_total, currency)}</td>
                  <td>{formatMoney(day.paid, currency)}</td>
                  <td>{formatMoney(day.due, currency)}</td>
                </tr>
              ))}
              {days.length === 0 && !summaryQuery.isPending ? (
                <tr><td colSpan={6} className="empty">No hay ventas en el rango seleccionado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="section-heading"><div><p className="eyebrow">RANKING</p><h2>Productos más vendidos</h2></div></div>
        {topQuery.isError ? <Notice tone="error">No fue posible cargar el ranking.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Código</th><th>Producto</th><th>Cantidad</th><th>Vendido</th></tr>
            </thead>
            <tbody>
              {(topQuery.data ?? []).map((product, index) => (
                <tr key={product.product_id}>
                  <td>{index + 1}</td>
                  <td>{product.code || `#${product.product_id}`}</td>
                  <td>{product.name || '—'}</td>
                  <td>{Number(product.quantity).toFixed(2)}</td>
                  <td>{formatMoney(product.subtotal, currency)}</td>
                </tr>
              ))}
              {(topQuery.data ?? []).length === 0 && !topQuery.isPending ? (
                <tr><td colSpan={5} className="empty">Sin datos de productos en el rango.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
