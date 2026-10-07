import type { SaleResult } from '../api';
import { paymentMethodLabel, saleStatusLabel } from '../payments';
import { formatMoney } from '../format';

export function cleanPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  if (digits.length < 7) return null;
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  if (digits.length === 10 && digits.startsWith('3')) return `57${digits}`;
  return digits;
}

export interface TicketTextOptions {
  sale: SaleResult;
  currency: string;
  siteName?: string | null;
  thankYouMessage?: string | null;
  address?: string | null;
  nit?: string | null;
}

export function buildTicketText({
  sale,
  currency,
  siteName,
  thankYouMessage,
  address,
  nit
}: TicketTextOptions): string {
  const lines: string[] = [];

  lines.push(`🧾 *${siteName?.trim() || 'TIENDERU POS'}*`);
  if (address?.trim()) lines.push(address.trim());
  if (nit?.trim()) lines.push(`NIT: ${nit.trim()}`);
  lines.push(`Ticket #${sale.id}`);
  if (sale.created_at) lines.push(new Date(sale.created_at).toLocaleString('es-CO'));
  lines.push('');

  lines.push(`*Cliente:* ${sale.customer_name || 'Cliente ocasional'}`);
  lines.push('');

  lines.push('*Productos:*');
  for (const item of sale.items) {
    const name = item.name || item.code || `#${item.product_id}`;
    const quantity = Number(item.quantity ?? 0);
    lines.push(`• ${quantity} x ${name} - ${formatMoney(item.subtotal, currency)}`);
  }
  lines.push('');

  lines.push('─────────────────');
  lines.push(`Subtotal: ${formatMoney(sale.total, currency)}`);
  const discount = Number(sale.total_discount ?? 0);
  if (discount > 0) {
    const label = sale.order_discount_id ? ` (${sale.order_discount_id})` : '';
    lines.push(`Descuento${label}: -${formatMoney(discount, currency)}`);
  }
  lines.push(`Impuestos: ${formatMoney(sale.tax_total, currency)}`);
  lines.push(`*TOTAL: ${formatMoney(sale.grand_total, currency)}*`);
  lines.push('');

  lines.push(`💳 Pago: ${sale.paid_by ? paymentMethodLabel(sale.paid_by) : 'Cuenta pendiente'}`);
  lines.push(`✅ Estado: ${saleStatusLabel(sale.status)}`);
  const points = Number(sale.total_reward_points ?? 0);
  if (points > 0) lines.push(`⭐ Puntos ganados: ${points}`);
  lines.push('');

  lines.push(thankYouMessage?.trim() || '¡Gracias por su compra! 🛍️');

  return lines.filter((line, index, list) => !(line === '' && list[index - 1] === '')).join('\n');
}

export function buildWhatsAppUrl(text: string, phone: string | null | undefined): string {
  const encoded = encodeURIComponent(text);
  const cleaned = cleanPhone(phone);
  return cleaned
    ? `https://wa.me/${cleaned}?text=${encoded}`
    : `https://web.whatsapp.com/send?text=${encoded}`;
}
