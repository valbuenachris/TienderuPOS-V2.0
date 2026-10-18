const amountFormatter = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(value: string | number | null | undefined, prefix = '$'): string {
  const amount = amountFormatter.format(Number(value ?? 0));
  const normalized = (prefix || '').trim();
  // Settings may store an ISO code ("COP", "USD"); render the symbol instead of the code.
  const symbol = normalized && !/^[A-Za-z]{3}$/.test(normalized) ? normalized : '$';
  // Non-breaking space: the symbol and amount must never wrap onto separate lines.
  return `${symbol}\u00A0${amount}`;
}

const compactAmountFormatter = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });

/** Monto abreviado para celdas angostas ($ 30 mil, $ 1,2 M); negativos con "−" delante. */
export function formatMoneyCompact(value: string | number | null | undefined, prefix = '$'): string {
  const amount = Number(value ?? 0);
  const normalized = (prefix || '').trim();
  const symbol = normalized && !/^[A-Za-z]{3}$/.test(normalized) ? normalized : '$';
  const sign = amount < 0 ? '−' : '';
  return `${sign}${symbol}\u00A0${compactAmountFormatter.format(Math.abs(amount))}`;
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

const DEFAULT_TIMEZONE = 'America/Bogota';
let businessTimeZone = DEFAULT_TIMEZONE;
const dateOnlyFormatters = new Map<string, Intl.DateTimeFormat>();

function dateOnlyFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateOnlyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone });
    dateOnlyFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function setBusinessTimeZone(timeZone: string | null | undefined): void {
  if (!timeZone || timeZone === businessTimeZone) return;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    businessTimeZone = timeZone;
  } catch (_error: unknown) {
    // Invalid IANA name: keep the current business timezone.
  }
}

export function todayInBusinessTimezone(): string {
  return dateOnlyFormatter(businessTimeZone).format(new Date());
}

export function daysAgoInBusinessTimezone(days: number): string {
  return dateOnlyFormatter(businessTimeZone).format(new Date(Date.now() - days * 86400000));
}
