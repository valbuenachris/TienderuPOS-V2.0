import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, changeMarketplacePassword, type Address, type MarketplaceCustomer } from '../api';
import { useAuth } from '../auth';
import { AddressForm } from '../components/AddressForm';
import { Button, buttonStyles } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';

export function AccountPage() {
  const { customer } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

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
      setError(null);
      toast.push('Datos actualizados');
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'No pudimos guardar tus datos.');
    }
  });

  const removeAddress = useMutation({
    mutationFn: (id: number) => apiRequest(`/marketplace/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.push('Dirección eliminada');
      void queryClient.invalidateQueries({ queryKey: ['store-addresses'] });
    }
  });

  const setDefault = useMutation({
    mutationFn: (id: number) => apiRequest(`/marketplace/addresses/${id}/set-default`, { method: 'PUT' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['store-addresses'] })
  });

  if (!customer) {
    return (
      <div className="container-page py-10">
        <EmptyState
          icon="user"
          title="Inicia sesión para ver tu cuenta"
          action={
            <Link to="/ingresar?next=/cuenta" className={buttonStyles({ variant: 'primary' })}>
              Ingresar
            </Link>
          }
        />
      </div>
    );
  }

  function submitProfile(event: FormEvent) {
    event.preventDefault();
    saveProfile.mutate();
  }

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const changePassword = useMutation({
    mutationFn: () => changeMarketplacePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setPasswordError(null);
      toast.push('Contraseña actualizada');
    },
    onError: (caught) => {
      setPasswordError(
        caught instanceof ApiError ? caught.message : 'No pudimos cambiar la contraseña.'
      );
    }
  });

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    changePassword.mutate();
  }

  return (
    <div className="container-page py-6">
      <h1 className="mb-4 text-xl font-bold text-ink sm:text-2xl">Mi cuenta</h1>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <section className="rounded-card bg-white p-5 shadow-card sm:p-6">
          <h2 className="mb-4 text-lg font-bold text-ink">Datos personales</h2>
          {error ? (
            <div className="mb-3 rounded-md border border-deal-600/25 bg-red-50 px-3 py-2 text-sm text-price">
              {error}
            </div>
          ) : null}
          <form onSubmit={submitProfile} className="flex flex-col gap-4">
            <Field label="Nombre" required>
              <Input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required />
            </Field>
            <Field label="Correo electrónico">
              <Input value={customer.email ?? ''} disabled />
            </Field>
            <Field label="Teléfono">
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} />
            </Field>
            <div>
              <Button type="submit" disabled={saveProfile.isPending}>
                {saveProfile.isPending ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </div>
          </form>

          <div className="mt-6 border-t border-line-soft pt-5">
            <h3 className="mb-3 text-base font-bold text-ink">Cambiar contraseña</h3>
            {passwordError ? (
              <div className="mb-3 rounded-md border border-deal-600/25 bg-red-50 px-3 py-2 text-sm text-price">
                {passwordError}
              </div>
            ) : null}
            <form onSubmit={submitPassword} className="flex flex-col gap-4">
              <Field label="Contraseña actual" required>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  maxLength={72}
                  autoComplete="current-password"
                />
              </Field>
              <Field label="Nueva contraseña" required hint="Mínimo 8 caracteres">
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  minLength={8}
                  maxLength={72}
                  autoComplete="new-password"
                />
              </Field>
              <div>
                <Button type="submit" variant="outline" disabled={changePassword.isPending}>
                  {changePassword.isPending ? 'Actualizando…' : 'Actualizar contraseña'}
                </Button>
              </div>
            </form>
          </div>
        </section>

        <section className="rounded-card bg-white p-5 shadow-card sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">Direcciones de envío</h2>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              + Agregar
            </Button>
          </div>

          {addresses.data && addresses.data.length === 0 ? (
            <p className="text-sm text-ink-soft">
              Aún no tienes direcciones guardadas. Agrega una para agilizar tus compras.
            </p>
          ) : null}

          <ul className="flex flex-col gap-3">
            {(addresses.data ?? []).map((address) => (
              <li
                key={address.id}
                className={`flex flex-wrap items-start justify-between gap-3 rounded-card border p-3.5 text-sm ${
                  address.is_default ? 'border-success-600/50 bg-success-50/40' : 'border-line bg-white'
                }`}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <strong className="text-ink">{address.recipient_name}</strong>
                    <span className="rounded-full bg-line-soft px-2 py-0.5 text-xs text-ink-soft">{address.label}</span>
                    {address.is_default ? (
                      <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-bold text-success-600">
                        Predeterminada
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-ink/90">
                    {address.street_address}
                    {address.neighborhood ? `, ${address.neighborhood}` : ''} — {address.city}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">Tel: {address.phone}</p>
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  {!address.is_default ? (
                    <button
                      type="button"
                      className="font-medium text-link-600 hover:text-link-700 hover:underline"
                      onClick={() => setDefault.mutate(address.id)}
                    >
                      Predeterminar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="font-medium text-price hover:underline"
                    onClick={() => removeAddress.mutate(address.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Dialog open={addOpen} title="Nueva dirección" onClose={() => setAddOpen(false)}>
        <AddressForm
          defaultName={customer.name ?? ''}
          defaultPhone={customer.phone ?? ''}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ['store-addresses'] });
            setAddOpen(false);
            toast.push('Dirección guardada');
          }}
        />
      </Dialog>
    </div>
  );
}
