import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  apiRequest,
  formatDate,
  formatMoney,
  type Order,
  type OrderWithSuborders,
  type Paginated
} from '../api';
import { buttonStyles } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { OrderStatusBadge } from '../components/ui/Badge';
import { Icon } from '../components/ui/Icon';
import { Pagination } from '../components/ui/Pagination';
import { PageSkeleton } from '../components/ui/Skeleton';

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['store-orders', page],
    queryFn: () =>
      apiRequest<Paginated<OrderWithSuborders>>(`/marketplace/account/orders?page=${page}&limit=10`)
  });

  if (isLoading) return <PageSkeleton />;

  if (isError || !data) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="alert"
          title="No pudimos cargar tus pedidos"
          description="Intenta de nuevo en unos minutos."
        />
      </div>
    );
  }

  if (data.data.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="package"
          title="Aún no tienes pedidos"
          description="Cuando compres en tienderu.com, tus pedidos aparecerán aquí."
          action={
            <Link to="/buscar" className={buttonStyles({ variant: 'primary' })}>
              Explorar la tienda
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-page py-6">
      <h1 className="mb-4 text-xl font-bold text-ink sm:text-2xl">Mis pedidos</h1>
      <ul className="flex flex-col gap-4">
        {data.data.map((order) => (
          <li key={order.id} className="rounded-card bg-white p-4 shadow-card sm:p-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-line-soft pb-3">
              <div>
                <p className="text-xs text-ink-soft">Pedido</p>
                <p className="text-sm font-bold text-ink">{order.order_number}</p>
              </div>
              <div>
                <p className="text-xs text-ink-soft">Fecha</p>
                <p className="text-sm font-medium text-ink">{formatDate(order.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-soft">Total</p>
                <p className="text-sm font-bold text-price">{formatMoney(order.grand_total)}</p>
              </div>
              <div className="ml-auto">
                <OrderStatusBadge status={order.status} />
              </div>
            </div>
            <div className="flex flex-wrap gap-3 py-3 text-xs text-ink-soft">
              {order.suborders.map((suborder) => (
                <span key={suborder.id} className="inline-flex items-center gap-1.5">
                  <Icon name="store" className="h-3.5 w-3.5" />
                  {suborder.tenant_name}: {suborder.status === 'delivered' ? 'Entregado' : suborder.status === 'shipped' ? 'Enviado' : suborder.status === 'preparing' ? 'Preparando' : suborder.status === 'paid' ? 'Pagado' : 'Pago pendiente'}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {order.payment_status !== 'paid' ? (
                <p className="text-xs text-warn-700">
                  Pago pendiente — abre el detalle para reintentar el pago.
                </p>
              ) : (
                <span />
              )}
              <Link to={`/pedidos/${order.id}`} className={buttonStyles({ variant: 'primary', size: 'sm' })}>
                Ver detalle
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <Pagination
        className="mt-8"
        page={page}
        totalPages={data.meta.totalPages}
        onChange={(nextPage) => {
          const next = new URLSearchParams(params);
          next.set('page', String(nextPage));
          setParams(next);
        }}
      />
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

  if (isLoading) return <PageSkeleton />;

  if (isError || !data) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="package"
          title="Pedido no encontrado"
          action={
            <Link to="/pedidos" className={buttonStyles({ variant: 'outline' })}>
              Volver a mis pedidos
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-page py-6">
      <Link
        to="/pedidos"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-link-600 hover:text-link-700 hover:underline"
      >
        <Icon name="chevron-left" className="h-4 w-4" /> Volver a mis pedidos
      </Link>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-ink sm:text-2xl">Pedido {data.order_number}</h1>
        <OrderStatusBadge status={data.status} />
      </div>
      <p className="mb-4 text-sm text-ink-soft">
        Realizado el {formatDate(data.created_at)} · Pago:{' '}
        {data.payment_status === 'paid' ? 'confirmado' : 'pendiente'}
      </p>

      {data.payment_status !== 'paid' && data.checkout_url ? (
        <a href={data.checkout_url} className={`${buttonStyles({ variant: 'primary' })} mb-4`}>
          Completar pago con Bold
        </a>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card bg-white p-5 shadow-card">
          <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-ink">
            <Icon name="map-pin" className="h-4 w-4 text-link-600" /> Envío
          </h2>
          <p className="text-sm leading-relaxed text-ink/90">
            <strong>{data.shipping_recipient}</strong>
            <br />
            {data.shipping_address}
            {data.shipping_neighborhood ? `, ${data.shipping_neighborhood}` : ''} — {data.shipping_city}
            <br />
            Tel: {data.shipping_phone}
            {data.shipping_notes ? (
              <>
                <br />
                <span className="text-xs text-ink-soft">Indicaciones: {data.shipping_notes}</span>
              </>
            ) : null}
          </p>
        </section>
        <section className="rounded-card bg-white p-5 shadow-card">
          <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-ink">
            <Icon name="credit-card" className="h-4 w-4 text-link-600" /> Resumen
          </h2>
          <div className="flex justify-between text-sm">
            <span className="text-ink-soft">Productos</span>
            <span className="font-medium text-ink">{formatMoney(data.products_total)}</span>
          </div>
          <div className="mt-1.5 flex justify-between text-sm">
            <span className="text-ink-soft">Envío</span>
            <span className="font-medium text-ink">
              {Number(data.shipping_total) === 0 ? 'Gratis' : formatMoney(data.shipping_total)}
            </span>
          </div>
          <div className="mt-2.5 flex justify-between border-t border-line pt-2.5 text-base font-bold text-price">
            <span>Total</span>
            <span>{formatMoney(data.grand_total)}</span>
          </div>
        </section>
      </div>

      <h2 className="mb-3 mt-6 text-lg font-bold text-ink">Productos por tienda</h2>
      <div className="flex flex-col gap-4">
        {data.suborders.map((suborder) => (
          <section key={suborder.id} className="rounded-card bg-white p-5 shadow-card">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink">
                {suborder.tenant_name}
                <span className="ml-2 text-xs font-normal text-ink-soft">{suborder.suborder_number}</span>
              </p>
              <OrderStatusBadge status={suborder.status} kind="suborder" />
            </header>
            <ul className="flex flex-col divide-y divide-line-soft">
              {suborder.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-soft bg-white">
                    {item.product_image ? (
                      <img src={item.product_image} alt="" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span aria-hidden="true">🛍️</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-ink">
                    {item.product_name} <span className="text-ink-soft">× {item.quantity}</span>
                  </span>
                  <span className="text-sm font-semibold text-ink">{formatMoney(item.line_total)}</span>
                </li>
              ))}
            </ul>
            {suborder.tracking_note ? (
              <p className="mt-2 text-xs text-ink-soft">Nota del vendedor: {suborder.tracking_note}</p>
            ) : null}
            {suborder.shipped_at ? (
              <p className="mt-2 text-xs text-success-600">
                Enviado el {formatDate(suborder.shipped_at)}
                {suborder.delivered_at ? ` · Entregado el ${formatDate(suborder.delivered_at)}` : ''}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
