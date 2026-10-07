import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Pagination, Panel } from '../components/ui';
import SaleTicket from '../components/SaleTicket';
import AddPaymentModal from '../components/AddPaymentModal';
import { useSession } from '../app/session';
import { useApiMutation, useCustomersQuery, useSaleDetailQuery, useSalesQuery } from '../pos-queries';
import { addSalePayment, deleteSale, updateSale } from '../api';
import type { AddSalePaymentPayload, SaleDetail, SaleListRow, SaleResult, UpdateSalePayload } from '../api';
import { paymentMethodLabel, saleStatusLabel } from '../payments';
import { formatDate, formatMoney } from '../format';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function remainingCents(sale: { grand_total: string | null; paid: string | null }): number {
  return Math.max(
    Math.round(Number(sale.grand_total ?? 0) * 100) - Math.round(Number(sale.paid ?? 0) * 100),
    0
  );
}

function buildTicketSale(detail: SaleDetail): SaleResult {
  return {
    id: detail.id,
    customer_name: detail.customer_name,
    customer_phone: detail.customer_phone ?? null,
    store_id: detail.store_id ?? 0,
    total: detail.total ?? '0.00',
    tax_total: detail.tax_total ?? '0.00',
    grand_total: detail.grand_total ?? '0.00',
    paid: detail.paid ?? '0.00',
    status: detail.status ?? 'due',
    paid_by: detail.payments.length === 1 ? detail.payments[0].paid_by : null,
    total_reward_points: detail.total_reward_points ?? 0,
    created_at: detail.created_at,
    items: detail.items.map((item) => ({
      product_id: item.product_id ?? 0,
      code: item.code,
      name: item.name,
      quantity: item.quantity ?? '0',
      unit_price: item.unit_price ?? '0',
      subtotal: item.subtotal ?? '0'
    }))
  };
}

const ERROR_NOTICE = /error|inválid|invalid|required|supera|no se puede|insuficiente|personalizados/i;

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
      <path d="M8 15h5" />
    </svg>
  );
}

function PaymentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01" />
      <path d="M18 12h.01" />
    </svg>
  );
}

