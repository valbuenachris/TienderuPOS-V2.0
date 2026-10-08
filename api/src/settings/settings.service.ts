import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolvePublicBase } from '../common/image-url';
import { DatabaseService } from '../database/database.service';
import { SupabaseService } from '../database/supabase.service';
import { UpdateSettingsDto } from './settings.dto';

const EDITABLE_COLUMNS = [
  'site_name',
  'currency_prefix',
  'default_customer',
  'address',
  'phone',
  'email',
  'nit',
  'timezone',
  'language',
  'default_tax',
  'decimal_digits',
  'thank_you_message',
  'return_policy',
  'show_qr_on_ticket',
  'printer_width',
  'logo_url'
];

const POS_DISPLAY_COLUMNS = [
  'site_name',
  'currency_prefix',
  'default_customer',
  'address',
  'phone',
  'nit',
  'timezone',
  'language',
  'thank_you_message',
  'return_policy',
  'show_qr_on_ticket',
  'printer_width',
  'logo_url'
];

const ALLOWED_LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
};

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const COLUMN_CACHE_MS = 30000;

@Injectable()
export class SettingsService {
  private readonly bucket: string;
  private readonly publicBase: string;
  private columnsCache: { columns: Set<string>; at: number } | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly supabase: SupabaseService,
    config: ConfigService
  ) {
    this.bucket = config.get<string>('SUPABASE_PRODUCT_BUCKET') ?? 'productos';
    this.publicBase = resolvePublicBase(
      config.get<string>('SUPABASE_PUBLIC_URL'),
      config.get<string>('SUPABASE_URL') ?? ''
    );
  }

  private async existingColumns(): Promise<Set<string>> {
    const now = Date.now();
    if (this.columnsCache && now - this.columnsCache.at < COLUMN_CACHE_MS) {
      return this.columnsCache.columns;
    }
    const result = await this.database.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tec_settings'`
    );
    const columns = new Set(result.rows.map((row) => row.column_name));
    this.columnsCache = { columns, at: now };
    return columns;
  }

  private async editableColumns(): Promise<string[]> {
    const existing = await this.existingColumns();
    return EDITABLE_COLUMNS.filter((column) => existing.has(column));
  }

  private async assertTenant(tenantId: string): Promise<void> {
    const tenantUser = await this.database.query(
      'SELECT id FROM public.tec_users WHERE tenant_id = $1 LIMIT 1',
      [tenantId]
    );
    if (tenantUser.rowCount === 0) throw new NotFoundException('Tenant has no POS users');
  }

  private async resolveSettingsRowId(tenantId: string, columns: Set<string>): Promise<number> {
    if (columns.has('tenant_id')) {
      const scoped = await this.database.query<{ setting_id: number }>(
        'SELECT setting_id FROM public.tec_settings WHERE tenant_id = $1 ORDER BY setting_id LIMIT 1',
        [tenantId]
      );
      if (scoped.rows[0]) return scoped.rows[0].setting_id;
      const shared = await this.database.query<{ setting_id: number }>(
        'SELECT setting_id FROM public.tec_settings WHERE tenant_id IS NULL ORDER BY setting_id LIMIT 1'
      );
      if (shared.rows[0]) return shared.rows[0].setting_id;
    }
    const fallback = await this.database.query<{ setting_id: number }>(
      'SELECT setting_id FROM public.tec_settings ORDER BY setting_id LIMIT 1'
    );
    const id = fallback.rows[0]?.setting_id;
    if (id === undefined) throw new NotFoundException('Global POS settings are unavailable');
    return id;
  }

  async getGlobalForTenant(tenantId: string) {
    return this.readSettings(tenantId, EDITABLE_COLUMNS);
  }

  async getPosForTenant(tenantId: string) {
    return this.readSettings(tenantId, POS_DISPLAY_COLUMNS);
  }

  private async readSettings(tenantId: string, allowed: readonly string[]) {
    await this.assertTenant(tenantId);
    const existing = await this.existingColumns();
    const columns = allowed.filter((column) => existing.has(column));
    const settingId = await this.resolveSettingsRowId(tenantId, existing);
    const select = columns.length > 0 ? `setting_id, ${columns.join(', ')}` : 'setting_id';
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT ${select} FROM public.tec_settings WHERE setting_id = $1 LIMIT 1`,
      [settingId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Global POS settings are unavailable');
    return { ...row, supported: columns };
  }

  async update(tenantId: string, input: UpdateSettingsDto) {
    await this.assertTenant(tenantId);
    const existing = await this.existingColumns();
    const columns = EDITABLE_COLUMNS.filter((column) => existing.has(column));
    const settingId = await this.resolveSettingsRowId(tenantId, existing);

    if ('default_customer' in input && input.default_customer !== null && input.default_customer !== undefined) {
      if (!Number.isSafeInteger(input.default_customer) || input.default_customer < 1) {
        throw new BadRequestException('default_customer must be a positive integer or null');
      }
    }

    const candidate = input as unknown as Record<string, unknown>;
    const updates = columns
      .filter((column) => column in candidate)
      .map((column) => ({ column, value: candidate[column] === undefined ? null : candidate[column] }));
    if (updates.length === 0) {
      throw new BadRequestException('No editable settings columns are available; run the pending ALTER TABLE statements');
    }

    const setClause = updates.map((update, index) => `${update.column} = $${index + 2}`).join(', ');
    const returning = columns.length > 0 ? `setting_id, ${columns.join(', ')}` : 'setting_id';
    const result = await this.database.query<Record<string, unknown>>(
      `UPDATE public.tec_settings
       SET ${setClause}
       WHERE setting_id = $1
       RETURNING ${returning}`,
      [settingId, ...updates.map((update) => update.value)]
    );
    return { ...result.rows[0], supported: columns };
  }

  async uploadLogo(tenantId: string, file: Express.Multer.File) {
    await this.assertTenant(tenantId);
    const existing = await this.existingColumns();
    if (!existing.has('logo_url')) {
      throw new BadRequestException('La columna logo_url no existe; ejecuta el ALTER TABLE pendiente para habilitar el logo');
    }
    const extension = ALLOWED_LOGO_TYPES[file.mimetype];
    if (!extension) throw new BadRequestException('Only PNG, JPG, WEBP or SVG images are allowed');
    if (!file.buffer || file.buffer.length === 0) throw new BadRequestException('The uploaded file is empty');
    if (file.size > MAX_LOGO_BYTES) throw new BadRequestException('The logo must be 2 MB or smaller');
    if (!this.publicBase) {
      throw new InternalServerErrorException('SUPABASE_PUBLIC_URL is required to store the logo');
    }

    const settingId = await this.resolveSettingsRowId(tenantId, existing);
    const previous = await this.database.query<{ logo_url: string | null }>(
      'SELECT logo_url FROM public.tec_settings WHERE setting_id = $1 LIMIT 1',
      [settingId]
    );

    const objectPath = `logos/${tenantId}_${Date.now()}.${extension}`;
    const uploaded = await this.supabase.client.storage
      .from(this.bucket)
      .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploaded.error) throw new InternalServerErrorException('Could not upload the logo');

    const publicUrl = `${this.publicBase}/storage/v1/object/public/${this.bucket}/${objectPath}`;
    try {
      const updated = await this.database.query(
        'UPDATE public.tec_settings SET logo_url = $2 WHERE setting_id = $1',
        [settingId, publicUrl]
      );
      if (updated.rowCount !== 1) throw new NotFoundException('Settings row not found');
    } catch (error) {
      await this.supabase.client.storage
        .from(this.bucket)
        .remove([objectPath])
        .catch(() => undefined);
      throw error;
    }
    await this.removeStoredLogo(previous.rows[0]?.logo_url ?? null);

    return { logo_url: publicUrl };
  }

  async deleteLogo(tenantId: string) {
    await this.assertTenant(tenantId);
    const existing = await this.existingColumns();
    if (!existing.has('logo_url')) {
      throw new BadRequestException('La columna logo_url no existe; ejecuta el ALTER TABLE pendiente');
    }
    const settingId = await this.resolveSettingsRowId(tenantId, existing);
    const previous = await this.database.query<{ logo_url: string | null }>(
      'SELECT logo_url FROM public.tec_settings WHERE setting_id = $1 LIMIT 1',
      [settingId]
    );
    await this.database.query(
      'UPDATE public.tec_settings SET logo_url = NULL WHERE setting_id = $1',
      [settingId]
    );
    await this.removeStoredLogo(previous.rows[0]?.logo_url ?? null);
    return { logo_url: null };
  }

  private async removeStoredLogo(value: string | null): Promise<void> {
    if (!value) return;
    const marker = `/storage/v1/object/public/${this.bucket}/`;
    const index = value.indexOf(marker);
    if (index === -1) return;
    const objectPath = value.slice(index + marker.length).split('?')[0];
    if (!objectPath.startsWith('logos/')) return;
    try {
      await this.supabase.client.storage.from(this.bucket).remove([objectPath]);
    } catch (_error: unknown) {
      // Best effort; the settings row was already updated.
    }
  }
}
