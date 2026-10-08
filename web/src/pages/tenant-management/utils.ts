import { todayInBusinessTimezone } from '../../format';
import type { TenantManagementRow } from '../../api';

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.parse(`${todayInBusinessTimezone()}T00:00:00Z`);
  return Math.round((target - today) / 86400000);
}

export function isExpiringSoon(row: TenantManagementRow, windowDays = 7): boolean {
  if (row.subscription_status !== 'trial' && row.subscription_status !== 'active') return false;
  const reference = row.subscription_status === 'trial' ? row.trial_end_date : row.next_billing_date;
  const days = daysUntil(reference);
  return days !== null && days >= 0 && days <= windowDays;
}

export function planLimitLabel(max: number | null): string {
  if (max === null) return '—';
  return max === -1 ? '∞' : String(max);
}

export function formatDetails(details: unknown): string {
  if (details === null || details === undefined) return '—';
  if (typeof details !== 'object' || Array.isArray(details)) return String(details);
  const entries = Object.entries(details as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  return entries.length > 0 ? entries.join(' · ') : '—';
}
