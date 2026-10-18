import { useState, type FormEvent } from 'react';
import { ApiError, apiRequest, type Address } from '../api';
import { Button } from './ui/Button';
import { Field, Input, Select } from './ui/Input';

export function AddressForm({
  defaultName,
  defaultPhone,
  onCreated,
  onCancel
}: {
  defaultName?: string;
  defaultPhone?: string;
  onCreated: (address: Address) => void;
  onCancel?: () => void;
}) {
  const [recipient, setRecipient] = useState(defaultName ?? '');
  const [label, setLabel] = useState('Casa');
  const [street, setStreet] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('Bogotá');
  const [phone, setPhone] = useState(defaultPhone ?? '');
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
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {error ? (
        <div className="rounded-md border border-deal-600/25 bg-red-50 px-3 py-2 text-sm text-price sm:col-span-2">
          {error}
        </div>
      ) : null}
      <Field label="¿Quién recibe?" required>
        <Input value={recipient} onChange={(event) => setRecipient(event.target.value)} required minLength={2} />
      </Field>
      <Field label="Etiqueta">
        <Select value={label} onChange={(event) => setLabel(event.target.value)}>
          <option value="Casa">Casa</option>
          <option value="Trabajo">Trabajo</option>
          <option value="Otro">Otro</option>
        </Select>
      </Field>
      <Field label="Dirección" required className="sm:col-span-2">
        <Input
          value={street}
          onChange={(event) => setStreet(event.target.value)}
          placeholder="Calle 123 #45-67, apto 101"
          required
          minLength={5}
        />
      </Field>
      <Field label="Barrio">
        <Input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} />
      </Field>
      <Field label="Ciudad" required>
        <Input value={city} onChange={(event) => setCity(event.target.value)} required />
      </Field>
      <Field label="Teléfono de contacto" required>
        <Input value={phone} onChange={(event) => setPhone(event.target.value)} required minLength={7} />
      </Field>
      <Field label="Indicaciones (opcional)">
        <Input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar dirección'}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
