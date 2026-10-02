import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useReportSummaryQuery, useTopProductsQuery } from '../pos-queries';
import { formatDay, formatMoney } from '../format';

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

type Preset = { label: string; from: string; to: string };

export default function ReportsPage() {
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || 'COP';
  const [from, setFrom] = useState(() => isoDaysAgo(29));
  const [to, setTo] = useState(() => isoToday());
  const [applied, setApplied] = useState(() => ({ from: isoDaysAgo(29), to: isoToday() }));

  const summaryQuery = useReportSummaryQuery(token, tenantId, applied.from, applied.to);
  const topQuery = useTopProductsQuery(token, tenantId, applied.from, applied.to);
  const summary = summaryQuery.data;
  const loading = summaryQuery.isFetching || topQuery.isFetching;

  const presets: Preset[] = useMemo(() => [
    { label: 'Este mes', from: monthStart(), to: isoToday() },
    { label: 'Últimos 3 meses', from: isoDaysAgo(90), to: isoToday() },
    { label: 'Este año', from: yearStart(), to: isoToday() },
    { label: 'Último año', from: isoDaysAgo(365), to: isoToday() }
  ], []);

  const days = summary?.days ?? [];
  const totals = summary?.totals;
  const purchasesTotal = summary?.purchases_total ?? '0.00';
  const expensesTotal = summary?.expenses_total ?? '0.00';
  const netProfit = Number(summary?.net_profit ?? 0);
  const netProfitPositive = netProfit >= 0;

  const lineData = days.map((day) => ({ day: day.day, ventas: Number(day.grand_total ?? 0) }));
  const barData = (summary?.monthly ?? []).map((point) => ({
    month: point.month,
    Ventas: Number(point.sales ?? 0),
    Compras: Number(point.purchases ?? 0),
    Gastos: Number(point.expenses ?? 0)
  }));

  const money = (value: number | string) => formatMoney(value, currency);
  const activePreset = presets.find((preset) => preset.from === applied.from && preset.to === applied.to)?.label;

  function applyRange(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    setApplied({ from: nextFrom, to: nextTo });
  }

  return (
    <>
      <PageHeader eyebrow="ANÁLISIS" title="Reportes" />
      <Panel className="stack full-width">
        <div className="toolbar">
          <div className="quick-filters">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`quiet ${activePreset === preset.label ? 'active' : ''}`}
                disabled={loading}
                onClick={() => applyRange(preset.from, preset.to)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button className="primary" disabled={loading || from > to} onClick={() => setApplied({ from, to })}>Aplicar</button>
        </div>
        {summaryQuery.isError ? <Notice tone="error">No fue posible cargar el resumen.</Notice> : null}
        {loading ? <Notice>Cargando reportes…</Notice> : null}

        <div className="stat-grid">
          <article className="stat-card"><span>Ventas</span><strong>{totals?.sales_count ?? '—'}</strong><small>{applied.from} → {applied.to}</small></article>
          <article className="stat-card"><span>Total ventas</span><strong>{money(totals?.grand_total ?? 0)}</strong><small>Con impuestos</small></article>
          <article className="stat-card"><span>Total compras</span><strong>{money(purchasesTotal)}</strong><small>Costo de mercancía</small></article>
          <article className="stat-card"><span>Total gastos</span><strong>{money(expensesTotal)}</strong><small>Gastos operativos</small></article>
          <article className={`stat-card profit ${netProfitPositive ? 'positive' : 'negative'}`}>
            <span>Ganancia neta</span>
            <strong className={netProfitPositive ? 'profit-positive' : 'profit-negative'}>{money(summary?.net_profit ?? 0)}</strong>
            <small>Ventas − compras − gastos</small>
          </article>
          <article className="stat-card"><span>Cobrado</span><strong>{money(totals?.paid ?? 0)}</strong><small>Pagos registrados</small></article>
          <article className="stat-card"><span>Pendiente</span><strong>{money(totals?.due ?? 0)}</strong><small>Saldo por cobrar</small></article>
        </div>

        <div className="chart-grid">
          <section className="chart-box">
            <h3 className="chart-title">Evolución diaria de ventas</h3>
            {lineData.length === 0 ? (
              <div className="chart-empty">{summaryQuery.isPending ? 'Cargando…' : 'Sin ventas en el rango.'}</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={lineData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e9e3" />
                  <XAxis dataKey="day" tickFormatter={(value) => String(value).slice(5)} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={70} />
                  <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(label) => formatDay(String(label))} />
                  <Line type="monotone" dataKey="ventas" name="Ventas" stroke="#059669" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className="chart-box">
            <h3 className="chart-title">Ventas vs compras vs gastos (mensual)</h3>
            {barData.length === 0 ? (
              <div className="chart-empty">{summaryQuery.isPending ? 'Cargando…' : 'Sin movimientos en el rango.'}</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={barData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e9e3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={70} />
                  <Tooltip formatter={(value) => money(Number(value))} />
                  <Legend />
                  <Bar dataKey="Ventas" fill="#059669" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Compras" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Gastos" fill="#d97706" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>
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
