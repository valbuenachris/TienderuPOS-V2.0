import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui';

interface AdjustPointsModalProps {
  open: boolean;
  customerName: string;
  currentBalance: number;
  pending: boolean;
  onClose: () => void;
  onSubmit: (amount: number, reason: string) => void;
}

export default function AdjustPointsModal({
  open,
  customerName,
  currentBalance,
  pending,
  onClose,
  onSubmit
}: AdjustPointsModalProps) {
  const [amount, setAmount] = useState('0');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setAmount('0');
      setReason('');
    }
  }, [open]);

  const parsed = Number(amount);
  const validAmount = Number.isSafeInteger(parsed) && parsed !== 0;
  const result = currentBalance + (Number.isFinite(parsed) ? parsed : 0);
  const valid = validAmount && result >= 0 && reason.trim().length >= 2;

  return (
    <Modal open={open} eyebrow="PUNTOS" title={`Ajustar puntos · ${customerName}`} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onSubmit(parsed, reason.trim());
        }}
      >
        <p className="muted">Saldo actual: <strong>{currentBalance}</strong> punto(s). Usa valores positivos para sumar y negativos para restar.</p>
        <label>Cantidad (+/-)
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="numeric"
            placeholder="Ej: 100 o -50"
            required
          />
        </label>
        <label>Motivo
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={255}
            placeholder="Ej: Compensación por pedido tardío"
            required
          />
        </label>
        <p className={result < 0 ? 'text-danger' : 'muted'}>Nuevo saldo: <strong>{result}</strong> punto(s)</p>
        <div className="modal-actions">
          <button className="quiet" type="button" onClick={onClose} disabled={pending}>Cancelar</button>
          <button className="primary" type="submit" disabled={pending || !valid}>
            {pending ? 'Guardando…' : 'Ajustar puntos'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
