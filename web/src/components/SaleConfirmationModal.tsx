import { useState } from 'react';
import { Modal, Notice } from './ui';
import type { Customer, Product, SalePaymentMethod } from '../api';
import { formatMoney } from '../format';

export type SalePaymentMode = SalePaymentMethod | 'due';
export type SaleStatus = 'paid' | 'partial' | 'due';

export interface SaleConfirmationData {
  lines: Array<{ product: Product; quantity: number }>;
  customer: Customer | null;
  paymentMode: SalePaymentMode;
  paymentLabel: string;
}

export interface SaleConfirmationPayload {
  paid_by?: SalePaymentMethod;
  amount_received?: string;
  change_amount?: string;
  discount_type?: 'fixed' | 'percent';
  discount_value?: string;
}

interface SaleConfirmationModalProps {
  data: SaleConfirmationData;
  currency: string;
  cashierName?: string;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (payload: SaleConfirmationPayload) => void;
}

const QUICK_CASH_CENTS = [5000000, 10000000, 20000000];
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

function parsePercent(value: string): number {
  const clean = value.trim();
  if (clean === '') return NaN;
  return Number(clean.replace(',', '.'));
}

function centsToInput(cents: number): string {
  return amountInputFormatter.format(cents / 100);
}

function centsToApi(cents: number): string {
  return (cents / 100).toFixed(2);
}

