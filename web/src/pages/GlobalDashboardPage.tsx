import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Notice, PageHeader, Panel } from '../components/ui';
import { useSession } from '../app/session';
import { useGlobalDashboardQuery } from '../pos-queries';
import { formatMoney } from '../format';

export default function GlobalDashboardPage() {
  const navigate = useNavigate();
  const { token, tenantId, isSuperAdmin, switchTenant, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const query = useGlobalDashboardQuery(token, tenantId, isSuperAdmin);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const data = query.data;

  async function enterTenant(id: string) {
    if (enteringId !== null || id === tenantId) return;
    setEnteringId(id);
    setNotice('');
    try {
      await switchTenant(id);
      navigate('/dashboard');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No fue posible cambiar de tenant');
    } finally {
      setEnteringId(null);
    }
  }

  const topTenants = data?.top_tenants ?? [];

  return (
    <>
      <PageHeader
        eyebrow="GLOBAL"
        title="Dashboard global"
        actions={<Link className="primary link-button" to="/tenants">Administrar tenants</Link>}
      />
      {notice ? <Notice tone="error">{notice}</Notice> : null}
      {query.isError ? <Notice tone="error">No fue posible cargar el dashboard global.</Notice> : null}
      {query.isPending ? <Notice>Cargando métricas globales…</Notice> : null}

      <div className="stats-grid">
        <article className="stat-card">
          <span>Tenants activos</span>
          <strong>{data?.tenants.active ?? '—'}</strong>
          <small>{data?.tenants.total ?? 0} en total</small>
        </article>
        <article className="stat-card">
          <span>Usuarios activos</span>
          <strong>{data?.users ?? '—'}</strong>
          <small>Todos los tenants</small>
        </article>
        <article className="stat-card">
          <span>Tiendas</span>
          <strong>{data?.stores ?? '—'}</strong>
          <small>Todos los tenants</small>
        </article>
        <article className="stat-card stat-card--ventas">
          <span>Ventas hoy</span>
          <strong className="stat-value">{data?.sales.sales_count ?? '—'}</strong>
          <small>{data?.date ?? ''}</small>
        </article>
        <article className="stat-card money stat-card--ventas">
          <span>Total hoy</span>
          <strong className="stat-value">{formatMoney(data?.sales.grand_total, currency)}</strong>
          <small>Subtotal {formatMoney(data?.sales.subtotal, currency)}</small>
        </article>
        <article className="stat-card money stat-card--ganancia">
          <span>Cobrado hoy</span>
          <strong className="stat-value">{formatMoney(data?.sales.paid, currency)}</strong>
          <small>Pagos registrados</small>
        </article>
      </div>

      <Panel className="stack full-width">
        <div className="section-heading">
          <div><p className="eyebrow">COBROS</p><h2>Formas de pago hoy</h2></div>
        </div>
        <div className="stats-grid">
          <article className="stat-card money stat-card--ventas"><span>Efectivo</span><strong className="stat-value">{formatMoney(data?.payments.cash, currency)}</strong></article>
          <article className="stat-card money stat-card--compras"><span>Tarjeta</span><strong className="stat-value">{formatMoney(data?.payments.card, currency)}</strong></article>
          <article className="stat-card money stat-card--gastos"><span>Transferencia</span><strong className="stat-value">{formatMoney(data?.payments.transfer, currency)}</strong></article>
          <article className="stat-card money"><span>Sistecrédito</span><strong>{formatMoney(data?.payments.sistecredito, currency)}</strong></article>
          <article className="stat-card money"><span>Addi</span><strong>{formatMoney(data?.payments.adi, currency)}</strong></article>
          <article className="stat-card money"><span>Crédito tienda</span><strong>{formatMoney(data?.payments.credit, currency)}</strong></article>
        </div>
      </Panel>

      <Panel className="stack full-width">
        <div className="section-heading">
          <div><p className="eyebrow">RANKING</p><h2>Top tenants por ventas de hoy</h2></div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Tenant</th><th>Ventas</th><th>Total</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {topTenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td>{tenant.name}</td>
                  <td>{tenant.sales_count}</td>
                  <td className="money-cell">{formatMoney(tenant.total, currency)}</td>
                  <td className="row-actions">
                    {tenant.id === tenantId ? (
                      <span className="badge paid">Actual</span>
                    ) : (
                      <button
                        className="quiet"
                        type="button"
                        onClick={() => { void enterTenant(tenant.id); }}
                        disabled={enteringId !== null}
                      >
                        {enteringId === tenant.id ? 'Entrando…' : 'Entrar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {topTenants.length === 0 && !query.isPending ? (
                <tr><td colSpan={4} className="empty">Sin ventas registradas hoy en ningún tenant.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
