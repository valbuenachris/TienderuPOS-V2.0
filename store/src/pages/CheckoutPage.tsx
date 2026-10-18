import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  apiRequest,
  formatMoney,
  type Address,
  type CheckoutResponse,
  type StoreConfig
} from '../api';
import { useAuth } from '../auth';
import { useCart } from '../cart';
import { AddressForm } from '../components/AddressForm';
import { Button, buttonStyles } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Icon } from '../components/ui/Icon';

export function CheckoutPage() {
  const { customer } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const addresses = useQuery({
    queryKey: ['store-addresses'],
    queryFn: () => apiRequest<Address[]>('/marketplace/addresses'),
    enabled: Boolean(customer)
  });

  const config = useQuery({
    queryKey: ['store-config'],
    queryFn: () => apiRequest<StoreConfig>('/marketplace/config'),
    staleTime: 10 * 60 * 1000
  });

  const shipping = Number(config.data?.shipping_flat ?? 0);
  const total = cart.total + shipping;
  const effectiveAddressId =
    selectedAddressId ??
    addresses.data?.find((address) => address.is_default)?.id ??
    addresses.data?.[0]?.id ??
    null;

  const checkout = useMutation({
    mutationFn: async () => {
      const response = await apiRequest<CheckoutResponse>('/marketplace/checkout', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
          address_id: effectiveAddressId
        })
      });
      return response;
    },
    onSuccess: (response) => {
      cart.clear();
      void queryClient.invalidateQueries({ queryKey: ['store-orders'] });
      if (response.payment_url) {
        window.location.href = response.payment_url;
      } else {
        navigate(`/pedidos/${response.id}`);
      }
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'No pudimos crear tu pedido.');
    }
  });

  if (!customer) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="user"
          title="Inicia sesión para continuar"
          action={
            <Link to="/ingresar?next=/checkout" className={buttonStyles({ variant: 'primary' })}>
              Ingresar
            </Link>
          }
        />
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="cart"
          title="Tu carrito está vacío"
          action={
            <Link to="/buscar" className={buttonStyles({ variant: 'primary' })}>
              Ir a comprar
            </Link>
          }
        />
      </div>
    );
  }

  const sellers = [...new Set(cart.items.map((item) => item.seller_name))];

  return (
    <div className="container-page py-6">
      <h1 className="mb-4 text-xl font-bold text-ink sm:text-2xl">Finalizar compra</h1>

      <div className="lg:grid lg:grid-cols-[1fr_330px] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-4">
          <section className="rounded-card bg-white p-4 shadow-card sm:p-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white">
                1
              </span>
              Dirección de envío
            </h2>

            {addresses.data && addresses.data.length === 0 && !showForm ? (
              <p className="mb-3 text-sm text-ink-soft">Aún no tienes direcciones guardadas.</p>
            ) : null}

            {addresses.data && addresses.data.length > 0 ? (
              <ul className="mb-3 flex flex-col gap-2">
                {addresses.data.map((address) => (
                  <li key={address.id}>
                    <label
                      className={`flex cursor-pointer items-start gap-3 rounded-card border p-3.5 text-sm transition-colors ${
                        effectiveAddressId === address.id
                          ? 'border-link-600 bg-sky-50/60'
                          : 'border-line bg-white hover:border-link-600/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="address"
                        className="mt-1 accent-[#007185]"
                        checked={effectiveAddressId === address.id}
                        onChange={() => setSelectedAddressId(address.id)}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <strong className="text-ink">{address.recipient_name}</strong>
                          <span className="rounded-full bg-line-soft px-2 py-0.5 text-xs text-ink-soft">
                            {address.label}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-ink/90">
                          {address.street_address}
                          {address.neighborhood ? `, ${address.neighborhood}` : ''} — {address.city}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-soft">Tel: {address.phone}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}

            <button
              type="button"
              className="text-sm font-semibold text-link-600 hover:text-link-700 hover:underline"
              onClick={() => setShowForm((value) => !value)}
            >
              {showForm ? 'Cancelar' : '+ Agregar nueva dirección'}
            </button>

            {showForm ? (
              <div className="mt-4 border-t border-line-soft pt-4">
                <AddressForm
                  defaultName={customer.name ?? ''}
                  defaultPhone={customer.phone ?? ''}
                  onCreated={(address) => {
                    void queryClient.invalidateQueries({ queryKey: ['store-addresses'] });
                    setSelectedAddressId(address.id);
                    setShowForm(false);
                  }}
                  onCancel={() => setShowForm(false)}
                />
              </div>
            ) : null}
          </section>

          <section className="rounded-card bg-white p-4 shadow-card sm:p-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white">
                2
              </span>
              Productos
            </h2>
            <ul className="flex flex-col divide-y divide-line-soft">
              {cart.items.map((item) => (
                <li key={item.product_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-ink">
                    <span className="font-semibold">{item.quantity}×</span> {item.name}
                  </span>
                  <span className="font-medium text-ink">
                    {formatMoney(Number(item.price) * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-soft">
              {sellers.length === 1
                ? `${sellers[0]} prepara y despacha tu pedido.`
                : `${sellers.join(', ')} preparan y despachan su parte del pedido.`}
            </p>
          </section>

          <section className="rounded-card bg-white p-4 shadow-card sm:p-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-800 text-xs font-bold text-white">
                3
              </span>
              Pago
            </h2>
            <div className="flex items-center gap-4 rounded-card border border-line bg-line-soft/50 p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-link-600 shadow-sm">
                <Icon name="credit-card" className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-ink">Tarjetas débito/crédito y PSE con Bold</p>
                <p className="text-xs text-ink-soft">
                  Pago 100% seguro. Serás redirigido a Bold para completar el pago.
                </p>
              </div>
            </div>
          </section>

          {error ? (
            <div className="rounded-md border border-deal-600/25 bg-red-50 px-4 py-3 text-sm text-price">
              {error}
            </div>
          ) : null}
        </div>

        <aside className="mt-4 rounded-card bg-white p-5 shadow-card lg:sticky lg:top-32 lg:mt-0">
          <h2 className="mb-4 text-lg font-bold text-ink">Resumen</h2>
          <div className="flex justify-between text-sm">
            <span className="text-ink-soft">Productos</span>
            <span className="font-medium text-ink">{formatMoney(cart.total)}</span>
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-ink-soft">Envío</span>
            <span className="font-medium text-ink">{shipping === 0 ? 'Gratis' : formatMoney(shipping)}</span>
          </div>
          <div className="mt-3 flex justify-between border-t border-line pt-3 text-lg font-bold text-price">
            <span>Total a pagar</span>
            <span>{formatMoney(total)}</span>
          </div>
          <Button
            size="lg"
            full
            className="mt-4"
            disabled={checkout.isPending || effectiveAddressId === null}
            onClick={() => {
              setError(null);
              checkout.mutate();
            }}
          >
            {checkout.isPending ? 'Creando pedido…' : 'Pagar con Bold'}
          </Button>
          {effectiveAddressId === null ? (
            <p className="mt-2 text-xs text-ink-soft">Agrega una dirección para continuar.</p>
          ) : null}
          <p className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
            <Icon name="shield" className="h-4 w-4 shrink-0" /> Al pagar aceptas los términos de tienderu.com
          </p>
        </aside>
      </div>
    </div>
  );
}
