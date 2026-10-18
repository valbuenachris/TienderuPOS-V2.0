import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  apiRequest,
  formatDate,
  formatMoney,
  ORDER_STATUS_LABELS,
  SUBORDER_STATUS_LABELS,
  type OrderWithSuborders,
  type Paginated,
  type Order
} from '../api';

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['store-orders', page],
    queryFn: () => apiRequest<Paginated<OrderWithSuborders>>(`/marketplace/account/orders?page=${page}&limit=10`)
  });

  if (isLoading) {
    return (
      <div className="page">
        <h1>Mis pedidos</h1>
        <div className="skeleton-line skeleton" />
        <div className="skeleton-line skeleton" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="page empty-state">
        <h2>No pudimos cargar tus pedidos</h2>
        <p>Intenta de nuevo en unos minutos.</p>
      </div>
    );
  }

  if (data.data.length === 0) {
    return (
      <div className="page empty-state">
        <h2>Aún no tienes pedidos</h2>
        <p>Cuando compres en tienderu.com, tus pedidos aparecerán aquí.</p>
        <Link className="btn-primary" to="/buscar">
          Explorar la tienda
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Mis pedidos</h1>
      <ul className="orders-list">
        {data.data.map((order) => (
          <li key={order.id} className="order-card">
            <div className="order-card-head">
              <div>
                <span className="muted small">Pedido</span>
                <strong>{order.order_number}</strong>
              </div>
              <div>
                <span className="muted small">Fecha</span>
                <strong>{formatDate(order.created_at)}</strong>
              </div>
              <div>
                <span className="muted small">Total</span>
                <strong>{formatMoney(order.grand_total)}</strong>
              </div>
              <div>
                <span className={order.payment_status === 'paid' ? 'status-badge paid' : 'status-badge pending'}>
                  {ORDER_STATUS_LABELS[order.status] ?? order.status}
                </span>
              </div>
            </div>
            <div className="order-card-sellers">
              {order.suborders.map((suborder) => (
                <span key={suborder.id} className="seller-status">
                  {suborder.tenant_name}: {SUBORDER_STATUS_LABELS[suborder.status] ?? suborder.status}
                </span>
              ))}
            </div>
            <div className="order-card-actions">
              {order.payment_status !== 'paid' && (
                <span className="muted small">Pago pendiente — revisa tu pedido para reintentar el pago.</span>
              )}
              <Link to={`/pedidos/${order.id}`} className="btn-primary small">
                Ver detalle
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {data.meta.totalPages > 1 && (
        <nav className="pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('page', String(page - 1));
              setParams(next);
            }}
          >
            Anterior
          </button>
          <span>
            Página {page} de {data.meta.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= data.meta.totalPages}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('page', String(page + 1));
              setParams(next);
            }}
          >
            Siguiente
          </button>
        </nav>
      )}
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number(id);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['store-order', orderId],
    queryFn: () => apiRequest<OrderWithSuborders>(`/marketplace/account/orders/${orderId}`),
    enabled: Number.isSafeInteger(orderId) && orderId > 0,
    refetchInterval: (query) => {
      const order = query.state.data as Order | undefined;
      return order && order.payment_status !== 'paid' ? 8000 : false;
    }
  });

  if (isLoading) {
    return (
      <div className="page">
        <div className="skeleton-line skeleton" />
        <div className="skeleton-line skeleton" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="page empty-state">
        <h2>Pedido no encontrado</h2>
        <Link to="/pedidos">Volver a mis pedidos</Link>
      </div>
    );
  }

  return (
    <div className="page order-detail">
      <Link to="/pedidos" className="link-button">
        ← Volver a mis pedidos
      </Link>
      <h1>
        Pedido {data.order_number}{' '}
        <span className={data.payment_status === 'paid' ? 'status-badge paid' : 'status-badge pending'}>
          {ORDER_STATUS_LABELS[data.status] ?? data.status}
        </span>
      </h1>
      <p className="muted">
        Realizado el {formatDate(data.created_at)} · Pago: {data.payment_status === 'paid' ? 'confirmado' : 'pendiente'}
      </p>
      {data.payment_status !== 'paid' && data.checkout_url && (
        <a className="btn-buy" href={data.checkout_url}>
          Completar pago con Bold
        </a>
      )}

      <div className="order-detail-grid">
        <section>
          <h2>Envío</h2>
          <p>
            <strong>{data.shipping_recipient}</strong>
            <br />
            {data.shipping_address}
            {data.shipping_neighborhood ? `, ${data.shipping_neighborhood}` : ''} — {data.shipping_city}
            <br />
            Tel: {data.shipping_phone}
            {data.shipping_notes ? (
              <>
                <br />
                <span className="muted">Indicaciones: {data.shipping_notes}</span>
              </>
            ) : null}
          </p>
        </section>
        <section>
          <h2>Resumen</h2>
          <div className="summary-row">
            <span>Productos</span>
            <span>{formatMoney(data.products_total)}</span>
          </div>
          <div className="summary-row">
            <span>Envío</span>
            <span>{Number(data.shipping_total) === 0 ? 'Gratis' : formatMoney(data.shipping_total)}</span>
          </div>
          <div className="summary-row total">
            <span>Total</span>
            <span>{formatMoney(data.grand_total)}</span>
          </div>
        </section>
      </div>

      <h2>Productos por tienda</h2>
      {data.suborders.map((suborder) => (
        <section key={suborder.id} className="suborder-card">
          <header>
            <div>
              <strong>{suborder.tenant_name}</strong>
              <span className="muted"> · {suborder.suborder_number}</span>
            </div>
            <span className={suborder.status === 'delivered' ? 'status-badge paid' : 'status-badge pending'}>
              {SUBORDER_STATUS_LABELS[suborder.status] ?? suborder.status}
            </span>
          </header>
          <ul>
            {suborder.items.map((item) => (
              <li key={item.id}>
                <span className="suborder-item-image">
                  {item.product_image ? <img src={item.product_image} alt={item.product_name} /> : '🛍️'}
                </span>
                <span className="suborder-item-name">
                  {item.product_name} <span className="muted">× {item.quantity}</span>
                </span>
                <span>{formatMoney(item.line_total)}</span>
              </li>
            ))}
          </ul>
          {suborder.tracking_note && <p className="muted small">Nota del vendedor: {suborder.tracking_note}</p>}
        </section>
      ))}
    </div>
  );
}
