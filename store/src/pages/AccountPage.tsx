import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, type Address, type MarketplaceCustomer } from '../api';
import { useAuth } from '../auth';

export function AccountPage() {
  const { customer } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addresses = useQuery({
    queryKey: ['store-addresses'],
    queryFn: () => apiRequest<Address[]>('/marketplace/addresses'),
    enabled: Boolean(customer)
  });

  const saveProfile = useMutation({
    mutationFn: () =>
      apiRequest<MarketplaceCustomer>('/marketplace/account', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() })
      }),
    onSuccess: () => {
      setMessage('Datos actualizados.');
      setError(null);
      window.setTimeout(() => setMessage(null), 2500);
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'No pudimos guardar tus datos.');
    }
  });

  const removeAddress = useMutation({
    mutationFn: (id: number) => apiRequest(`/marketplace/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['store-addresses'] })
  });

  const setDefault = useMutation({
    mutationFn: (id: number) => apiRequest(`/marketplace/addresses/${id}/set-default`, { method: 'PUT' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['store-addresses'] })
  });

  function submitProfile(event: FormEvent) {
    event.preventDefault();
    saveProfile.mutate();
  }

  return (
    <div className="page account-layout">
      <section className="account-section">
        <h1>Mi cuenta</h1>
        {message && <div className="notice success">{message}</div>}
        {error && <div className="notice error">{error}</div>}
        <form className="account-form" onSubmit={submitProfile}>
          <label>
            Nombre
            <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required />
          </label>
          <label>
            Correo
            <input value={customer?.email ?? ''} disabled />
          </label>
          <label>
            Teléfono
            <input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} />
          </label>
          <button type="submit" className="btn-primary" disabled={saveProfile.isPending}>
            Guardar cambios
          </button>
        </form>
      </section>

      <section className="account-section">
        <h2>Direcciones de envío</h2>
        {addresses.data && addresses.data.length === 0 && (
          <p className="muted">
            Aún no tienes direcciones. Puedes agregarla al finalizar una compra en el{' '}
            <Link to="/carrito">carrito</Link>.
          </p>
        )}
        <ul className="address-list">
          {(addresses.data ?? []).map((address) => (
            <li key={address.id} className={address.is_default ? 'default' : ''}>
              <div>
                <strong>{address.recipient_name}</strong> · {address.label}{' '}
                {address.is_default && <span className="badge-default">Predeterminada</span>}
                <br />
                {address.street_address}
                {address.neighborhood ? `, ${address.neighborhood}` : ''} — {address.city}
                <br />
                <span className="muted">Tel: {address.phone}</span>
              </div>
              <div className="address-actions">
                {!address.is_default && (
                  <button type="button" className="link-button" onClick={() => setDefault.mutate(address.id)}>
                    Predeterminar
                  </button>
                )}
                <button type="button" className="link-button danger" onClick={() => removeAddress.mutate(address.id)}>
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
