import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Notice, Pagination, Panel } from '../../components/ui';
import { useSession } from '../../app/session';
import { useApiMutation, useAppOrdersQuery } from '../../pos-queries';
import { updateAppOrderDelivery } from '../../api';
import { formatDate, formatMoney } from '../../format';
import { paymentMethodLabel, saleStatusLabel } from '../../payments';

const DELIVERY_OPTIONS = [
  { value: '', label: 'Sin estado' },
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'enviado', label: 'Enviado' },
  { value: 'entregado', label: 'Entregado' },
  { value: 'cancelado', label: 'Cancelado' }
];

export default function AppOrdersTab() {
  const queryClient = useQueryClient();
  const { token, tenantId, settings } = useSession();
  const currency = settings?.currency_prefix || '$';
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const query = useAppOrdersQuery(token, tenantId, page, 20);

  const deliveryMutation = useApiMutation((input: { id: number; status: string }) =>
    updateAppOrderDelivery(input.id, input.status)
  );

  const rows = query.data?.data ?? [];

  function changeDelivery(id: number, status: string) {
    setNotice('');
    deliveryMutation.mutate({ id, status }, {
      onSuccess: async () => {
        setNotice(`Pedido #${id}: estado de entrega actualizado.`);
        await queryClient.invalidateQueries({ queryKey: ['admin-app-orders'] });
      },
      onError: (error: Error) => setNotice(error.message)
    });
  }

  return (
    <Panel className="stack full-width">
      <p className="muted">Pedidos creados desde la app móvil (sin cajero asignado). Cambia el estado de entrega según avance el despacho.</p>
      {notice ? <Notice tone={/error|no fue|inválid|invalid|no se/i.test(notice) ? 'error' : 'success'}>{notice}</Notice> : null}
      {query.isError ? <Notice tone="error">No fue posible cargar los pedidos de la app.</Notice> : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>#</th><th>Cliente</th><th>Total</th><th>Pago</th><th>Estado</th><th>Entrega</th><th>Fecha</th></tr>
          </thead>
          <tbody>
            {rows.map((order) => (
              <tr key={order.id}>
                <td>#{order.id}</td>
                <td>{order.customer_name || 'Cliente ocasional'}</td>
                <td className="money-cell">
                  {order.payment_method === 'points'
                    ? <span className="badge paid">Canje de Puntos</span>
                    : formatMoney(order.grand_total, currency)}
                </td>
                <td>{order.payment_method ? paymentMethodLabel(order.payment_method) : '—'}</td>
                <td><span className={`badge ${order.status === 'paid' ? 'paid' : order.status === 'partial' ? 'partial' : 'due'}`}>{saleStatusLabel(order.status)}</span></td>
                <td>
                  <select
                    value={order.status_delivery ?? ''}
                    disabled={deliveryMutation.isPending}
                    onChange={(event) => changeDelivery(order.id, event.target.value)}
                    aria-label={`Estado de entrega del pedido ${order.id}`}
                  >
                    {DELIVERY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </td>
                <td>{formatDate(order.created_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && !query.isPending ? (
              <tr><td colSpan={7} className="empty">No hay pedidos de la app todavía.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {query.data ? (
        <Pagination
          page={query.data.meta.page}
          totalPages={query.data.meta.totalPages}
          total={query.data.meta.total}
          onChange={setPage}
        />
      ) : null}
    </Panel>
  );
}
