import type { SalePaymentMethod } from './api';

export const PAYMENT_METHOD_LABELS: Record<SalePaymentMethod, string> = {
  cash: 'Efectivo',
  CC: 'Tarjeta',
  Transferencia: 'Transferencia',
  Sistecredito: 'Sistecrédito',
  ADI: 'Addi',
  credito: 'Crédito tienda'
};

export function paymentMethodLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return PAYMENT_METHOD_LABELS[value as SalePaymentMethod] ?? value;
}
