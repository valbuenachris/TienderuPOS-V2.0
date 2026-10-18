import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
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
import { formatDay, formatMoney, daysAgoInBusinessTimezone, todayInBusinessTimezone } from '../format';

function isoToday(): string {
  return todayInBusinessTimezone();
}

function isoDaysAgo(days: number): string {
  return daysAgoInBusinessTimezone(days);
}

function monthStart(): string {
  return `${todayInBusinessTimezone().slice(0, 7)}-01`;
}

function yearStart(): string {
  return `${todayInBusinessTimezone().slice(0, 4)}-01-01`;
}

type Preset = { label: string; from: string; to: string };

interface TopChartRow {
  name: string;
  quantity: number;
  subtotal: number;
}

const CHART_TOOLTIP_STYLE = {
  background: 'var(--d-surface, #fff)',
  border: '1px solid var(--d-border, #e2e9e3)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--d-text, #18251c)'
} as const;

/** Tooltip del ranking: unidades + ingresos (Recharts inyecta active/payload). */
function TopProductTooltip({ active, payload, currency }: {
  active?: boolean;
  payload?: Array<{ payload?: TopChartRow }>;
  currency: string;
}) {
  const item = active && payload && payload.length > 0 ? payload[0]?.payload : null;
  if (!item) return null;
  return (
    <div className="chart-tooltip">
      <strong>{item.name}</strong>
      <div>{item.quantity.toFixed(2)} unidades</div>
      <div>{formatMoney(item.subtotal, currency)}</div>
    </div>
  );
}

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
  const salesCount = totals?.sales_count ?? 0;
  const averageTicket = salesCount > 0 ? Number(totals?.grand_total ?? 0) / salesCount : 0;

  const lineData = days.map((day) => ({ day: day.day, ventas: Number(day.grand_total ?? 0) }));
  const barData = (summary?.monthly ?? []).map((point) => ({
    month: point.month,
    Ventas: Number(point.sales ?? 0),
    Compras: Number(point.purchases ?? 0),
    Gastos: Number(point.expenses ?? 0)
  }));
  const stackedData = days.map((day) => ({
    day: day.day,
    Cobrado: Number(day.paid ?? 0),
    Pendiente: Number(day.due ?? 0)
  }));
  const topData: TopChartRow[] = (topQuery.data ?? []).slice(0, 10).map((product) => ({
    name: product.name || product.code || `#${product.product_id}`,
    quantity: Number(product.quantity ?? 0),
    subtotal: Number(product.subtotal ?? 0)
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
      <PageHeader
        eyebrow="ANÁLISIS"
        title="Reportes"
        actions={(
          <div className="page-actions">
            <Link className="primary link-button" to="/reportes/ventas-diarias">Ventas diarias</Link>
            <Link className="primary link-button" to="/reportes/ventas-mensuales">Ventas mensuales</Link>
          </div>
        )}
      />
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

        <div className="stats-grid">
          <article className="stat-card stat-card--ventas"><span>Ventas</span><strong className="stat-value">{totals?.sales_count ?? '—'}</strong><small>{applied.from} → {applied.to}</small></article>
          <article className="stat-card money stat-card--ventas"><span>Total ventas</span><strong className="stat-value">{money(totals?.grand_total ?? 0)}</strong><small>Con impuestos</small></article>
          <article className="stat-card money stat-card--compras"><span>Total compras</span><strong className="stat-value">{money(purchasesTotal)}</strong><small>Costo de mercancía</small></article>
          <article className="stat-card money stat-card--gastos"><span>Total gastos</span><strong className="stat-value">{money(expensesTotal)}</strong><small>Gastos operativos</small></article>
          <article className={`stat-card money stat-card--ganancia ${netProfitPositive ? '' : 'negative'}`}>
            <span>Ganancia neta</span>
            <strong className="stat-value">{money(summary?.net_profit ?? 0)}</strong>
            <small>Ventas − compras − gastos</small>
          </article>
          <article className="stat-card money"><span>Cobrado</span><strong>{money(totals?.paid ?? 0)}</strong><small>Pagos registrados</small></article>
          <article className="stat-card money"><span>Pendiente</span><strong>{money(totals?.due ?? 0)}</strong><small>Saldo por cobrar</small></article>
          <article className="stat-card money"><span>Ticket promedio</span><strong>{money(averageTicket)}</strong><small>Promedio por venta</small></article>
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
                  <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(label) => formatDay(String(label))} contentStyle={CHART_TOOLTIP_STYLE} />
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
                  <Tooltip formatter={(value) => money(Number(value))} contentStyle={CHART_TOOLTIP_STYLE} />
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
        <div className="chart-grid">
          <section className="chart-box">
            <h3 className="chart-title">Cobrado vs pendiente por día</h3>
            {stackedData.length === 0 ? (
              <div className="chart-empty">{summaryQuery.isPending ? 'Cargando…' : 'Sin ventas en el rango.'}</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={stackedData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="cobradoGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#147d4a" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#147d4a" stopOpacity={0.08} />
                    </linearGradient>
                    <linearGradient id="pendienteGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d97706" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#d97706" stopOpacity={0.08} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                  <XAxis dataKey="day" tickFormatter={(value) => String(value).slice(5)} tick={{ fontSize: 11, fill: '#8b968e' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#8b968e' }} width={70} />
                  <Tooltip
                    formatter={(value) => money(Number(value))}
                    labelFormatter={(label) => formatDay(String(label))}
                    contentStyle={CHART_TOOLTIP_STYLE}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="Cobrado" stackId="1" stroke="#147d4a" strokeWidth={2} fill="url(#cobradoGradient)" />
                  <Area type="monotone" dataKey="Pendiente" stackId="1" stroke="#d97706" strokeWidth={2} fill="url(#pendienteGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </section>
        </div>
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
        <div className="chart-grid">
          <section className="chart-box">
            <h3 className="chart-title">Top 10 por unidades vendidas</h3>
            {topData.length === 0 ? (
              <div className="chart-empty">{topQuery.isPending ? 'Cargando…' : 'Sin datos de productos en el rango.'}</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(240, topData.length * 38 + 24)}>
                <BarChart data={topData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#8b968e' }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={150}
                    reversed
                    tick={{ fontSize: 11, fill: '#8b968e' }}
                    tickFormatter={(value) => (String(value).length > 20 ? `${String(value).slice(0, 19)}…` : String(value))}
                  />
                  <Tooltip content={<TopProductTooltip currency={currency} />} cursor={{ fill: '#94a3b81a' }} />
                  <Bar dataKey="quantity" name="Unidades" fill="#147d4a" radius={[0, 6, 6, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>
        </div>
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
