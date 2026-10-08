import { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui';
import { todayInBusinessTimezone } from '../../../format';

interface TrialExtensionModalProps {
  open: boolean;
  tenantName: string;
  currentEnd: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (trialEndDate: string, reason: string) => void;
}

export default function TrialExtensionModal({ open, tenantName, currentEnd, pending, onClose, onSubmit }: TrialExtensionModalProps) {
  const today = todayInBusinessTimezone();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setDate(currentEnd && currentEnd > today ? currentEnd.slice(0, 10) : today);
      setReason('');
    }
  }, [open, currentEnd, today]);

  return (
    <Modal open={open} eyebrow="PRUEBA" title={`Extender prueba · ${tenantName}`} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (!date) return;
          onSubmit(date, reason.trim());
        }}
      >
        {currentEnd ? <p className="muted">Fin actual de la prueba: {currentEnd.slice(0, 10)}</p> : null}
        <label>Nueva fecha de fin
          <input type="date" value={date} min={today} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>Motivo (opcional)
          <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Ej: cliente pidió unos días más" />
        </label>
        <div className="modal-actions">
          <button className="quiet" type="button" onClick={onClose} disabled={pending}>Cancelar</button>
          <button className="primary" type="submit" disabled={pending || !date}>
            {pending ? 'Guardando…' : 'Extender prueba'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
