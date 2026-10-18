import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, formatMoney, type Address, type CheckoutResponse, type StoreConfig } from '../api';
import { useAuth } from '../auth';
import { useCart } from '../cart';

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
      <div className="page empty-state">
        <h2>Inicia sesión para continuar</h2>
        <Link className="btn-primary" to="/ingresar?next=/checkout">
          Ingresar
        </Link>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="page empty-state">
        <h2>Tu carrito está vacío</h2>
        <Link className="btn-primary" to="/buscar">
          Ir a comprar
        </Link>
      </div>
    );
  }

  return (
    <div className="page checkout-layout">
      <section className="checkout-main">
        <h1>Finalizar compra</h1>

        <div className="checkout-step">
          <h2>1. Dirección de envío</h2>
          {addresses.data && addresses.data.length === 0 && !showForm && (
            <p className="muted">Aún no tienes direcciones guardadas.</p>
          )}
          {addresses.data && addresses.data.length > 0 && (
            <ul className="address-list select">
              {addresses.data.map((address) => (
                <li key={address.id}>
                  <label className={effectiveAddressId === address.id ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="address"
                      checked={effectiveAddressId === address.id}
                      onChange={() => setSelectedAddressId(address.id)}
                    />
                    <span>
                      <strong>{address.recipient_name}</strong> · {address.label}
                      <br />
                      {address.street_address}
                      {address.neighborhood ? `, ${address.neighborhood}` : ''} — {address.city}
                      <br />
                      <span className="muted">Tel: {address.phone}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link-button" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Cancelar' : '+ Agregar nueva dirección'}
          </button>
          {showForm && (
            <AddressForm
              defaultName={customer.name ?? ''}
              onCreated={(address) => {
                void queryClient.invalidateQueries({ queryKey: ['store-addresses'] });
                setSelectedAddressId(address.id);
                setShowForm(false);
              }}
            />
          )}
        </div>

        <div className="checkout-step">
          <h2>2. Productos</h2>
          <ul className="checkout-items">
            {cart.items.map((item) => (
              <li key={item.product_id}>
                <span>
                  {item.quantity} × {item.name}
                </span>
                <span>{formatMoney(Number(item.price) * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">{cart.items[0]?.seller_name} y otras tiendas preparan y despachan su parte del pedido.</p>
        </div>

        <div className="checkout-step">
          <h2>3. Pago</h2>
          <div className="payment-method">
            <span className="payment-logo">💳</span>
            <div>
              <strong>Tarjetas débito/crédito y PSE con Bold</strong>
              <p className="muted small">Pago 100% seguro. Serás redirigido a Bold para completar el pago.</p>
            </div>
          </div>
        </div>

        {error && <div className="notice error">{error}</div>}
      </section>

      <aside className="cart-summary">
        <h2>Resumen</h2>
        <div className="summary-row">
          <span>Productos</span>
          <span>{formatMoney(cart.total)}</span>
        </div>
        <div className="summary-row">
          <span>Envío</span>
          <span>{shipping === 0 ? 'Gratis' : formatMoney(shipping)}</span>
        </div>
        <div className="summary-row total">
          <span>Total a pagar</span>
          <span>{formatMoney(total)}</span>
        </div>
        <button
          type="button"
          className="btn-buy full"
          disabled={checkout.isPending || effectiveAddressId === null}
          onClick={() => {
            setError(null);
            checkout.mutate();
          }}
        >
          {checkout.isPending ? 'Creando pedido…' : 'Pagar con Bold'}
        </button>
        {effectiveAddressId === null && <p className="muted small">Agrega una dirección para continuar.</p>}
      </aside>
    </div>
  );
}

function AddressForm({
  defaultName,
  onCreated
}: {
  defaultName: string;
  onCreated: (address: Address) => void;
}) {
  const [recipient, setRecipient] = useState(defaultName);
  const [label, setLabel] = useState('Casa');
  const [street, setStreet] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('Bogotá');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const address = await apiRequest<Address>('/marketplace/addresses', {
        method: 'POST',
        body: JSON.stringify({
          recipient_name: recipient.trim(),
          label,
          street_address: street.trim(),
          ...(neighborhood.trim() !== '' ? { neighborhood: neighborhood.trim() } : {}),
          city: city.trim(),
          phone: phone.trim(),
          ...(notes.trim() !== '' ? { additional_notes: notes.trim() } : {})
        })
      });
      onCreated(address);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No pudimos guardar la dirección.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="address-form" onSubmit={submit}>
      {error && <div className="notice error">{error}</div>}
      <label>
        ¿Quién recibe?
        <input value={recipient} onChange={(event) => setRecipient(event.target.value)} required minLength={2} />
      </label>
      <label>
        Etiqueta
        <select value={label} onChange={(event) => setLabel(event.target.value)}>
          <option value="Casa">Casa</option>
          <option value="Trabajo">Trabajo</option>
          <option value="Otro">Otro</option>
        </select>
      </label>
      <label>
        Dirección
        <input
          value={street}
          onChange={(event) => setStreet(event.target.value)}
          placeholder="Calle 123 #45-67, apto 101"
          required
          minLength={5}
        />
      </label>
      <label>
        Barrio
        <input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} />
      </label>
      <label>
        Ciudad
        <input value={city} onChange={(event) => setCity(event.target.value)} required />
      </label>
      <label>
        Teléfono de contacto
        <input value={phone} onChange={(event) => setPhone(event.target.value)} required minLength={7} />
      </label>
      <label>
        Indicaciones (opcional)
        <input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} />
      </label>
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar dirección'}
      </button>
    </form>
  );
}