export default function SalesHistoryPage() {
  const queryClient = useQueryClient();
  const { token, tenantId, settings, isAdmin, stores } = useSession();
  const currency = settings?.currency_prefix || '$';
  const [from, setFrom] = useState(() => isoDaysAgo(7));
  const [to, setTo] = useState(() => today());
  const [customerInput, setCustomerInput] = useState('');
  const [applied, setApplied] = useState(() => ({ from: isoDaysAgo(7), to: today(), customer: '' }));
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [viewId, setViewId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [paymentSale, setPaymentSale] = useState<SaleListRow | null>(null);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>({});
  const [customerDraft, setCustomerDraft] = useState<string | undefined>(undefined);
  const limit = 20;

  const sales = useSalesQuery(token, tenantId, applied.from, applied.to, page, limit, true, applied.customer);
  const viewQuery = useSaleDetailQuery(token, tenantId, viewId);
  const editQuery = useSaleDetailQuery(token, tenantId, editId);
  const ticketQuery = useSaleDetailQuery(token, tenantId, ticketId);
  const editStoreId = editQuery.data?.store_id ?? null;
  const customersQuery = useCustomersQuery(token, tenantId, editStoreId);

  const saveMutation = useApiMutation((input: { id: number; payload: UpdateSalePayload }) =>
    updateSale(input.id, input.payload)
  );
  const deleteMutation = useApiMutation((id: number) => deleteSale(id));
  const paymentMutation = useApiMutation((input: { id: number; payload: AddSalePaymentPayload }) =>
    addSalePayment(input.id, input.payload)
  );

  function money(value: string | number | null | undefined): string {
    return formatMoney(value, currency);
  }

  function applyFilters() {
    setPage(1);
    setApplied({ from, to, customer: customerInput.trim() });
  }

  function clearCustomer() {
    setCustomerInput('');
    setPage(1);
    setApplied((current) => ({ ...current, customer: '' }));
  }

  async function refreshSaleData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sales'] }),
      queryClient.invalidateQueries({ queryKey: ['sale-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['managed-products'] }),
      queryClient.invalidateQueries({ queryKey: ['sales-daily'] }),
      queryClient.invalidateQueries({ queryKey: ['report-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['report-calendar'] }),
      queryClient.invalidateQueries({ queryKey: ['report-top-products'] })
    ]);
  }

  function openView(saleId: number) {
    setNotice('');
    setViewId(saleId);
  }

  function openEdit(saleId: number) {
    setNotice('');
    setQuantityDrafts({});
    setCustomerDraft(undefined);
    setEditId(saleId);
  }

  function openTicket(saleId: number) {
    setNotice('');
    setTicketId(saleId);
  }

  function handleAddPayment(sale: SaleListRow) {
    setNotice('');
    setPaymentSale(sale);
  }

  function submitPayment(payload: AddSalePaymentPayload) {
    if (!paymentSale) return;
    paymentMutation.mutate({ id: paymentSale.id, payload }, {
      onSuccess: async (result) => {
        setNotice(`Pago registrado: ${formatMoney(result.amount, currency)} · Estado: ${saleStatusLabel(result.status)}.`);
        setPaymentSale(null);
        await refreshSaleData();
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function closeEdit() {
    setEditId(null);
    setQuantityDrafts({});
    setCustomerDraft(undefined);
  }

  function submitEdit() {
    const detail = editQuery.data;
    if (!detail) return;

    const lines: UpdateSalePayload['items'] = [];
    for (const item of detail.items) {
      if (item.product_id === null || item.product_id < 1) {
        setNotice('Esta venta contiene artículos personalizados y no puede editarse desde aquí.');
        return;
      }
      const value = (quantityDrafts[item.id] ?? item.quantity ?? '1').trim();
      if (!/^\d+$/.test(value) || Number(value) < 1) {
        setNotice('Las cantidades deben ser números enteros mayores a cero.');
        return;
      }
      lines.push({ product_id: item.product_id, quantity: String(Number(value)) });
    }
    if (lines.length === 0) {
      setNotice('La venta debe conservar al menos un artículo.');
      return;
    }

    const payload: UpdateSalePayload = { items: lines };
    if (customerDraft !== undefined) {
      payload.customer_id = customerDraft === '' ? null : Number(customerDraft);
    }

    saveMutation.mutate({ id: detail.id, payload }, {
      onSuccess: async () => {
        setNotice('Venta actualizada correctamente.');
        closeEdit();
        await refreshSaleData();
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  function handleDelete(saleId: number) {
    const confirmed = window.confirm(
      '¿Estás seguro de eliminar esta venta? Esta acción no se puede deshacer; el stock volverá a la tienda y se borrarán sus pagos.'
    );
    if (!confirmed) return;

    deleteMutation.mutate(saleId, {
      onSuccess: async () => {
        setNotice('Venta eliminada exitosamente.');
        if (viewId === saleId) setViewId(null);
        if (editId === saleId) closeEdit();
        await refreshSaleData();
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  const rows = sales.data?.data ?? [];
  const meta = sales.data?.meta;
  const ticketSale = ticketQuery.data ? buildTicketSale(ticketQuery.data) : null;
  const ticketStoreName = stores.find((store) => store.id === ticketSale?.store_id)?.name;
  const editItems = editQuery.data?.items ?? [];
  const hasCustomItems = editItems.some((item) => item.product_id === null || item.product_id < 1);
  const detailCustomerId = editQuery.data?.customer_id;
  const currentCustomerId = customerDraft ?? (detailCustomerId === null || detailCustomerId === undefined ? '' : String(detailCustomerId));

  return (
    <>
      <PageHeader eyebrow="OPERACIÓN" title="Historial de ventas" />
      {notice ? <Notice tone={ERROR_NOTICE.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      <Panel className="stack">
        <div className="toolbar">
          <label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label>Cliente
            <div className="filter-input">
              <input
                value={customerInput}
                onChange={(event) => setCustomerInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
                placeholder="Buscar por cliente…"
                aria-label="Buscar por cliente"
                maxLength={100}
              />
              {customerInput ? (
                <button
                  type="button"
                  className="filter-clear"
                  onClick={clearCustomer}
                  aria-label="Limpiar cliente"
                  title="Limpiar cliente"
                >
                  ✕
                </button>
              ) : null}
            </div>
          </label>
          <button className="primary" onClick={applyFilters} disabled={sales.isFetching}>Aplicar</button>
        </div>
        {applied.customer ? (
          <small className="muted">
            {meta?.total ?? 0} venta(s) encontradas para “{applied.customer}”.
          </small>
        ) : null}
        {sales.isError ? <Notice tone="error">No fue posible cargar las ventas.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Fecha</th><th>Cliente</th><th>Artículos</th><th>Subtotal</th>
                <th>Total</th><th>Pagado</th><th>Estado</th><th className="actions-col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.id}</td>
                  <td>{formatDate(sale.created_at)}</td>
                  <td>{sale.customer_name || 'Cliente ocasional'}</td>
                  <td>{sale.total_items ?? '—'}</td>
                  <td>{money(sale.total)}</td>
                  <td>{money(sale.grand_total)}</td>
                  <td>{money(sale.paid)}</td>
                  <td><span className={`badge ${sale.status ?? ''}`}>{saleStatusLabel(sale.status)}</span></td>
                  <td>
                    <div className="row-actions sale-actions">
                      <button
                        type="button"
                        className="sale-action-btn sale-action-btn--view"
                        title="Ver venta"
                        aria-label="Ver venta"
                        onClick={() => openView(sale.id)}
                      >
                        <EyeIcon />
                      </button>
                      <button
                        type="button"
                        className="sale-action-btn sale-action-btn--ticket"
                        title="Ver ticket"
                        aria-label="Ver ticket"
                        onClick={() => openTicket(sale.id)}
                      >
                        <TicketIcon />
                      </button>
                      {sale.status !== 'paid' && remainingCents(sale) > 0 ? (
                        <button
                          type="button"
                          className="sale-action-btn sale-action-btn--payment"
                          title="Agregar pago"
                          aria-label="Agregar pago"
                          onClick={() => handleAddPayment(sale)}
                        >
                          <PaymentIcon />
                        </button>
                      ) : null}
                      {isAdmin ? (
                        <button
                          type="button"
                          className="sale-action-btn sale-action-btn--edit"
                          title="Editar venta"
                          aria-label="Editar venta"
                          onClick={() => openEdit(sale.id)}
                        >
                          <PencilIcon />
                        </button>
                      ) : null}
                      {isAdmin ? (
                        <button
                          type="button"
                          className="sale-action-btn sale-action-btn--delete"
                          title="Eliminar venta"
                          aria-label="Eliminar venta"
                          onClick={() => handleDelete(sale.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <TrashIcon />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !sales.isPending ? (
                <tr><td colSpan={9} className="empty">No hay ventas en el rango seleccionado.</td></tr>
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

      <Modal
        open={viewId !== null}
        eyebrow="DETALLE DE VENTA"
        title={viewId === null ? '' : `Venta #${viewId}`}
        onClose={() => setViewId(null)}
      >
        {viewQuery.isPending ? <Notice>Cargando…</Notice> : null}
        {viewQuery.isError ? <Notice tone="error">No fue posible cargar el detalle de la venta.</Notice> : null}
        {viewQuery.data ? (
          <div className="stack">
            <div className="sale-detail-grid">
              <div><span>Cliente</span><strong>{viewQuery.data.customer_name || 'Cliente ocasional'}</strong></div>
              <div><span>Fecha</span><strong>{formatDate(viewQuery.data.created_at)}</strong></div>
              <div><span>Tienda</span><strong>{stores.find((store) => store.id === viewQuery.data?.store_id)?.name ?? '—'}</strong></div>
              <div><span>Estado</span><strong><span className={`badge ${viewQuery.data.status ?? ''}`}>{saleStatusLabel(viewQuery.data.status)}</span></strong></div>
              <div><span>Subtotal</span><strong>{money(viewQuery.data.total)}</strong></div>
              <div><span>Total</span><strong>{money(viewQuery.data.grand_total)}</strong></div>
              <div><span>Pagado</span><strong>{money(viewQuery.data.paid)}</strong></div>
              <div><span>Artículos</span><strong>{viewQuery.data.total_items ?? viewQuery.data.items.length}</strong></div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Código</th><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead>
                <tbody>
                  {viewQuery.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.code || '—'}</td>
                      <td>{item.name || '—'}</td>
                      <td>{item.quantity ?? '—'}</td>
                      <td>{money(item.unit_price)}</td>
                      <td>{money(item.subtotal)}</td>
                    </tr>
                  ))}
                  {viewQuery.data.items.length === 0 ? (
                    <tr><td colSpan={5} className="empty">Sin artículos registrados.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <h3 className="modal-section">Pagos</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Fecha</th><th>Forma de pago</th><th>Monto</th></tr></thead>
                <tbody>
                  {viewQuery.data.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{formatDate(payment.created_at)}</td>
                      <td>{paymentMethodLabel(payment.paid_by)}</td>
                      <td>{money(payment.amount)}</td>
                    </tr>
                  ))}
                  {viewQuery.data.payments.length === 0 ? (
                    <tr><td colSpan={3} className="empty">Sin pagos registrados.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={editId !== null}
        eyebrow="EDITAR VENTA"
        title={editId === null ? '' : `Venta #${editId}`}
        onClose={closeEdit}
      >
        {editQuery.isPending ? <Notice>Cargando…</Notice> : null}
        {editQuery.isError ? <Notice tone="error">No fue posible cargar la venta.</Notice> : null}
        {editQuery.data ? (
          <div className="stack">
            {hasCustomItems ? (
              <Notice tone="error">Esta venta contiene artículos personalizados y no puede editarse desde el POS V2.</Notice>
            ) : null}
            <label>Cliente
              <select
                value={currentCustomerId}
                onChange={(event) => setCustomerDraft(event.target.value)}
                disabled={hasCustomItems}
              >
                <option value="">Cliente ocasional</option>
                {(customersQuery.data ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name || `Cliente #${customer.id}`}</option>
                ))}
              </select>
            </label>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal actual</th></tr></thead>
                <tbody>
                  {editItems.map((item) => {
                    const value = quantityDrafts[item.id] ?? item.quantity ?? '1';
                    return (
                      <tr key={item.id}>
                        <td>{item.name || item.code || `Producto #${item.product_id ?? '—'}`}</td>
                        <td>
                          <input
                            className="qty-input"
                            type="number"
                            min={1}
                            step={1}
                            value={value}
                            onChange={(event) => setQuantityDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                            disabled={hasCustomItems}
                          />
                        </td>
                        <td>{money(item.unit_price)}</td>
                        <td>{money(item.subtotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted-note">
              Solo se ajustan cantidades; se conservan los precios de la venta y el stock se recalcula automáticamente.
            </p>
            <button
              className="primary"
              type="button"
              onClick={submitEdit}
              disabled={saveMutation.isPending || hasCustomItems}
            >
              {saveMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={ticketId !== null}
        eyebrow="TICKET"
        title={ticketId === null ? '' : `Ticket · Venta #${ticketId}`}
        className="ticket-modal"
        onClose={() => setTicketId(null)}
      >
        {ticketQuery.isPending ? <Notice>Cargando…</Notice> : null}
        {ticketQuery.isError ? <Notice tone="error">No fue posible cargar el ticket.</Notice> : null}
        {ticketSale ? (
          <SaleTicket
            sale={ticketSale}
            currency={currency}
            siteName={settings?.site_name}
            storeName={ticketStoreName}
            logoUrl={settings?.logo_url}
            address={settings?.address}
            phone={settings?.phone}
            nit={settings?.nit}
            thankYouMessage={settings?.thank_you_message}
            returnPolicy={settings?.return_policy}
            showQr={settings?.show_qr_on_ticket !== false}
            printerWidth={settings?.printer_width === '80mm' ? '80mm' : '58mm'}
            preview
          />
        ) : null}
      </Modal>

      {ticketSale ? (
        <SaleTicket
          sale={ticketSale}
          currency={currency}
          siteName={settings?.site_name}
          storeName={ticketStoreName}
          logoUrl={settings?.logo_url}
          address={settings?.address}
          phone={settings?.phone}
          nit={settings?.nit}
          thankYouMessage={settings?.thank_you_message}
          returnPolicy={settings?.return_policy}
          showQr={settings?.show_qr_on_ticket !== false}
          printerWidth={settings?.printer_width === '80mm' ? '80mm' : '58mm'}
        />
      ) : null}

      {paymentSale ? (
        <AddPaymentModal
          sale={paymentSale}
          currency={currency}
          submitting={paymentMutation.isPending}
          onClose={() => setPaymentSale(null)}
          onConfirm={submitPayment}
        />
      ) : null}
    </>
  );
}
