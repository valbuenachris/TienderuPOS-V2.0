import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

type BannerRow = {
  id: unknown;
  image_url: unknown;
};

export type CustomerBanner = {
  id: unknown;
  title: null;
  image_url: string;
  target_url: null;
};

const TABLE_CACHE_MS = 60_000;

@Injectable()
export class BannersService {
  private cache: { exists: boolean; at: number } | null = null;

  constructor(private readonly database: DatabaseService) {}

  async list(): Promise<CustomerBanner[]> {
    if (!(await this.bannersTableExists())) return [];

    const result = await this.database.query<BannerRow>(
      `SELECT id, image_url
       FROM public.banners
       WHERE image_url IS NOT NULL AND btrim(image_url) <> ''
       ORDER BY created_at DESC, id DESC
       LIMIT 20`
    );

    return result.rows
      .map((row) => ({
        id: row.id,
        title: null,
        image_url: typeof row.image_url === 'string' ? row.image_url.trim() : '',
        target_url: null
      }))
      .filter((banner) => banner.image_url !== '');
  }

  private async bannersTableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < TABLE_CACHE_MS) return this.cache.exists;

    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.banners')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.cache = { exists, at: now };
    return exists;
  }
}
