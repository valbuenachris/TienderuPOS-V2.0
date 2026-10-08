import { useEffect, useState } from 'react';
import { Modal, Notice } from '../../../components/ui';
import { formatMoney } from '../../../format';
import type { SubscriptionPlan } from '../../../api';

interface PlanSelectorProps {
  open: boolean;
  currentPlanId: string | null;
  plans: SubscriptionPlan[];
  currency: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (planId: string) => void;
}

export default function PlanSelector({ open, currentPlanId, plans, currency, pending, onClose, onSubmit }: PlanSelectorProps) {
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    if (open) setSelected(currentPlanId ?? '');
  }, [open, currentPlanId]);

  const activePlans = plans.filter((plan) => plan.is_active || plan.id === currentPlanId);

  return (
    <Modal open={open} eyebrow="SUSCRIPCIÓN" title="Cambiar plan" onClose={onClose}>
      <div className="stack">
        {activePlans.length === 0 ? <Notice tone="error">No hay planes activos disponibles.</Notice> : null}
        <div className="plan-options">
          {activePlans.map((plan) => (
            <label key={plan.id} className={`plan-option ${selected === plan.id ? 'selected' : ''}`}>
              <input
                type="radio"
                name="plan"
                value={plan.id}
                checked={selected === plan.id}
                onChange={() => setSelected(plan.id)}
              />
              <span className="plan-option-body">
                <strong>{plan.name}{plan.id === currentPlanId ? ' · actual' : ''}</strong>
                <small>
                  {formatMoney(plan.price_monthly, currency)}/mes · {formatMoney(plan.price_yearly, currency)}/año
                </small>
                <small>
                  {plan.max_users === -1 ? 'Usuarios ilimitados' : `${plan.max_users} usuario(s)`} ·{' '}
                  {plan.max_stores === -1 ? 'Tiendas ilimitadas' : `${plan.max_stores} tienda(s)`}
                </small>
              </span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="quiet" type="button" onClick={onClose} disabled={pending}>Cancelar</button>
          <button
            className="primary"
            type="button"
            disabled={pending || !selected || selected === currentPlanId}
            onClick={() => onSubmit(selected)}
          >
            {pending ? 'Guardando…' : 'Cambiar plan'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
