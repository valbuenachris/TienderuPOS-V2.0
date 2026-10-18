import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Notice, PageHeader, Pagination, Panel } from '../components/ui';
import AddPaymentModal from '../components/AddPaymentModal';
import { useSession } from '../app/session';
import { useApiMutation, useOpenAccountsQuery, useSaleDetailQuery } from '../pos-queries';
import { addSalePayment } from '../api';
import type { AddSalePaymentPayload, SaleListRow } from '../api';
import { saleStatusLabel } from '../payments';
import { formatDate, formatMoney } from '../format';

function pendingOf(sale: { grand_total: string | null; paid: string | null }): number {
  return Math.max(Number(sale.grand_total ?? 0) - Number(sale.paid ?? 0), 0);
}

export default function OpenAccountsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || 'COP';
  const [label, setLabel] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [paySale, setPaySale] = useState<SaleListRow | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);

  const accountsQuery = useOpenAccountsQuery(token, tenantId, page, 20, applied);
  const detailQuery = useSaleDetailQuery(token, tenantId, viewId);
  const payMutation = useApiMutation((input: { id: number; payload: AddSalePaymentPayload }) =>
    addSalePayment(input.id, input.payload)
  );

  const money = (value: string | number | null | undefined) => formatMoney(value, currency);
  const rows = accountsQuery.data?.data ?? [];
  const meta = accountsQuery.data?.meta;
  const view = detailQuery.data;

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setApplied(label.trim());
  }

  function submitPayment(payload: AddSalePaymentPayload) {
    if (!paySale) return;
    payMutation.mutate({ id: paySale.id, payload }, {
      onSuccess: async (result) => {
        setPaySale(null);
        setNotice(`Pago registrado: ${money(result.amount)} · Estado: ${saleStatusLabel(result.status)}.`);
        await queryClient.invalidateQueries({ queryKey: ['open-accounts'] });
        await queryClient.invalidateQueries({ queryKey: ['sales'] });
        if (viewId !== null) {
          await queryClient.invalidateQueries({ queryKey: ['sale-detail', tenantId, viewId] });
        }
      },
      onError: (error: Error) => {
        setPaySale(null);
        setNotice(error.message);
      }
    });
  }

  function chargeAccount() {
    const row = rows.find((sale) => sale.id === view?.id);
    setViewId(null);
    if (row) setPaySale(row);
  }

  return (
    <>
      <PageHeader
        eyebrow="PUNTO DE VENTA"
        title="Cuentas abiertas"
        actions={<button className="primary" type="button" onClick={() => navigate('/pos')}>Ir al POS</button>}
      />
      <Panel className="stack full-width">
        <p className="muted">
          Ventas pendientes de pago (mesas, clientes frecuentes, cuentas por cobrar). Puedes cobrar total o
          parcialmente y agregar productos a la cuenta desde el POS.
        </p>
        <form className="toolbar" onSubmit={applySearch}>
          <label>Buscar por etiqueta
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Mesa, nombre…"
              maxLength={100}
            />
          </label>
          <button className="primary" type="submit" disabled={accountsQuery.isFetching}>Buscar</button>
          {applied ? (
            <button className="quiet" type="button" onClick={() => { setLabel(''); setApplied(''); setPage(1); }}>
              Limpiar
            </button>
          ) : null}
        </form>
        {notice ? <Notice>{notice}</Notice> : null}
        {accountsQuery.isError ? <Notice tone="error">No fue posible cargar las cuentas abiertas.</Notice> : null}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>Cuenta</th><th>Abierta</th><th>Artículos</th>
                <th>Total</th><th>Pagado</th><th>Pendiente</th><th>Estado</th><th className="actions-col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.id}</td>
                  <td><strong>{sale.customer_name || 'Sin etiqueta'}</strong></td>
                  <td>{formatDate(sale.created_at)}</td>
                  <td>{sale.total_items ?? '—'}</td>
                  <td className="money-cell">{money(sale.grand_total)}</td>
                  <td className="money-cell">{money(sale.paid)}</td>
                  <td className="money-cell">{money(pendingOf(sale))}</td>
                  <td><span className={`badge ${sale.status ?? ''}`}>{saleStatusLabel(sale.status)}</span></td>
                  <td>
                    <div className="row-actions sale-actions">
                      <button
                        className="sale-action-btn sale-action-btn--payment"
                        type="button"
                        title="Cobrar"
                        aria-label="Cobrar"
                        onClick={() => { setNotice(''); setPaySale(sale); }}
                      >
                        💵
                      </button>
                      <button
                        className="sale-action-btn sale-action-btn--view"
                        type="button"
                        title="Ver cuenta"
                        aria-label="Ver cuenta"
                        onClick={() => setViewId(sale.id)}
                      >
                        👁️
                      </button>
                      <button
                        className="sale-action-btn sale-action-btn--edit"
                        type="button"
                        title="Agregar productos"
                        aria-label="Agregar productos"
                        onClick={() => navigate(`/pos?cuenta=${sale.id}`)}
                      >
                        ➕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !accountsQuery.isPending ? (
                <tr>
                  <td colSpan={9} className="empty">No hay cuentas abiertas{applied ? ` para “${applied}”` : ''}.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={meta?.totalPages ?? 0} total={meta?.total ?? 0} onChange={setPage} />
      </Panel>

      {paySale ? (
        <AddPaymentModal
          sale={paySale}
          currency={currency}
          submitting={payMutation.isPending}
          onClose={() => setPaySale(null)}
          onConfirm={submitPayment}
        />
      ) : null}

      <Modal
        open={viewId !== null}
        eyebrow="CUENTA ABIERTA"
        title={view ? `Cuenta #${view.id} · ${view.customer_name || 'Sin etiqueta'}` : `Cuenta #${viewId ?? ''}`}
        onClose={() => setViewId(null)}
      >
        <div className="stack">
          {detailQuery.isPending ? <Notice>Cargando…</Notice> : null}
          {view ? (
            <>
              <div className="sale-detail-grid">
                <div><span>Abierta</span><strong>{formatDate(view.created_at)}</strong></div>
                <div><span>Cajero</span><strong>{view.cashier_name || '—'}</strong></div>
                <div><span>Estado</span><strong><span className={`badge ${view.status ?? ''}`}>{saleStatusLabel(view.status)}</span></strong></div>
                <div><span>Total</span><strong>{money(view.grand_total)}</strong></div>
                <div><span>Pagado</span><strong>{money(view.paid)}</strong></div>
                <div><span>Pendiente</span><strong>{money(pendingOf(view))}</strong></div>
              </div>
              <div className="table-wrap confirm-products">
                <table className="data-table">
                  <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
                  <tbody>
                    {view.items.map((item, index) => (
                      <tr key={`${item.product_id ?? 'item'}-${index}`}>
                        <td>{item.name || item.code || `#${item.product_id ?? '—'}`}</td>
                        <td>{item.quantity ?? '—'}</td>
                        <td>{money(item.unit_price)}</td>
                        <td>{money(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-actions">
                <button className="quiet" type="button" onClick={() => setViewId(null)}>Cerrar</button>
                <button className="primary" type="button" onClick={chargeAccount}>Cobrar</button>
              </div>
            </>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
