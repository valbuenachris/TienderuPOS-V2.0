import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Pagination, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import {
  useApiMutation,
  useMarketplaceOrdersQuery,
  useMarketplaceSettingsQuery,
  useMarketplaceSummaryQuery
} from '../../pos-queries';
import { updateMarketplaceOrderStatus, updateMarketplaceSettings, fetchMarketplaceOrderDetail } from '../../api';
import type { MarketplaceSuborderRow } from '../../api';
import { formatMoney } from '../../format';

type Tab = 'orders' | 'summary' | 'settings';

const SUBORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pago pendiente',
  paid: 'Pagado',
  preparing: 'Preparando',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};

const NEXT_STATUS: Record<string, { value: 'preparing' | 'shipped' | 'delivered'; label: string }> = {
  paid: { value: 'preparing', label: 'Marcar preparando' },
  preparing: { value: 'shipped', label: 'Marcar enviado' },
  shipped: { value: 'delivered', label: 'Marcar entregado' }
};

const STATUS_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'paid', label: 'Pagados' },
  { value: 'preparing', label: 'Preparando' },
  { value: 'shipped', label: 'Enviados' },
  { value: 'delivered', label: 'Entregados' },
  { value: 'cancelled', label: 'Cancelados' }
];

export default function MarketplacePage() {
  const [tab, setTab] = useState<Tab>('orders');

  return (
    <>
      <PageHeader eyebrow="TIENDA ONLINE · TIENDERU.COM" title="Marketplace" />
      <div className="tabs">
        <button type="button" className={`tab ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
          Pedidos
        </button>
        <button type="button" className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>
          Resumen
        </button>
        <button type="button" className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
          Configuración
        </button>
      </div>
      {tab === 'orders' ? <OrdersTab /> : null}
      {tab === 'summary' ? <SummaryTab /> : null}
      {tab === 'settings' ? <SettingsTab /> : null}
    </>
  );
}

function OrdersTab() {
  const queryClient = useQueryClient();
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);

  const query = useMarketplaceOrdersQuery(token, tenantId, status, page);
  const detail = useQuery({
    queryKey: ['marketplace-order-detail', detailId],
    queryFn: () => fetchMarketplaceOrderDetail(detailId as number),
    enabled: detailId !== null
  });

  const statusMutation = useApiMutation((input: { id: number; status: 'preparing' | 'shipped' | 'delivered' | 'cancelled'; note?: string }) =>
    updateMarketplaceOrderStatus(input.id, { status: input.status, ...(input.note ? { note: input.note } : {}) })
  );

  const rows = query.data?.data ?? [];

  function advance(order: MarketplaceSuborderRow, note?: string) {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    setNotice('');
    statusMutation.mutate({ id: order.id, status: next.value, note }, {
      onSuccess: async () => {
        setNotice(`Pedido ${order.suborder_number}: ahora está «${SUBORDER_STATUS_LABELS[next.value]}».`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['marketplace-orders'] }),
          queryClient.invalidateQueries({ queryKey: ['marketplace-summary'] })
        ]);
        if (detailId !== null) await detail.refetch();
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function cancelOrder(order: MarketplaceSuborderRow) {
    if (!window.confirm(`¿Cancelar la sub-orden ${order.suborder_number}? El stock volverá a la tienda.`)) return;
    setNotice('');
    statusMutation.mutate({ id: order.id, status: 'cancelled' }, {
      onSuccess: async () => {
        setNotice(`Pedido ${order.suborder_number} cancelado; el stock volvió a la tienda.`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['marketplace-orders'] }),
          queryClient.invalidateQueries({ queryKey: ['marketplace-summary'] })
        ]);
        if (detailId !== null) await detail.refetch();
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  return (
    <Panel className="stack full-width">
      <p className="muted">
        Pedidos de tienderu.com que le corresponden a tu tienda. Prepara, despacha y marca la entrega de tu parte.
      </p>
      {notice ? <Notice tone={/no |error|inválid|invalid/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {query.isError ? <Notice tone="error">No fue posible cargar los pedidos del marketplace.</Notice> : null}

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

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Pedido</th><th>Cliente</th><th>Ciudad</th><th>Venta</th><th>Comisión</th><th>Estado</th><th>Fecha</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((order) => (
              <tr key={order.id}>
                <td>{order.suborder_number}</td>
                <td>{order.customer_name}</td>
                <td>{order.shipping_city}</td>
                <td className="money-cell">{formatMoney(order.tenant_total, currency)}</td>
                <td className="money-cell">{formatMoney(order.commission, currency)}</td>
                <td>
                  <span className={`badge ${order.status === 'paid' ? 'paid' : order.status === 'delivered' ? 'paid' : 'due'}`}>
                    {SUBORDER_STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </td>
                <td>{order.created_at ? new Date(order.created_at).toLocaleDateString('es-CO') : '—'}</td>
                <td className="row-actions">
                  <button type="button" className="quiet" onClick={() => setDetailId(order.id)}>Ver</button>
                  {NEXT_STATUS[order.status] ? (
                    <button
                      type="button"
                      disabled={statusMutation.isPending}
                      onClick={() => advance(order)}
                    >
                      {NEXT_STATUS[order.status]?.label}
                    </button>
                  ) : null}
                  {order.status === 'pending' ? (
                    <button
                      type="button"
                      className="quiet"
                      disabled={statusMutation.isPending}
                      onClick={() => cancelOrder(order)}
                    >
                      Cancelar
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !query.isPending ? (
              <tr><td colSpan={8} className="empty">No hay pedidos del marketplace {status ? 'con este estado' : 'todavía'}.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {query.data ? (
        <Pagination page={query.data.meta.page} totalPages={query.data.meta.totalPages} total={query.data.meta.total} onChange={setPage} />
      ) : null}

      <Modal
        open={detailId !== null}
        title={detail.data ? `Pedido ${detail.data.suborder_number}` : 'Pedido'}
        eyebrow="MARKETPLACE"
        onClose={() => setDetailId(null)}
      >
        {detail.isPending && detailId !== null ? <p className="muted">Cargando pedido…</p> : null}
        {detail.isError ? <Notice tone="error">No fue posible cargar el pedido.</Notice> : null}
        {detail.data ? (
          <div className="stack">
            <p>
              <strong>{detail.data.customer_name}</strong>
              {detail.data.customer_phone ? ` · ${detail.data.customer_phone}` : ''}
              {detail.data.customer_email ? <><br />{detail.data.customer_email}</> : null}
            </p>
            <p>
              <strong>Dirección de envío</strong><br />
              {detail.data.shipping_recipient}<br />
              {detail.data.shipping_address}
              {detail.data.shipping_neighborhood ? `, ${detail.data.shipping_neighborhood}` : ''} — {detail.data.shipping_city}<br />
              Tel: {detail.data.shipping_phone}
              {detail.data.shipping_notes ? <><br /><span className="muted">{detail.data.shipping_notes}</span></> : null}
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead>
                <tbody>
                  {detail.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.product_name}{item.product_code ? ` · ${item.product_code}` : ''}</td>
                      <td>{item.quantity}</td>
                      <td className="money-cell">{formatMoney(item.line_total, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              Recibes <strong>{formatMoney(detail.data.tenant_total, currency)}</strong> por esta sub-orden ·
              Comisión plataforma: {formatMoney(detail.data.commission, currency)}
            </p>
            {detail.data.tracking_note ? <p className="muted">Nota de despacho: {detail.data.tracking_note}</p> : null}
            <div className="modal-actions">
              {NEXT_STATUS[detail.data.status] ? (
                <button
                  type="button"
                  disabled={statusMutation.isPending}
                  onClick={() => {
                    const note = window.prompt('Nota de despacho (opcional: guía, mensajería, horario…)') ?? undefined;
                    advance(detail.data as MarketplaceSuborderRow, note?.trim() || undefined);
                  }}
                >
                  {NEXT_STATUS[detail.data.status]?.label}
                </button>
              ) : null}
              {detail.data.status === 'pending' ? (
                <button
                  type="button"
                  className="quiet"
                  disabled={statusMutation.isPending}
                  onClick={() => cancelOrder(detail.data as MarketplaceSuborderRow)}
                >
                  Cancelar sub-orden
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </Panel>
  );
}

function SummaryTab() {
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const query = useMarketplaceSummaryQuery(token, tenantId);

  const summary = query.data;
  return (
    <Panel className="stack full-width">
      <p className="muted">Ventas del marketplace acumuladas y comisión de la plataforma.</p>
      {query.isError ? <Notice tone="error">No fue posible cargar el resumen.</Notice> : null}
      {summary ? (
        <div className="stat-grid">
          <div className="stat-card"><span >Pedidos recibidos</span><strong>{summary.orders_count}</strong></div>
          <div className="stat-card"><span >Pendientes de pago</span><strong>{summary.pending_count}</strong></div>
          <div className="stat-card"><span >Entregados</span><strong>{summary.delivered_count}</strong></div>
          <div className="stat-card"><span >Ventas marketplace</span><strong>{formatMoney(summary.tenant_total, currency)}</strong></div>
          <div className="stat-card"><span >Comisión plataforma</span><strong>{formatMoney(summary.commission, currency)}</strong></div>
          <div className="stat-card"><span >Por liquidar</span><strong>{formatMoney(summary.payout_pending, currency)}</strong></div>
        </div>
      ) : null}
    </Panel>
  );
}

function SettingsTab() {
  const queryClient = useQueryClient();
  const { token, tenantId } = useSession();
  const query = useMarketplaceSettingsQuery(token, tenantId);
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<{ enabled: boolean; markup: string; name: string } | null>(null);

  const settings = query.data;
  const form = draft ?? {
    enabled: settings?.enabled ?? false,
    markup: settings ? Number(settings.markup_percent).toFixed(2) : '10.00',
    name: settings?.store_display_name ?? ''
  };

  const saveMutation = useApiMutation((input: { enabled: boolean; markup: number; name: string }) =>
    updateMarketplaceSettings({
      enabled: input.enabled,
      markup_percent: input.markup,
      store_display_name: input.name
    })
  );

  return (
    <Panel className="stack full-width">
      <p className="muted">
        Publica tu catálogo en <strong>tienderu.com</strong>. Los productos con existencias se listan con un markup
        sobre tu precio (por defecto 10%); tú recibes el mismo valor de tu venta local.
      </p>
      {notice ? <Notice tone={/error|no |inválid/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {query.isError ? <Notice tone="error">No fue posible cargar la configuración del marketplace.</Notice> : null}
      {settings ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice('');
            saveMutation.mutate(
              { enabled: form.enabled, markup: Number(form.markup), name: form.name },
              {
                onSuccess: async () => {
                  setDraft(null);
                  setNotice('Configuración guardada.');
                  await queryClient.invalidateQueries({ queryKey: ['marketplace-settings'] });
                },
                onError: (error: Error) => setNotice(error.message)
              }
            );
          }}
        >
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setDraft({ ...form, enabled: event.target.checked })}
            />
            Vender en tienderu.com
          </label>
          <label>
            Markup sobre tu precio (%)
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={form.markup}
              onChange={(event) => setDraft({ ...form, markup: event.target.value })}
            />
          </label>
          <label>
            Nombre visible de tu tienda (opcional)
            <input
              type="text"
              maxLength={120}
              placeholder="Si lo dejas vacío se usa el nombre del negocio"
              value={form.name}
              onChange={(event) => setDraft({ ...form, name: event.target.value })}
            />
          </label>
          <button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </form>
      ) : null}
    </Panel>
  );
}
