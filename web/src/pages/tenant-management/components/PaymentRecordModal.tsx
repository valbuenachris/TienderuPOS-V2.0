import { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui';
import { formatMoney, todayInBusinessTimezone } from '../../../format';
import type { RecordTenantPaymentPayload } from '../../../api';

const METHODS = ['Transferencia', 'Efectivo', 'Tarjeta', 'Sistecrédito', 'Addi', 'Otro'];

interface PaymentRecordModalProps {
  open: boolean;
  tenantName: string;
  currency: string;
  suggestedAmount: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: RecordTenantPaymentPayload) => void;
}

export default function PaymentRecordModal({
  open,
  tenantName,
  currency,
  suggestedAmount,
  pending,
  onClose,
  onSubmit
}: PaymentRecordModalProps) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInBusinessTimezone());
  const [method, setMethod] = useState(METHODS[0]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setAmount(suggestedAmount ?? '');
      setDate(todayInBusinessTimezone());
      setMethod(METHODS[0]);
      setNotes('');
    }
  }, [open, suggestedAmount]);

  const validAmount = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;

  return (
    <Modal open={open} eyebrow="PAGO" title={`Registrar pago · ${tenantName}`} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (!validAmount) return;
          onSubmit({
            amount,
            payment_date: date || undefined,
            payment_method: method,
            notes: notes.trim() || undefined
          });
        }}
      >
        {suggestedAmount ? (
          <p className="muted">Sugerido según el plan: {formatMoney(suggestedAmount, currency)}</p>
        ) : null}
        <label>Monto
          <input
            value={amount}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="79.00"
            required
          />
        </label>
        <label>Fecha de pago
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>Método
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            {METHODS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>Notas (opcional)
          <input value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button className="quiet" type="button" onClick={onClose} disabled={pending}>Cancelar</button>
          <button className="primary" type="submit" disabled={pending || !validAmount}>
            {pending ? 'Guardando…' : 'Registrar pago'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
