export const BUSINESS_TIMEZONE = process.env.POS_TIMEZONE ?? 'America/Bogota';

export function todayInBusinessTimezone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(new Date());
}
