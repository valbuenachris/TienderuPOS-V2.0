export const BUSINESS_TIMEZONE = process.env.POS_TIMEZONE ?? 'America/Bogota';

export function todayInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

export function daysAgoInTimeZone(timeZone: string, days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(Date.now() - days * 86400000));
}

export function todayInBusinessTimezone(): string {
  return todayInTimeZone(BUSINESS_TIMEZONE);
}
