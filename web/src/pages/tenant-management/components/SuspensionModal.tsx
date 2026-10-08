import { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui';

interface SuspensionModalProps {
  open: boolean;
  tenantName: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string, endDate?: string) => void;
}

export default function SuspensionModal({ open, tenantName, pending, onClose, onSubmit }: SuspensionModalProps) {
  const [reason, setReason] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setEndDate('');
    }
  }, [open]);

  return (
    <Modal open={open} eyebrow="SUSPENDER" title={`Suspender · ${tenantName}`} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim().length < 3) return;
          onSubmit(reason.trim(), endDate || undefined);
        }}
      >
        <p className="muted">
          Al suspender, el tenant queda inactivo y sus usuarios no podrán iniciar sesión hasta reactivarlo.
        </p>
        <label>Motivo
          <input
            value={reason}
            minLength={3}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ej: pago pendiente"
            required
          />
        </label>
        <label>Fin estimado (opcional)
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button className="quiet" type="button" onClick={onClose} disabled={pending}>Cancelar</button>
          <button className="danger" type="submit" disabled={pending || reason.trim().length < 3}>
            {pending ? 'Suspendiendo…' : 'Suspender tenant'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
