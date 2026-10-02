const amountFormatter = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(value: string | number | null | undefined, prefix = '$'): string {
  const amount = amountFormatter.format(Number(value ?? 0));
  const normalized = (prefix || '').trim();
  // Settings may store an ISO code ("COP", "USD"); render the symbol instead of the code.
  const symbol = normalized && !/^[A-Za-z]{3}$/.test(normalized) ? normalized : '$';
  return `${symbol} ${amount}`;
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
