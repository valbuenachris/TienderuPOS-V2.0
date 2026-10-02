import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal, Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useReportCalendarQuery } from '../pos-queries';
import { MONTH_NAMES, monthRange, yearRange } from '../calendar';
import { formatDay, formatMoney } from '../format';
import type { ReportCalendarPoint } from '../api';

export default function MonthlySalesReport() {
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  const range = useMemo(() => yearRange(year), [year]);
  const calendarQuery = useReportCalendarQuery(token, tenantId, range.from, range.to, 'month');

  const selectedRange = useMemo(
    () => (selectedMonth === null ? null : monthRange(year, selectedMonth)),
    [selectedMonth, year]
  );
  const detailQuery = useReportCalendarQuery(
    token,
    tenantId,
    selectedRange?.from ?? range.from,
    selectedRange?.to ?? range.to,
    'day',
    selectedRange !== null
  );

  const pointsByMonth = useMemo(() => {
    const map = new Map<string, ReportCalendarPoint>();
    for (const point of calendarQuery.data?.points ?? []) map.set(point.key, point);
    return map;
  }, [calendarQuery.data]);

  const detailRows = useMemo(
    () => (detailQuery.data?.points ?? []).filter((point) =>
      Number(point.sales_total) > 0 ||
      Number(point.purchases_total) > 0 ||
      Number(point.expenses_total) > 0
    ),
    [detailQuery.data]
  );

  const totals = calendarQuery.data?.totals;
  const loading = calendarQuery.isFetching;
  const netProfit = Number(totals?.net_profit ?? 0);
  const money = (value: string | number | null | undefined) => formatMoney(value, currency);

  return (
    <>
      <p className="breadcrumb"><Link to="/">Inicio</Link> › <Link to="/reportes">Reportes</Link> › Ventas mensuales</p>
      <PageHeader eyebrow="REPORTES" title="Ventas mensuales" />
      <Panel className="stack full-width">
        <div className="toolbar">
          <div className="calendar-nav">
            <button className="quiet" type="button" onClick={() => setYear((current) => current - 1)} disabled={loading} aria-label="Año anterior">«</button>
            <strong>{year}</strong>
            <button className="quiet" type="button" onClick={() => setYear((current) => current + 1)} disabled={loading} aria-label="Año siguiente">»</button>
          </div>
        </div>
        {calendarQuery.isError ? <Notice tone="error">No fue posible cargar el calendario.</Notice> : null}
        {loading ? <Notice>Cargando…</Notice> : null}

        <div className="stats-grid">
          <article className="stat-card money stat-card--ventas"><span>Ventas</span><strong className="stat-value">{money(totals?.sales_total ?? 0)}</strong><small>{totals?.sales_count ?? 0} ventas</small></article>
          <article className="stat-card money stat-card--compras"><span>Compras</span><strong className="stat-value">{money(totals?.purchases_total ?? 0)}</strong><small>{totals?.purchases_count ?? 0} compras</small></article>
          <article className="stat-card money stat-card--gastos"><span>Gastos</span><strong className="stat-value">{money(totals?.expenses_total ?? 0)}</strong><small>{totals?.expenses_count ?? 0} gastos</small></article>
          <article className={`stat-card money stat-card--ganancia ${netProfit >= 0 ? '' : 'negative'}`}><span>Ganancias</span><strong className="stat-value">{money(totals?.net_profit ?? 0)}</strong><small>Ventas − compras − gastos</small></article>
        </div>

        <div className="month-grid">
          {MONTH_NAMES.map((name, index) => {
            const monthNumber = index + 1;
            const key = `${year}-${String(monthNumber).padStart(2, '0')}`;
            const point = pointsByMonth.get(key);
            return (
              <button type="button" className="month-cell" key={key} onClick={() => setSelectedMonth(monthNumber)}>
                <span className="month-name">{name}</span>
                <span className="day-sales">{money(point?.sales_total ?? 0)}</span>
                <span className="day-meta">{point?.sales_count ?? 0} ventas · Ganancia {money(point?.net_profit ?? 0)}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Modal
        open={selectedMonth !== null}
        eyebrow="DETALLE DEL MES"
        title={selectedMonth === null ? '' : `${MONTH_NAMES[selectedMonth - 1]} ${year}`}
        onClose={() => setSelectedMonth(null)}
      >
        <div className="stack">
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Día</th><th>Ventas</th><th>Compras</th><th>Gastos</th><th>Ganancia</th><th>Pendiente</th></tr></thead>
              <tbody>
                {detailRows.map((point) => (
                  <tr key={point.key}>
                    <td>{formatDay(point.key)}</td>
                    <td>{money(point.sales_total)}</td>
                    <td>{money(point.purchases_total)}</td>
                    <td>{money(point.expenses_total)}</td>
                    <td>{money(point.net_profit)}</td>
                    <td>{money(point.pending_total)}</td>
                  </tr>
                ))}
                {detailRows.length === 0 && !detailQuery.isPending ? (
                  <tr><td colSpan={6} className="empty">Sin movimientos este mes.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </>
  );
}
