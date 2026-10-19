import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, PageHeader, Pagination, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import {
  useApiMutation,
  useMarketplaceAdminOrdersQuery,
  useMarketplaceAdminSummaryQuery
} from '../../pos-queries';
import { markMarketplacePayouts } from '../../api';
import { formatMoney } from '../../format';
import { MarcaBannersTab } from './MarcaBannersTab';
import { ClientesTab } from './ClientesTab';
import { CuponesTab } from './CuponesTab';

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pago pendiente',
  paid: 'Pagado',
  preparing: 'Preparando',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};

const STATUS_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'paid', label: 'Pagados' },
  { value: 'preparing', label: 'Preparando' },
  { value: 'shipped', label: 'Enviados' },
  { value: 'delivered', label: 'Entregados' },
  { value: 'pending_payment', label: 'Pago pendiente' }
];

function OrdersSummaryTab() {
  const queryClient = useQueryClient();
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');

  const summary = useMarketplaceAdminSummaryQuery(token, tenantId);
  const orders = useMarketplaceAdminOrdersQuery(token, tenantId, status, undefined, page);

  const payoutMutation = useApiMutation((input: { tenant_id: string; suborder_ids?: number[] }) =>
    markMarketplacePayouts(input)
  );

  function markPayout(tenantIdValue: string, tenantName: string) {
    if (!window.confirm(`¿Marcar como liquidadas TODAS las sub-órdenes pendientes de ${tenantName}?`)) return;
    setNotice('');
    payoutMutation.mutate({ tenant_id: tenantIdValue }, {
      onSuccess: async (result) => {
        setNotice(
          `Liquidación registrada para ${tenantName}: ${result.marked} sub-orden(es) por ${formatMoney(result.total, currency)}.`
        );
        await queryClient.invalidateQueries({ queryKey: ['marketplace-admin-summary'] });
        await queryClient.invalidateQueries({ queryKey: ['marketplace-admin-orders'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  const data = summary.data;
  const rows = orders.data?.data ?? [];

  return (
    <>
      <Panel className="stack full-width">
        <p className="muted">
          Pedidos de la tienda pública, GMV, comisión de la plataforma y liquidación a los vendedores.
        </p>
        {notice ? <Notice tone={/no |error|inválid/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
        {summary.isError ? <Notice tone="error">No fue posible cargar el resumen del marketplace.</Notice> : null}

        {data ? (
          <div className="stat-grid">
            <div className="stat-card"><span >Pedidos totales</span><strong>{data.orders_count}</strong></div>
            <div className="stat-card"><span >Pedidos pagados</span><strong>{data.paid_orders}</strong></div>
            <div className="stat-card"><span >GMV (pagado)</span><strong>{formatMoney(data.gmv, currency)}</strong></div>
            <div className="stat-card"><span >Comisión plataforma</span><strong>{formatMoney(data.commission, currency)}</strong></div>
            <div className="stat-card"><span >Por pagar a vendedores</span><strong>{formatMoney(data.pending_payout, currency)}</strong></div>
            <div className="stat-card"><span >Pagos pendientes</span><strong>{data.pending_payment}</strong></div>
          </div>
        ) : null}
      </Panel>

      <Panel className="stack full-width">
        <h2>Liquidación a vendedores</h2>
        <p className="muted">
          «Pendiente» suma las sub-órdenes pagadas que aún no has marcado como transferidas. Marca la liquidación
          después de hacer la transferencia al vendedor.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Vendedor</th><th>Pedidos</th><th>Pendiente por liquidar</th><th>Liquidado</th><th /></tr>
            </thead>
            <tbody>
              {(data?.tenants ?? []).map((seller) => (
                <tr key={seller.id}>
                  <td>{seller.name}</td>
                  <td>{seller.orders_count}</td>
                  <td className="money-cell">{formatMoney(seller.pending_payout, currency)}</td>
                  <td className="money-cell">{formatMoney(seller.paid_out, currency)}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      disabled={payoutMutation.isPending || Number(seller.pending_payout) <= 0}
                      onClick={() => markPayout(seller.id, seller.name)}
                    >
                      Marcar liquidado
                    </button>
                  </td>
                </tr>
              ))}
              {(data?.tenants ?? []).length === 0 ? (
                <tr><td colSpan={5} className="empty">Todavía no hay sub-órdenes del marketplace.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="stack full-width">
        <h2>Pedidos</h2>
        <div className="tab-filters">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`chip ${status === item.value ? 'active' : ''}`}
              onClick={() => { setStatus(item.value); setPage(1); }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {orders.isError ? <Notice tone="error">No fue posible cargar los pedidos.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pedido</th><th>Cliente</th><th>Vendedores</th><th>Total</th><th>Comisión</th><th>Estado</th><th>Pago</th><th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id}>
                  <td>{order.order_number}</td>
                  <td>{order.customer_name}<br /><span className="muted small">{order.customer_email ?? ''}</span></td>
                  <td>{order.sellers}</td>
                  <td className="money-cell">{formatMoney(order.grand_total, currency)}</td>
                  <td className="money-cell">{formatMoney(order.commission_total, currency)}</td>
                  <td>
                    <span className={`badge ${order.payment_status === 'paid' ? 'paid' : 'due'}`}>
                      {ORDER_STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </td>
                  <td>
                    {order.payment_status === 'paid' ? 'Confirmado' : 'Pendiente'}<br />
                    <span className="muted small">{order.shipping_city}</span>
                  </td>
                  <td>{order.created_at ? new Date(order.created_at).toLocaleDateString('es-CO') : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && !orders.isPending ? (
                <tr><td colSpan={8} className="empty">No hay pedidos {status ? 'con este estado' : 'todavía'}.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {orders.data ? (
          <Pagination
            page={orders.data.meta.page}
            totalPages={orders.data.meta.totalPages}
            total={orders.data.meta.total}
            onChange={setPage}
          />
        ) : null}
      </Panel>
    </>
  );
}

type GlobalTab = 'orders' | 'brand' | 'customers' | 'coupons';

export default function MarketplaceGlobalPage() {
  const [tab, setTab] = useState<GlobalTab>('orders');
  return (
    <>
      <PageHeader eyebrow="PLATAFORMA · TIENDERU.COM" title="Marketplace global" />
      <div className="tabs">
        <button
          type="button"
          className={`tab ${tab === 'orders' ? 'active' : ''}`}
          onClick={() => setTab('orders')}
        >
          Pedidos y liquidaciones
        </button>
        <button
          type="button"
          className={`tab ${tab === 'brand' ? 'active' : ''}`}
          onClick={() => setTab('brand')}
        >
          Marca y banners
        </button>
        <button
          type="button"
          className={`tab ${tab === 'customers' ? 'active' : ''}`}
          onClick={() => setTab('customers')}
        >
          Clientes
        </button>
        <button
          type="button"
          className={`tab ${tab === 'coupons' ? 'active' : ''}`}
          onClick={() => setTab('coupons')}
        >
          Cupones
        </button>
      </div>
      {tab === 'orders' ? (
        <OrdersSummaryTab />
      ) : tab === 'brand' ? (
        <MarcaBannersTab />
      ) : tab === 'customers' ? (
        <ClientesTab />
      ) : (
        <CuponesTab />
      )}
    </>
  );
}
