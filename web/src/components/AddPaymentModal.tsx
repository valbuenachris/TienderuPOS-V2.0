import { useState } from 'react';
import { Modal, Notice } from './ui';
import type { AddSalePaymentPayload, SaleListRow, SalePaymentMethod } from '../api';
import { PAYMENT_METHOD_LABELS } from '../payments';
import { formatMoney } from '../format';

interface AddPaymentModalProps {
  sale: SaleListRow;
  currency: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (payload: AddSalePaymentPayload) => void;
}

const PAYMENT_OPTIONS: SalePaymentMethod[] = ['cash', 'CC', 'Transferencia', 'Sistecredito', 'ADI', 'credito'];
const amountInputFormatter = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toCents(value: number): number {
  return Math.round(value * 100);
}

function parseAmountToCents(value: string): number {
  const clean = value.trim();
  if (clean === '') return NaN;
  let normalized = clean;
  if (clean.includes(',')) {
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    normalized = clean.replace(/\./g, '');
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

function centsToInput(cents: number): string {
  return amountInputFormatter.format(cents / 100);
}

function centsToApi(cents: number): string {
  return (cents / 100).toFixed(2);
}

export default function AddPaymentModal({
  sale,
  currency,
  submitting,
  onClose,
  onConfirm
}: AddPaymentModalProps) {
  const [amountDraft, setAmountDraft] = useState('');
  const [method, setMethod] = useState<SalePaymentMethod>('cash');

  const grandTotalCents = toCents(Number(sale.grand_total ?? 0));
  const paidCents = toCents(Number(sale.paid ?? 0));
  const remainingCents = Math.max(grandTotalCents - paidCents, 0);

  const rawCents = amountDraft.trim() === '' ? remainingCents : parseAmountToCents(amountDraft);
  const parsedValid = Number.isFinite(rawCents) && rawCents > 0;
  const exceedsBalance = Number.isFinite(rawCents) && rawCents > remainingCents;
  const amountValid = parsedValid && !exceedsBalance;
  const amountCents = parsedValid && !exceedsBalance ? rawCents : 0;

  function confirm() {
    if (submitting || !amountValid) return;
    onConfirm({ amount: centsToApi(amountCents), paid_by: method });
  }

  return (
    <Modal
      open
      eyebrow="COBRO"
      title={`Agregar pago · Venta #${sale.id}`}
      className="sale-confirm-card"
      onClose={onClose}
    >
      <div className="stack">
        <div className="sale-detail-grid">
          <div><span>Cliente</span><strong>{sale.customer_name || 'Cliente ocasional'}</strong></div>
          <div><span>Total de la venta</span><strong>{formatMoney(grandTotalCents / 100, currency)}</strong></div>
          <div><span>Ya pagado</span><strong>{formatMoney(paidCents / 100, currency)}</strong></div>
          <div><span>Pendiente</span><strong>{formatMoney(remainingCents / 100, currency)}</strong></div>
        </div>

        <div className="quick-cash">
          <button type="button" onClick={() => setAmountDraft(centsToInput(remainingCents))}>Pagar saldo</button>
          <button type="button" onClick={() => setAmountDraft('')}>Limpiar</button>
        </div>

        <label>Monto a pagar
          <input
            value={amountDraft}
            onChange={(event) => setAmountDraft(event.target.value)}
            inputMode="decimal"
            placeholder={centsToInput(remainingCents)}
            aria-label="Monto a pagar"
          />
        </label>

        <label>Método de pago
          <select value={method} onChange={(event) => setMethod(event.target.value as SalePaymentMethod)}>
            {PAYMENT_OPTIONS.map((option) => (
              <option key={option} value={option}>{PAYMENT_METHOD_LABELS[option]}</option>
            ))}
          </select>
        </label>

        {exceedsBalance ? (
          <Notice tone="error">El monto supera el saldo pendiente ({formatMoney(remainingCents / 100, currency)}).</Notice>
        ) : null}
        {!parsedValid && amountDraft.trim() !== '' ? (
          <Notice tone="error">El monto no es válido.</Notice>
        ) : null}

        <div className="modal-actions">
          <button className="quiet" type="button" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button className="primary" type="button" onClick={confirm} disabled={submitting || !amountValid}>
            {submitting ? 'Registrando…' : 'Confirmar pago'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
