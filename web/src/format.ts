const amountFormatter = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(value: string | number | null | undefined, prefix = 'COP'): string {
  const amount = amountFormatter.format(Number(value ?? 0));
  const normalizedPrefix = (prefix || '').trim();
  if (!normalizedPrefix) return amount;
  return /^[A-Z]{3}$/.test(normalizedPrefix) ? `${normalizedPrefix} ${amount}` : `${normalizedPrefix}${amount}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-CO', { dateStyle: 'medium' });
}
