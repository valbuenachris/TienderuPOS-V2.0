import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, formatMoney, type StoreConfig } from '../api';
import { useAuth } from '../auth';
import { useCart } from '../cart';
import { Button, buttonStyles } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';
import { Select } from '../components/ui/Input';

export function CartPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const { customer } = useAuth();

  const config = useQuery({
    queryKey: ['store-config'],
    queryFn: () => apiRequest<StoreConfig>('/marketplace/config'),
    staleTime: 10 * 60 * 1000
  });

  const shipping = Number(config.data?.shipping_flat ?? 0);
  const total = cart.total + (cart.items.length > 0 ? shipping : 0);

  const bySeller = new Map<string, typeof cart.items>();
  for (const item of cart.items) {
    const group = bySeller.get(item.seller_id);
    if (group) group.push(item);
    else bySeller.set(item.seller_id, [item]);
  }

  if (cart.items.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="cart"
          title="Tu carrito está vacío"
          description="Explora el catálogo y agrega productos de tus tiendas favoritas."
          action={
            <Link to="/buscar" className={buttonStyles({ variant: 'primary' })}>
              Ir a comprar
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-page py-6">
      <h1 className="mb-4 text-xl font-bold text-ink sm:text-2xl">
        Carrito de compras <span className="text-sm font-normal text-ink-soft">({cart.count} productos)</span>
      </h1>

      <div className="lg:grid lg:grid-cols-[1fr_330px] lg:items-start lg:gap-6">
        <section className="rounded-card bg-white p-4 shadow-card sm:p-6">
          {[...bySeller.entries()].map(([sellerId, items]) => (
            <div key={sellerId} className="border-t border-line-soft pt-4 first:border-t-0 first:pt-0 [&+&]:mt-4">
              <p className="mb-3 text-sm text-ink-soft">
                Vendido por{' '}
                <Link to={`/vendedor/${sellerId}`} className="font-semibold text-link-600 hover:underline">
                  {items[0]?.seller_name}
                </Link>
              </p>
              <ul className="flex flex-col divide-y divide-line-soft">
                {items.map((item) => (
                  <li key={item.product_id} className="flex gap-4 py-4 first:pt-0">
                    <Link
                      to={`/producto/${item.product_id}`}
                      className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-white p-1"
                    >
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-2xl" aria-hidden="true">
                          🛍️
                        </span>
                      )}
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Link
                        to={`/producto/${item.product_id}`}
                        className="line-clamp-2 text-sm font-semibold text-ink hover:text-link-600"
                      >
                        {item.name}
                      </Link>
                      <p className="text-sm font-semibold text-price">{formatMoney(item.price)} c/u</p>
                      <div className="mt-auto flex items-center gap-4 text-sm">
                        <label className="flex items-center gap-2 text-ink-soft">
                          Cant.
                          <span className="w-20">
                            <Select
                              value={item.quantity}
                              onChange={(event) =>
                                cart.setQuantity(item.product_id, Number(event.target.value))
                              }
                              aria-label={`Cantidad de ${item.name}`}
                            >
                              {Array.from({ length: Math.min(10, item.available_quantity) }).map((_, index) => (
                                <option key={index + 1} value={index + 1}>
                                  {index + 1}
                                </option>
                              ))}
                            </Select>
                          </span>
                        </label>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-medium text-link-600 hover:text-link-700 hover:underline"
                          onClick={() => cart.removeItem(item.product_id)}
                        >
                          <Icon name="trash" className="h-4 w-4" /> Eliminar
                        </button>
                      </div>
                    </div>
                    <p className="min-w-20 text-right text-base font-bold text-ink">
                      {formatMoney(Number(item.price) * item.quantity)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <aside className="mt-4 rounded-card bg-white p-5 shadow-card lg:sticky lg:top-32 lg:mt-0">
          <h2 className="mb-4 text-lg font-bold text-ink">Resumen del pedido</h2>
          <div className="flex justify-between text-sm">
            <span className="text-ink-soft">Productos</span>
            <span className="font-medium text-ink">{formatMoney(cart.total)}</span>
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-ink-soft">Envío</span>
            <span className="font-medium text-ink">{shipping === 0 ? 'Gratis' : formatMoney(shipping)}</span>
          </div>
          <div className="mt-3 flex justify-between border-t border-line pt-3 text-lg font-bold text-price">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
          <Button
            size="lg"
            full
            className="mt-4"
            onClick={() => navigate(customer ? '/checkout' : '/ingresar?next=/checkout')}
          >
            Finalizar compra
          </Button>
          {!customer ? (
            <p className="mt-2 text-xs text-ink-soft">Inicia sesión para completar tu compra.</p>
          ) : null}
          <p className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
            <Icon name="shield" className="h-4 w-4 shrink-0" /> Pago seguro con tarjetas y PSE (Bold)
          </p>
        </aside>
      </div>
    </div>
  );
}
