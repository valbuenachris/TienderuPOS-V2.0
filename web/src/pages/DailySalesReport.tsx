import { useMemo, useState } from 'react';
import { Modal, Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useReportCalendarQuery, useSalesQuery } from '../pos-queries';
import { MONTH_NAMES, WEEKDAY_NAMES, monthGrid, todayIso } from '../calendar';
import { formatDate, formatDay, formatMoney, formatMoneyCompact } from '../format';
import { saleStatusLabel } from '../payments';
import type { ReportCalendarPoint } from '../api';

function cellMoney(value: string | number | null | undefined, currency: string): string {
  const amount = Number(value ?? 0);
  return amount === 0 ? '—' : formatMoneyCompact(amount, currency);
}

export default function DailySalesReport() {
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const [year, setYear] = useState(() => Number(todayIso().slice(0, 4)));
  const [month, setMonth] = useState(() => Number(todayIso().slice(5, 7)));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const calendarQuery = useReportCalendarQuery(token, tenantId, grid.from, grid.to, 'day');
  const salesQuery = useSalesQuery(
    token,
    tenantId,
    selectedDay ?? undefined,
    selectedDay ?? undefined,
    1,
    100,
    selectedDay !== null
  );

  const pointsByDay = useMemo(() => {
    const map = new Map<string, ReportCalendarPoint>();
    for (const point of calendarQuery.data?.points ?? []) map.set(point.key, point);
    return map;
  }, [calendarQuery.data]);

  const totals = calendarQuery.data?.totals;
  const selectedPoint = selectedDay ? pointsByDay.get(selectedDay) ?? null : null;
  const today = todayIso();
  const loading = calendarQuery.isFetching;
  const netProfit = Number(totals?.net_profit ?? 0);
  const money = (value: string | number | null | undefined) => formatMoney(value, currency);

  function moveMonth(offset: number) {
    const next = new Date(Date.UTC(year, month - 1 + offset, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth() + 1);
  }

  return (
    <>
      <PageHeader eyebrow="REPORTES" title="Ventas diarias" />
      <Panel className="stack full-width">
        <div className="toolbar">
          <div className="calendar-nav">
            <button className="quiet" type="button" onClick={() => moveMonth(-1)} disabled={loading} aria-label="Mes anterior">«</button>
            <strong>{MONTH_NAMES[month - 1]} {year}</strong>
            <button className="quiet" type="button" onClick={() => moveMonth(1)} disabled={loading} aria-label="Mes siguiente">»</button>
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

        <div className="calendar-scroll">
          <div className="calendar-grid">
            {WEEKDAY_NAMES.map((weekday) => <div className="calendar-weekday" key={weekday}>{weekday}</div>)}
            {grid.days.map((day) => {
              const key = day.toISOString().slice(0, 10);
              const point = pointsByDay.get(key);
              const outside = day.getUTCMonth() !== month - 1;
              return (
                <button
                  type="button"
                  key={key}
                  className={`calendar-cell ${outside ? 'outside' : ''} ${key === today ? 'today' : ''}`}
                  onClick={() => setSelectedDay(key)}
                >
                  <span className="day-number">{day.getUTCDate()}</span>
                  <span className="cell-metrics">
                    <span className="cell-metric sales"><span>Ventas</span><b>{cellMoney(point?.sales_total, currency)}</b></span>
                    <span className="cell-metric purchases"><span>Compras</span><b>{cellMoney(point?.purchases_total, currency)}</b></span>
                    <span className="cell-metric expenses"><span>Gastos</span><b>{cellMoney(point?.expenses_total, currency)}</b></span>
                    <span className={`cell-metric profit ${Number(point?.net_profit ?? 0) >= 0 ? 'positive' : 'negative'}`}><span>Ganancia</span><b>{cellMoney(point?.net_profit, currency)}</b></span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Panel>

      <Modal
        open={selectedDay !== null}
        eyebrow="DETALLE DEL DÍA"
        title={selectedDay ? formatDay(selectedDay) : ''}
        onClose={() => setSelectedDay(null)}
      >
        <div className="stack">
          <div className="stat-grid">
            <article className="stat-card money stat-card--ventas"><span>Ventas</span><strong className="stat-value">{money(selectedPoint?.sales_total ?? 0)}</strong><small>{selectedPoint?.sales_count ?? 0} ventas</small></article>
            <article className="stat-card money stat-card--compras"><span>Compras</span><strong className="stat-value">{money(selectedPoint?.purchases_total ?? 0)}</strong><small>{selectedPoint?.purchases_count ?? 0} compras</small></article>
            <article className="stat-card money stat-card--gastos"><span>Gastos</span><strong className="stat-value">{money(selectedPoint?.expenses_total ?? 0)}</strong><small>{selectedPoint?.expenses_count ?? 0} gastos</small></article>
            <article className="stat-card money stat-card--ganancia"><span>Ganancia</span><strong className="stat-value">{money(selectedPoint?.net_profit ?? 0)}</strong><small>Ventas − compras − gastos</small></article>
            <article className="stat-card money"><span>Pendiente</span><strong>{money(selectedPoint?.pending_total ?? 0)}</strong><small>Saldo por cobrar</small></article>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Pagado</th><th>Estado</th></tr></thead>
              <tbody>
                {(salesQuery.data?.data ?? []).map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.id}</td>
                    <td>{formatDate(sale.created_at)}</td>
                    <td>{sale.customer_name || 'Cliente ocasional'}</td>
                    <td>{money(sale.grand_total)}</td>
                    <td>{money(sale.paid)}</td>
                    <td><span className={`badge ${sale.status ?? ''}`}>{saleStatusLabel(sale.status)}</span></td>
                  </tr>
                ))}
                {(salesQuery.data?.data ?? []).length === 0 && selectedDay !== null && !salesQuery.isPending ? (
                  <tr><td colSpan={6} className="empty">Sin ventas registradas este día.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </>
  );
}
