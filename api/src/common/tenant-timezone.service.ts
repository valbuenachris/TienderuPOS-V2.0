import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BUSINESS_TIMEZONE } from './timezone';

const CACHE_MS = 60000;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (_error: unknown) {
    return false;
  }
}

@Injectable()
export class TenantTimezoneService {
  private readonly cache = new Map<string, { timezone: string; at: number }>();

  constructor(private readonly database: DatabaseService) {}

  async forTenant(tenantId: string): Promise<string> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.timezone;

    let timezone = BUSINESS_TIMEZONE;
    try {
      const result = await this.database.query<{ timezone: string | null }>(
        'SELECT timezone FROM public.tec_tenant_settings WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      const value = result.rows[0]?.timezone?.trim();
      if (value && isValidTimeZone(value)) timezone = value;
    } catch (_error: unknown) {
      // tec_tenant_settings may not exist yet; keep the platform default.
    }

    this.cache.set(tenantId, { timezone, at: Date.now() });
    return timezone;
  }
}