export default function SaleConfirmationModal({
  data,
  currency,
  cashierName,
  submitting,
  onClose,
  onConfirm
}: SaleConfirmationModalProps) {
  const [receivedDraft, setReceivedDraft] = useState('');
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [openedAt] = useState(() => new Date().toLocaleString('es-CO'));

  const rows = data.lines.map((line) => {
    const unitCents = toCents(Number(line.product.price ?? 0));
    const subtotalCents = unitCents * line.quantity;
    const taxCents = Math.round(subtotalCents * Number(line.product.tax ?? 0) / 100);
    return { line, unitCents, subtotalCents, taxCents };
  });
  const subtotalCents = rows.reduce((sum, row) => sum + row.subtotalCents, 0);
  const taxCents = rows.reduce((sum, row) => sum + row.taxCents, 0);
  const preTotalCents = subtotalCents + taxCents;
  const totalItems = rows.reduce((sum, row) => sum + row.line.quantity, 0);

  const discountDraft = discountValue.trim();
  const discountPercent = discountType === 'percent' ? parsePercent(discountDraft) : NaN;
  const discountFixedCents = discountType === 'fixed' ? parseAmountToCents(discountDraft) : NaN;
  let discountCents = 0;
  let discountValid = true;
  if (discountDraft !== '') {
    if (discountType === 'percent') {
      discountValid = Number.isFinite(discountPercent) && discountPercent >= 0 && discountPercent <= 100;
      discountCents = discountValid ? Math.round(preTotalCents * discountPercent / 100) : 0;
    } else {
      discountValid = Number.isFinite(discountFixedCents) && discountFixedCents >= 0 && discountFixedCents <= preTotalCents;
      discountCents = discountValid ? discountFixedCents : 0;
    }
  }
  if (discountCents > preTotalCents) discountCents = preTotalCents;
  const totalCents = preTotalCents - discountCents;
  const discountEquivalent = discountCents > 0 && preTotalCents > 0
    ? (discountType === 'percent'
      ? formatMoney(discountCents / 100, currency)
      : `${((discountCents / preTotalCents) * 100).toFixed(2)}%`)
    : '';

  const method = data.paymentMode;
  const isCash = method === 'cash';
  const isDue = method === 'due';
  const rawReceived = receivedDraft.trim() === ''
    ? totalCents
    : parseAmountToCents(receivedDraft);
  const receivedValid = Number.isFinite(rawReceived);
  const receivedCents = receivedValid ? rawReceived : totalCents;
  const changeCents = receivedCents - totalCents;
  const status: SaleStatus = isDue
    ? 'due'
    : isCash
      ? (receivedCents >= totalCents ? 'paid' : receivedCents > 0 ? 'partial' : 'due')
      : 'paid';

  const statusMeta = {
    paid: { emoji: '🟢', label: 'Pagada' },
    partial: { emoji: '🟡', label: 'Pago parcial' },
    due: { emoji: '🔴', label: 'Debida' }
  }[status];

  const contact = [data.customer?.email, data.customer?.phone].filter(Boolean).join(' · ');

  function confirm() {
    if (submitting || rows.length === 0 || !discountValid) return;
    const discountPayload = discountCents > 0
      ? {
          discount_type: discountType,
          discount_value: discountType === 'percent'
            ? String(discountPercent)
            : centsToApi(discountCents)
        }
      : {};
    if (method === 'due') {
      onConfirm(discountPayload);
      return;
    }
    if (method === 'cash') {
      if (!receivedValid) return;
      onConfirm({
        paid_by: 'cash',
        amount_received: centsToApi(receivedCents),
        change_amount: centsToApi(Math.max(changeCents, 0)),
        ...discountPayload
      });
      return;
    }
    onConfirm({ paid_by: method, ...discountPayload });
  }

  return (
    <Modal open title="Confirmar venta" eyebrow="CONFIRMACIÓN" className="sale-confirm-card" onClose={onClose}>
      <div className="sale-confirm-meta">
        <span>Venta nueva · el número se asigna al confirmar</span>
        <span>Fecha: {openedAt}</span>
        {cashierName ? <span>Atendido por: {cashierName}</span> : null}
      </div>

      <div className="sale-confirm-customer">
        <span className="eyebrow">Cliente</span>
        <strong>{data.customer?.name || 'Cliente ocasional'}</strong>
        {contact ? <small>{contact}</small> : null}
      </div>

      <div className="table-wrap confirm-products">
        <table className="data-table">
          <thead>
            <tr><th>Código</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.line.product.id}>
                <td>{row.line.product.code || `#${row.line.product.id}`}</td>
                <td>{row.line.product.name || 'Producto'}</td>
                <td>{row.line.quantity}</td>
                <td>{formatMoney(row.unitCents / 100, currency)}</td>
                <td>{formatMoney(row.subtotalCents / 100, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="confirm-discount">
        <div className="confirm-payment-label">
          <span>Descuento</span>
          <div className="discount-toggle">
            <button
              type="button"
              className={discountType === 'fixed' ? 'active' : ''}
              onClick={() => { setDiscountType('fixed'); setDiscountValue(''); }}
            >
              Monto fijo
            </button>
            <button
              type="button"
              className={discountType === 'percent' ? 'active' : ''}
              onClick={() => { setDiscountType('percent'); setDiscountValue(''); }}
            >
              Porcentaje
            </button>
          </div>
        </div>
        <label>{discountType === 'percent' ? 'Porcentaje (0 - 100)' : 'Monto'}
          <input
            value={discountValue}
            onChange={(event) => setDiscountValue(event.target.value)}
            inputMode="decimal"
            placeholder={discountType === 'percent' ? '0' : '0.00'}
            aria-label="Descuento"
          />
        </label>
        {!discountValid ? (
          <Notice tone="error">
            {discountType === 'percent'
              ? 'El porcentaje debe estar entre 0 y 100.'
              : 'El descuento no puede ser negativo ni superar el total.'}
          </Notice>
        ) : null}
        {discountEquivalent ? (
          <div className="change-line neutral">
            <span>Descuento aplicado</span>
            <span>−{formatMoney(discountCents / 100, currency)} ({discountEquivalent})</span>
          </div>
        ) : null}
      </div>

      <div className="confirm-totals">
        <div><span>Subtotal ({totalItems} artículos)</span><span>{formatMoney(subtotalCents / 100, currency)}</span></div>
        <div><span>Impuestos</span><span>{formatMoney(taxCents / 100, currency)}</span></div>
        {discountCents > 0 ? (
          <div className="confirm-discount-line">
            <span>Descuento {discountType === 'percent' ? `(${discountDraft}%)` : ''}</span>
            <span>−{formatMoney(discountCents / 100, currency)}</span>
          </div>
        ) : null}
        <div className="confirm-total"><span>TOTAL</span><strong>{formatMoney(totalCents / 100, currency)}</strong></div>
      </div>

      <div className="confirm-payment">
        <div className="confirm-payment-label">
          <span>Forma de pago</span>
          <strong>{data.paymentLabel}</strong>
        </div>

        {isCash ? (
          <>
            <div className="quick-cash">
              <button type="button" onClick={() => setReceivedDraft(centsToInput(totalCents))}>Exacto</button>
              {QUICK_CASH_CENTS.map((amount) => (
                <button type="button" key={amount} onClick={() => setReceivedDraft(centsToInput(amount))}>
                  {formatMoney(amount / 100, currency)}
                </button>
              ))}
            </div>
            <label>Recibido
              <input
                value={receivedDraft}
                onChange={(event) => setReceivedDraft(event.target.value)}
                inputMode="decimal"
                placeholder={centsToInput(totalCents)}
                aria-label="Monto recibido"
              />
            </label>
            {!receivedValid ? <Notice tone="error">El monto recibido no es válido.</Notice> : null}
            {changeCents > 0 ? (
              <div className="change-line positive"><span>Cambio a devolver</span><span>✅ {formatMoney(changeCents / 100, currency)}</span></div>
            ) : changeCents === 0 ? (
              <div className="change-line exact"><span>Cambio a devolver</span><span>Pago exacto</span></div>
            ) : (
              <div className="change-line negative">
                <span>Monto insuficiente</span>
                <span>Faltan {formatMoney(-changeCents / 100, currency)} · se registrará como pago parcial</span>
              </div>
            )}
          </>
        ) : isDue ? (
          <div className="change-line neutral"><span>Sin pago inicial</span><span>Venta a crédito</span></div>
        ) : (
          <div className="change-line neutral"><span>Pago completo con {data.paymentLabel}</span><span>✅</span></div>
        )}

        <div className="sale-confirm-status">
          <span>Estado de la venta</span>
          <span className={`sale-status-badge ${status}`}>{statusMeta.emoji} {statusMeta.label}</span>
        </div>
      </div>

      <div className="modal-actions">
        <button className="quiet" type="button" onClick={onClose} disabled={submitting}>Cancelar</button>
        <button
          className="primary"
          type="button"
          onClick={confirm}
          disabled={submitting || rows.length === 0 || (isCash && !receivedValid) || !discountValid}
        >
          {submitting ? 'Registrando…' : 'Confirmar venta'}
        </button>
      </div>
    </Modal>
  );
}
