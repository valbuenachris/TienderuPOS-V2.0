import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

type TenantBannerRow = {
  id: unknown;
  image_url: string;
  title: string | null;
  target_url: string | null;
};

export type CustomerBanner = {
  id: unknown;
  title: string | null;
  image_url: string;
  target_url: string | null;
};

const TABLE_CACHE_MS = 60_000;

@Injectable()
export class BannersService {
  private cache: { exists: boolean; at: number } | null = null;

  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string): Promise<CustomerBanner[]> {
    if (!(await this.tenantBannersTableExists())) return [];

    const result = await this.database.query<TenantBannerRow>(
      `SELECT id, image_url, title, target_url
       FROM public.tec_tenant_banners
       WHERE tenant_id = $1 AND active = true
       ORDER BY sort_order, id DESC
       LIMIT 20`,
      [tenantId]
    );

    return result.rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        image_url: typeof row.image_url === 'string' ? row.image_url.trim() : '',
        target_url: row.target_url
      }))
      .filter((banner) => banner.image_url !== '');
  }

  private async tenantBannersTableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < TABLE_CACHE_MS) return this.cache.exists;

    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.tec_tenant_banners')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.cache = { exists, at: now };
    return exists;
  }
}
