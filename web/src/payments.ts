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

export const SALE_STATUS_LABELS: Record<string, string> = {
  paid: 'Pagada',
  partial: 'Parcial',
  due: 'Debida'
};

export function saleStatusLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return SALE_STATUS_LABELS[value] ?? value;
}
