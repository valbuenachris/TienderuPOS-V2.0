import { useState } from 'react';
import { Notice, PageHeader, Pagination, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useSalesQuery } from '../pos-queries';
import { formatDate, formatMoney } from '../format';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SalesHistoryPage() {
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || 'COP';
  const [from, setFrom] = useState(() => isoDaysAgo(7));
  const [to, setTo] = useState(() => today());
  const [applied, setApplied] = useState(() => ({ from: isoDaysAgo(7), to: today() }));
  const [page, setPage] = useState(1);
  const limit = 20;
  const sales = useSalesQuery(token, tenantId, applied.from, applied.to, page, limit);

  function applyFilters() {
    setPage(1);
    setApplied({ from, to });
  }

  const rows = sales.data?.data ?? [];
  const meta = sales.data?.meta;

  return (
    <>
      <PageHeader eyebrow="OPERACIÓN" title="Historial de ventas" />
      <Panel className="stack">
        <div className="toolbar">
          <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button className="primary" onClick={applyFilters} disabled={sales.isFetching}>Aplicar</button>
        </div>
        {sales.isError ? <Notice tone="error">No fue posible cargar las ventas.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Artículos</th><th>Subtotal</th><th>Total</th><th>Pagado</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.id}</td>
                  <td>{formatDate(sale.created_at)}</td>
                  <td>{sale.customer_name || 'Cliente ocasional'}</td>
                  <td>{sale.total_items ?? '—'}</td>
                  <td>{formatMoney(sale.total, currency)}</td>
                  <td>{formatMoney(sale.grand_total, currency)}</td>
                  <td>{formatMoney(sale.paid, currency)}</td>
                  <td><span className={`badge ${sale.status ?? ''}`}>{sale.status || '—'}</span></td>
                </tr>
              ))}
              {rows.length === 0 && !sales.isPending ? (
                <tr><td colSpan={8} className="empty">No hay ventas en el rango seleccionado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={meta?.totalPages ?? 0}
          total={meta?.total ?? 0}
          onChange={setPage}
        />
      </Panel>
    </>
  );
}
