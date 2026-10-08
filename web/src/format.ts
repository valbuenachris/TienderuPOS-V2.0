const amountFormatter = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(value: string | number | null | undefined, prefix = '$'): string {
  const amount = amountFormatter.format(Number(value ?? 0));
  const normalized = (prefix || '').trim();
  // Settings may store an ISO code ("COP", "USD"); render the symbol instead of the code.
  const symbol = normalized && !/^[A-Za-z]{3}$/.test(normalized) ? normalized : '$';
  // Non-breaking space: the symbol and amount must never wrap onto separate lines.
  return `${symbol}\u00A0${amount}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-CO');
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-CO', { dateStyle: 'medium' });
}

const businessDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' });

export function todayInBusinessTimezone(): string {
  return businessDateFormatter.format(new Date());
}

export function daysAgoInBusinessTimezone(days: number): string {
  return businessDateFormatter.format(new Date(Date.now() - days * 86400000));
}
