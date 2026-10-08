import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit
} from '@nestjs/common';
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
const TENANT_SETTINGS_TABLE = 'tec_tenant_settings';

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private readonly bucket: string;
  private readonly publicBase: string;
  private columnsCache: { columns: Set<string>; at: number } | null = null;
  private tenantColumnsCache: { columns: Set<string>; at: number } | null = null;
  private tenantSettingsReady = false;
  private lastReadyCheck = 0;

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

  async onModuleInit(): Promise<void> {
    const ready = await this.useTenantSettings(true);
    if (!ready) {
      this.logger.warn(
        'tec_tenant_settings is missing; settings stay global (legacy tec_settings). Run docs/migrations/v0.3.16-tenant-settings.sql; the API re-checks automatically.'
      );
    }
  }

  private async useTenantSettings(force = false): Promise<boolean> {
    if (this.tenantSettingsReady) return true;
    const now = Date.now();
    if (!force && now - this.lastReadyCheck < 30000) return false;
    this.lastReadyCheck = now;
    try {
      const result = await this.database.query<{ exists: boolean }>(
        'SELECT to_regclass($1) IS NOT NULL AS exists',
        [`public.${TENANT_SETTINGS_TABLE}`]
      );
      this.tenantSettingsReady = result.rows[0]?.exists === true;
    } catch (_error: unknown) {
      this.tenantSettingsReady = false;
    }
    if (this.tenantSettingsReady) {
      this.logger.log('tec_tenant_settings detected; using per-tenant settings');
    }
    return this.tenantSettingsReady;
  }

  async getGlobalForTenant(tenantId: string) {
    if (await this.useTenantSettings()) return this.readTenantSettings(tenantId, EDITABLE_COLUMNS);
    return this.readSettingsLegacy(tenantId, EDITABLE_COLUMNS);
  }

  async getPosForTenant(tenantId: string) {
    if (await this.useTenantSettings()) return this.readTenantSettings(tenantId, POS_DISPLAY_COLUMNS);
    return this.readSettingsLegacy(tenantId, POS_DISPLAY_COLUMNS);
  }

  async update(tenantId: string, input: UpdateSettingsDto) {
    if (await this.useTenantSettings()) return this.updateTenantSettings(tenantId, input);
    return this.updateLegacy(tenantId, input);
  }

  async ensureTenantSettings(tenantId: string, siteName?: string): Promise<void> {
    if (await this.useTenantSettings()) {
      await this.ensureTenantRow(tenantId, siteName);
      return;
    }
    const columns = await this.existingColumns();
    if (!columns.has('tenant_id')) return;
    const scoped = await this.database.query<{ setting_id: number }>(
      'SELECT setting_id FROM public.tec_settings WHERE tenant_id = $1 ORDER BY setting_id LIMIT 1',
      [tenantId]
    );
    if (scoped.rows[0]) return;
    await this.provisionLegacyTenantRow(tenantId, columns, siteName);
  }

  async uploadLogo(tenantId: string, file: Express.Multer.File) {
    const extension = this.logoExtension(file);
    if (await this.useTenantSettings()) {
      await this.assertTenant(tenantId);
      await this.ensureTenantRow(tenantId);
      const columns = await this.tenantColumns();
      if (!columns.has('logo_url')) {
        throw new BadRequestException('La tabla tec_tenant_settings no tiene logo_url; ejecuta la migración v0.3.16');
      }
      const bucket = await this.supabase.client.storage.getBucket(this.bucket);
      if (bucket.error) {
        this.logger.error(`Logo upload: storage bucket "${this.bucket}" unavailable (${bucket.error.message})`);
        throw new InternalServerErrorException(
          `El bucket de almacenamiento "${this.bucket}" no existe o no es accesible; créalo público en Supabase Storage`
        );
      }
      const previous = await this.database.query<{ logo_url: string | null }>(
        'SELECT logo_url FROM public.tec_tenant_settings WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      const objectPath = `logos/${tenantId}_${Date.now()}.${extension}`;
      this.logger.log(`Logo upload start tenant=${tenantId} bytes=${file.size} type=${file.mimetype} path=${objectPath}`);
      const uploaded = await this.supabase.client.storage
        .from(this.bucket)
        .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });
      if (uploaded.error) {
        this.logger.error(`Logo upload failed tenant=${tenantId} path=${objectPath}: ${uploaded.error.message}`);
        throw new InternalServerErrorException(`No se pudo subir el logo: ${uploaded.error.message}`);
      }

      const publicUrl = `${this.publicBase}/storage/v1/object/public/${this.bucket}/${objectPath}`;
      try {
        const updated = await this.database.query(
          'UPDATE public.tec_tenant_settings SET logo_url = $2, updated_at = now() WHERE tenant_id = $1',
          [tenantId, publicUrl]
        );
        if (updated.rowCount !== 1) throw new NotFoundException('Tenant settings row not found');
      } catch (error: unknown) {
        await this.supabase.client.storage
          .from(this.bucket)
          .remove([objectPath])
          .catch(() => undefined);
        this.logger.error(`Logo DB update failed tenant=${tenantId}: ${error instanceof Error ? error.message : 'unknown'}`);
        throw error;
      }
      await this.removeStoredLogo(previous.rows[0]?.logo_url ?? null, tenantId);
      this.logger.log(`Logo saved tenant=${tenantId} url=${publicUrl}`);
      return { logo_url: publicUrl };
    }

    await this.assertTenant(tenantId);
    const existing = await this.existingColumns();
    if (!existing.has('logo_url')) {
      throw new BadRequestException('La columna logo_url no existe; ejecuta el ALTER TABLE pendiente para habilitar el logo');
    }
    const settingId = await this.resolveSettingsRowId(tenantId, existing);
    const bucket = await this.supabase.client.storage.getBucket(this.bucket);
    if (bucket.error) {
      this.logger.error(`Logo upload: storage bucket "${this.bucket}" unavailable (${bucket.error.message})`);
      throw new InternalServerErrorException(
        `El bucket de almacenamiento "${this.bucket}" no existe o no es accesible; créalo público en Supabase Storage`
      );
    }
    const previous = await this.database.query<{ logo_url: string | null }>(
      'SELECT logo_url FROM public.tec_settings WHERE setting_id = $1 LIMIT 1',
      [settingId]
    );

    const objectPath = `logos/${tenantId}_${Date.now()}.${extension}`;
    this.logger.log(`Logo upload start (legacy settings) tenant=${tenantId} bytes=${file.size} type=${file.mimetype} path=${objectPath}`);
    const uploaded = await this.supabase.client.storage
      .from(this.bucket)
      .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploaded.error) {
      this.logger.error(`Logo upload failed tenant=${tenantId} path=${objectPath}: ${uploaded.error.message}`);
      throw new InternalServerErrorException(`No se pudo subir el logo: ${uploaded.error.message}`);
    }

    const publicUrl = `${this.publicBase}/storage/v1/object/public/${this.bucket}/${objectPath}`;
    try {
      const updated = await this.database.query(
        'UPDATE public.tec_settings SET logo_url = $2 WHERE setting_id = $1',
        [settingId, publicUrl]
      );
      if (updated.rowCount !== 1) throw new NotFoundException('Settings row not found');
    } catch (error: unknown) {
      await this.supabase.client.storage
        .from(this.bucket)
        .remove([objectPath])
        .catch(() => undefined);
      this.logger.error(`Logo DB update failed tenant=${tenantId}: ${error instanceof Error ? error.message : 'unknown'}`);
      throw error;
    }
    await this.removeStoredLogo(previous.rows[0]?.logo_url ?? null, tenantId);
    this.logger.log(`Logo saved tenant=${tenantId} url=${publicUrl}`);

    return { logo_url: publicUrl };
  }

  async deleteLogo(tenantId: string) {
    if (await this.useTenantSettings()) {
      await this.assertTenant(tenantId);
      await this.ensureTenantRow(tenantId);
      const previous = await this.database.query<{ logo_url: string | null }>(
        'SELECT logo_url FROM public.tec_tenant_settings WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      await this.database.query(
        'UPDATE public.tec_tenant_settings SET logo_url = NULL, updated_at = now() WHERE tenant_id = $1',
        [tenantId]
      );
      await this.removeStoredLogo(previous.rows[0]?.logo_url ?? null, tenantId);
      return { logo_url: null };
    }

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
    await this.removeStoredLogo(previous.rows[0]?.logo_url ?? null, tenantId);
    return { logo_url: null };
  }

  private logoExtension(file: Express.Multer.File): string {
    const extension = ALLOWED_LOGO_TYPES[file.mimetype];
    if (!extension) throw new BadRequestException('Only PNG, JPG, WEBP or SVG images are allowed');
    if (!file.buffer || file.buffer.length === 0) throw new BadRequestException('The uploaded file is empty');
    if (file.size > MAX_LOGO_BYTES) throw new BadRequestException('The logo must be 2 MB or smaller');
    if (!this.publicBase) {
      throw new InternalServerErrorException('SUPABASE_PUBLIC_URL is required to store the logo');
    }
    return extension;
  }

  private assertDefaultCustomer(input: UpdateSettingsDto): void {
    if ('default_customer' in input && input.default_customer !== null && input.default_customer !== undefined) {
      if (!Number.isSafeInteger(input.default_customer) || input.default_customer < 1) {
        throw new BadRequestException('default_customer must be a positive integer or null');
      }
    }
  }

  private async readTenantSettings(tenantId: string, allowed: readonly string[]) {
    await this.assertTenant(tenantId);
    await this.ensureTenantRow(tenantId);
    const existing = await this.tenantColumns();
    const columns = allowed.filter((column) => existing.has(column));
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT ${columns.length > 0 ? columns.join(', ') : 'tenant_id'}
       FROM public.tec_tenant_settings
       WHERE tenant_id = $1
       LIMIT 1`,
      [tenantId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Tenant settings are unavailable');
    return { ...row, supported: columns };
  }

  private async updateTenantSettings(tenantId: string, input: UpdateSettingsDto) {
    await this.assertTenant(tenantId);
    await this.ensureTenantRow(tenantId);
    this.assertDefaultCustomer(input);
    const existing = await this.tenantColumns();
    const columns = EDITABLE_COLUMNS.filter((column) => existing.has(column));
    const candidate = input as unknown as Record<string, unknown>;
    const updates = columns
      .filter((column) => column in candidate)
      .map((column) => ({ column, value: candidate[column] === undefined ? null : candidate[column] }));
    if (updates.length === 0) {
      throw new BadRequestException('No editable settings columns are available; run the pending migration');
    }
    const setClause = updates.map((update, index) => `${update.column} = $${index + 2}`).join(', ');
    const result = await this.database.query<Record<string, unknown>>(
      `UPDATE public.tec_tenant_settings
       SET ${setClause}, updated_at = now()
       WHERE tenant_id = $1
       RETURNING ${columns.join(', ')}`,
      [tenantId, ...updates.map((update) => update.value)]
    );
    return { ...result.rows[0], supported: columns };
  }

  private async tenantColumns(): Promise<Set<string>> {
    const now = Date.now();
    if (this.tenantColumnsCache && now - this.tenantColumnsCache.at < COLUMN_CACHE_MS) {
      return this.tenantColumnsCache.columns;
    }
    const result = await this.database.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [TENANT_SETTINGS_TABLE]
    );
    const columns = new Set(result.rows.map((row) => row.column_name));
    this.tenantColumnsCache = { columns, at: now };
    return columns;
  }

  private async ensureTenantRow(tenantId: string, siteName?: string): Promise<void> {
    const existing = await this.database.query<{ id: string }>(
      'SELECT id::text AS id FROM public.tec_tenant_settings WHERE tenant_id = $1 LIMIT 1',
      [tenantId]
    );
    if (existing.rowCount === 1) return;
    const tenant = await this.database.query<{ name: string }>(
      'SELECT name FROM public.tec_tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    const columns = await this.tenantColumns();
    const insertColumns = ['tenant_id'];
    const values: unknown[] = [tenantId];
    if (columns.has('site_name')) {
      insertColumns.push('site_name');
      values.push(siteName ?? tenant.rows[0]?.name ?? 'POS');
    }
    if (columns.has('logo_url')) {
      insertColumns.push('logo_url');
      values.push(null);
    }
    await this.database.query(
      `INSERT INTO public.tec_tenant_settings (${insertColumns.join(', ')})
       VALUES (${values.map((_value, index) => `$${index + 1}`).join(', ')})
       ON CONFLICT (tenant_id) DO NOTHING`,
      values
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

  private async assertTenant(tenantId: string): Promise<void> {
    const tenant = await this.database.query<{ id: string }>(
      `SELECT id::text AS id FROM public.tec_tenants
       WHERE id = $1 AND (status IS NULL OR status <> 'deleted')
       LIMIT 1`,
      [tenantId]
    );
    if (tenant.rowCount !== 1) throw new NotFoundException('Tenant not found');
  }

  private async provisionLegacyTenantRow(
    tenantId: string,
    columns: Set<string>,
    siteName?: string
  ): Promise<number | null> {
    // Never inherit another tenant's logo (or the legacy PRINCESS SKIN branding).
    const copyColumns = Array.from(columns).filter(
      (column) => column !== 'setting_id' && column !== 'tenant_id' && column !== 'logo_url'
    );
    const base = copyColumns.length > 0
      ? await this.database.query<Record<string, unknown>>(
          `SELECT ${copyColumns.join(', ')}
           FROM public.tec_settings
           ORDER BY (tenant_id IS NULL) DESC, setting_id ASC
           LIMIT 1`
        )
      : { rows: [] as Array<Record<string, unknown>> };
    const baseRow = base.rows[0] ?? null;
    const tenant = await this.database.query<{ name: string }>(
      'SELECT name FROM public.tec_tenants WHERE id = $1 LIMIT 1',
      [tenantId]
    );
    const tenantName = tenant.rows[0]?.name ?? null;

    const values: unknown[] = [tenantId];
    const insertColumns = ['tenant_id'];
    for (const column of copyColumns) {
      insertColumns.push(column);
      if (column === 'site_name') values.push(siteName ?? baseRow?.site_name ?? tenantName ?? 'POS');
      else values.push(baseRow?.[column] ?? null);
    }
    const placeholders = values.map((_value, index) => `$${index + 1}`).join(', ');

    try {
      const inserted = await this.database.query<{ setting_id: number }>(
        `INSERT INTO public.tec_settings (${insertColumns.join(', ')})
         VALUES (${placeholders})
         RETURNING setting_id`,
        values
      );
      return inserted.rows[0]?.setting_id ?? null;
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
      if (code !== '23505') throw error;
      const existing = await this.database.query<{ setting_id: number }>(
        'SELECT setting_id FROM public.tec_settings WHERE tenant_id = $1 ORDER BY setting_id LIMIT 1',
        [tenantId]
      );
      return existing.rows[0]?.setting_id ?? null;
    }
  }

  private async resolveSettingsRowId(tenantId: string, columns: Set<string>): Promise<number> {
    if (columns.has('tenant_id')) {
      const scoped = await this.database.query<{ setting_id: number }>(
        'SELECT setting_id FROM public.tec_settings WHERE tenant_id = $1 ORDER BY setting_id LIMIT 1',
        [tenantId]
      );
      if (scoped.rows[0]) return scoped.rows[0].setting_id;
      const provisioned = await this.provisionLegacyTenantRow(tenantId, columns);
      if (provisioned !== null) return provisioned;
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

  private async readSettingsLegacy(tenantId: string, allowed: readonly string[]) {
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

  private async updateLegacy(tenantId: string, input: UpdateSettingsDto) {
    await this.assertTenant(tenantId);
    const existing = await this.existingColumns();
    const columns = EDITABLE_COLUMNS.filter((column) => existing.has(column));
    const settingId = await this.resolveSettingsRowId(tenantId, existing);
    this.assertDefaultCustomer(input);

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

  private async removeStoredLogo(value: string | null, tenantId: string): Promise<void> {
    if (!value) return;
    const marker = `/storage/v1/object/public/${this.bucket}/`;
    const index = value.indexOf(marker);
    if (index === -1) return;
    const objectPath = value.slice(index + marker.length).split('?')[0];
    if (!objectPath.startsWith('logos/')) return;
    if (!objectPath.startsWith(`logos/${tenantId.toLowerCase()}_`)) return;
    try {
      await this.supabase.client.storage.from(this.bucket).remove([objectPath]);
    } catch (_error: unknown) {
      // Best effort; the settings row was already updated.
    }
  }
}
