import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolvePublicBase } from '../common/image-url';
import { DatabaseService } from '../database/database.service';
import { SupabaseService } from '../database/supabase.service';
import { AdminBannerDto, AdminBrandingDto } from './marketplace.dto';

const PROBE_CACHE_MS = 60_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const PUBLIC_BANNER_LIMIT = 6;
const MIGRATION_HINT =
  'La marca/banners del marketplace no están disponibles: ejecuta la migración v0.10.0-marketplace-branding.sql';

const BANNER_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};
const BRAND_TYPES: Record<string, string> = {
  ...BANNER_TYPES,
  'image/svg+xml': 'svg'
};

export type MarketplaceBrandingRow = {
  id: number;
  logo_url: string | null;
  favicon_url: string | null;
  footer_description: string | null;
  footer_email: string | null;
  footer_phone: string | null;
  footer_whatsapp: string | null;
  footer_address: string | null;
  footer_instagram: string | null;
  footer_facebook: string | null;
  updated_at: string | null;
};

export type MarketplaceBannerRow = {
  id: number;
  slot: string;
  title: string | null;
  image_url: string;
  target_url: string | null;
  sort_order: number;
  active: boolean;
  created_at: string | null;
  clicks: number;
};

export type UploadedBrandFiles = {
  logo?: Express.Multer.File[];
  favicon?: Express.Multer.File[];
};

const BRANDING_FIELDS = `id, logo_url, favicon_url, footer_description, footer_email, footer_phone,
                         footer_whatsapp, footer_address, footer_instagram, footer_facebook, updated_at`;
const BANNER_FIELDS = `id, slot, title, image_url, target_url, sort_order, active, created_at`;

function normalizeOptional(value?: string | null): string | null {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
}

function assertHttpUrl(value: string, field: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
    return url.toString();
  } catch (_error: unknown) {
    throw new BadRequestException(`${field} debe ser una URL http(s) válida`);
  }
}

/**
 * Marca pública de tienderu.com (logo, favicon, footer) y banners pequeños del home.
 * Fail-safe: sin las tablas v0.10.0 las lecturas públicas degradan a null/[] y las
 * escrituras admin responden 503 con el hint de la migración.
 */
@Injectable()
export class MarketplaceBrandingService {
  private readonly logger = new Logger(MarketplaceBrandingService.name);
  private readonly bucket: string;
  private readonly publicBase: string;
  private brandingProbe: { exists: boolean; at: number } | null = null;
  private bannersProbe: { exists: boolean; at: number } | null = null;
  private bannerEventsProbe: { exists: boolean; at: number } | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly supabase: SupabaseService,
    config: ConfigService
  ) {
    this.bucket = config.get<string>('SUPABASE_PRODUCT_BUCKET') ?? 'productos';
    const internal = config.get<string>('SUPABASE_URL') ?? '';
    this.publicBase = resolvePublicBase(config.get<string>('SUPABASE_PUBLIC_URL'), internal);
  }

  // ---------------------------------------------------------------------------
  // Público (store)
  // ---------------------------------------------------------------------------

  async getPublicBranding() {
    if (!(await this.brandingExists())) return null;
    const result = await this.database.query<MarketplaceBrandingRow>(
      `SELECT ${BRANDING_FIELDS} FROM public.tec_marketplace_branding WHERE id = 1 LIMIT 1`
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      logo_url: row.logo_url,
      favicon_url: row.favicon_url,
      footer: {
        description: row.footer_description,
        email: row.footer_email,
        phone: row.footer_phone,
        whatsapp: row.footer_whatsapp,
        address: row.footer_address,
        instagram: row.footer_instagram,
        facebook: row.footer_facebook
      }
    };
  }

  async getActiveBanners() {
    if (!(await this.bannersExist())) return [];
    const result = await this.database.query<MarketplaceBannerRow>(
      `SELECT ${BANNER_FIELDS} FROM public.tec_marketplace_banners
       WHERE slot = 'home_strip' AND active = true AND btrim(image_url) <> ''
       ORDER BY sort_order ASC, id ASC
       LIMIT ${PUBLIC_BANNER_LIMIT}`
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      image_url: row.image_url,
      target_url: row.target_url
    }));
  }

  // ---------------------------------------------------------------------------
  // Admin (super admin, panel global)
  // ---------------------------------------------------------------------------

  async adminGetBranding(): Promise<MarketplaceBrandingRow> {
    await this.assertBrandingAvailable();
    const result = await this.database.query<MarketplaceBrandingRow>(
      `SELECT ${BRANDING_FIELDS} FROM public.tec_marketplace_branding WHERE id = 1 LIMIT 1`
    );
    return (
      result.rows[0] ?? {
        id: 1,
        logo_url: null,
        favicon_url: null,
        footer_description: null,
        footer_email: null,
        footer_phone: null,
        footer_whatsapp: null,
        footer_address: null,
        footer_instagram: null,
        footer_facebook: null,
        updated_at: null
      }
    );
  }

  async adminUpdateBranding(input: AdminBrandingDto, files: UploadedBrandFiles = {}) {
    await this.assertBrandingAvailable();
    const current = await this.adminGetBranding();

    const logoFile = files.logo?.[0];
    const faviconFile = files.favicon?.[0];
    const logoUrl = logoFile ? await this.uploadImage('branding', logoFile, BRAND_TYPES, 'el logo') : current.logo_url;
    const faviconUrl = faviconFile
      ? await this.uploadImage('branding', faviconFile, BRAND_TYPES, 'el favicon')
      : current.favicon_url;

    const pick = (value: string | undefined, previous: string | null): string | null =>
      value === undefined ? previous : normalizeOptional(value);

    const result = await this.database.query<MarketplaceBrandingRow>(
      `INSERT INTO public.tec_marketplace_branding
         (id, logo_url, favicon_url, footer_description, footer_email, footer_phone,
          footer_whatsapp, footer_address, footer_instagram, footer_facebook, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (id) DO UPDATE SET
         logo_url = EXCLUDED.logo_url,
         favicon_url = EXCLUDED.favicon_url,
         footer_description = EXCLUDED.footer_description,
         footer_email = EXCLUDED.footer_email,
         footer_phone = EXCLUDED.footer_phone,
         footer_whatsapp = EXCLUDED.footer_whatsapp,
         footer_address = EXCLUDED.footer_address,
         footer_instagram = EXCLUDED.footer_instagram,
         footer_facebook = EXCLUDED.footer_facebook,
         updated_at = NOW()
       RETURNING ${BRANDING_FIELDS}`,
      [
        logoUrl,
        faviconUrl,
        pick(input.footer_description, current.footer_description),
        pick(input.footer_email, current.footer_email),
        pick(input.footer_phone, current.footer_phone),
        pick(input.footer_whatsapp, current.footer_whatsapp),
        pick(input.footer_address, current.footer_address),
        pick(input.footer_instagram, current.footer_instagram),
        pick(input.footer_facebook, current.footer_facebook)
      ]
    );

    if (logoFile) await this.removeStoredImage(current.logo_url);
    if (faviconFile) await this.removeStoredImage(current.favicon_url);
    return result.rows[0];
  }

  async adminListBanners(): Promise<MarketplaceBannerRow[]> {
    await this.assertBannersAvailable();
    const withClicks = await this.bannerEventsExist();
    const result = await this.database.query<MarketplaceBannerRow>(
      withClicks
        ? `SELECT s.id, s.slot, s.title, s.image_url, s.target_url, s.sort_order, s.active, s.created_at,
                  COALESCE(e.clicks, 0)::integer AS clicks
           FROM public.tec_marketplace_banners s
           LEFT JOIN (
             SELECT banner_id, COUNT(*)::integer AS clicks
             FROM public.tec_marketplace_banner_events
             GROUP BY banner_id
           ) e ON e.banner_id = s.id
           WHERE s.slot = 'home_strip'
           ORDER BY s.sort_order ASC, s.id ASC`
        : `SELECT ${BANNER_FIELDS}, 0::integer AS clicks FROM public.tec_marketplace_banners
           WHERE slot = 'home_strip'
           ORDER BY sort_order ASC, id ASC`
    );
    return result.rows;
  }

  /** Registra un clic de banner (v0.11.2); best-effort y solo si el banner existe. */
  async recordBannerClick(bannerId: number): Promise<void> {
    try {
      if (!(await this.bannersExist())) return;
      if (!(await this.bannerEventsExist())) return;
      const banner = await this.database.query<{ id: number }>(
        `SELECT id FROM public.tec_marketplace_banners WHERE id = $1 LIMIT 1`,
        [bannerId]
      );
      if (banner.rowCount !== 1) return;
      await this.database.query(
        `INSERT INTO public.tec_marketplace_banner_events (banner_id) VALUES ($1)`,
        [bannerId]
      );
    } catch (_error: unknown) {
      // Métrica best-effort: nunca rompe la navegación del cliente.
    }
  }

  async adminCreateBanner(input: AdminBannerDto, file?: Express.Multer.File): Promise<MarketplaceBannerRow> {
    await this.assertBannersAvailable();
    const imageUrl = file
      ? await this.uploadImage('banners', file, BANNER_TYPES, 'la imagen del banner')
      : this.requireImageUrl(input.image_url);

    const result = await this.database.query<MarketplaceBannerRow>(
      `INSERT INTO public.tec_marketplace_banners
         (slot, title, image_url, target_url, sort_order, active)
       VALUES ('home_strip', $1, $2, $3, $4, $5)
       RETURNING ${BANNER_FIELDS}`,
      [
        normalizeOptional(input.title),
        imageUrl,
        input.target_url === undefined ? null : assertHttpUrl(input.target_url.trim(), 'target_url'),
        input.sort_order ?? 0,
        input.active ?? true
      ]
    );
    return result.rows[0];
  }

  async adminUpdateBanner(
    bannerId: number,
    input: AdminBannerDto,
    file?: Express.Multer.File
  ): Promise<MarketplaceBannerRow> {
    await this.assertBannersAvailable();
    const existing = await this.database.query<MarketplaceBannerRow>(
      `SELECT ${BANNER_FIELDS} FROM public.tec_marketplace_banners WHERE id = $1 LIMIT 1`,
      [bannerId]
    );
    const current = existing.rows[0];
    if (!current) throw new NotFoundException('Banner not found');

    const imageUrl = file
      ? await this.uploadImage('banners', file, BANNER_TYPES, 'la imagen del banner')
      : input.image_url === undefined
        ? current.image_url
        : this.requireImageUrl(input.image_url);

    const sets: string[] = [
      'image_url = $2',
      'title = $3',
      'target_url = $4',
      'sort_order = $5',
      'active = $6'
    ];
    const values: unknown[] = [
      bannerId,
      imageUrl,
      input.title === undefined ? current.title : normalizeOptional(input.title),
      input.target_url === undefined
        ? current.target_url
        : assertHttpUrl(input.target_url.trim(), 'target_url'),
      input.sort_order ?? current.sort_order,
      input.active ?? current.active
    ];
    const result = await this.database.query<MarketplaceBannerRow>(
      `UPDATE public.tec_marketplace_banners SET ${sets.join(', ')}
       WHERE id = $1
       RETURNING ${BANNER_FIELDS}`,
      values
    );
    if (file) await this.removeStoredImage(current.image_url);
    return result.rows[0];
  }

  async adminDeleteBanner(bannerId: number) {
    await this.assertBannersAvailable();
    const result = await this.database.query<{ image_url: string | null }>(
      `DELETE FROM public.tec_marketplace_banners WHERE id = $1 RETURNING image_url`,
      [bannerId]
    );
    const deleted = result.rows[0];
    if (!deleted) throw new NotFoundException('Banner not found');
    await this.removeStoredImage(deleted.image_url);
    return { id: bannerId, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  private requireImageUrl(value?: string): string {
    const clean = value?.trim() ?? '';
    if (clean === '') throw new BadRequestException('Sube una imagen o envía image_url');
    return assertHttpUrl(clean, 'image_url');
  }

  private async uploadImage(
    folder: string,
    file: Express.Multer.File,
    allowed: Record<string, string>,
    label: string
  ): Promise<string> {
    const extension = allowed[file.mimetype];
    if (!extension) {
      throw new BadRequestException(
        `Formato de ${label} no permitido (usa ${folder === 'branding' ? 'PNG, JPG, WEBP o SVG' : 'PNG, JPG o WEBP'})`
      );
    }
    if (!file.buffer || file.buffer.length === 0) throw new BadRequestException(`El archivo de ${label} está vacío`);
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException(`${label} debe pesar 2 MB o menos`);
    if (!this.publicBase) {
      throw new InternalServerErrorException('SUPABASE_PUBLIC_URL es requerido para almacenar imágenes del marketplace');
    }

    const objectPath = `marketplace/${folder}/${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}.${extension}`;
    const uploaded = await this.supabase.client.storage
      .from(this.bucket)
      .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploaded.error) {
      this.logger.error(`No se pudo subir ${label}: ${uploaded.error.message}`);
      throw new InternalServerErrorException(`No se pudo subir ${label}`);
    }
    return `${this.publicBase}/storage/v1/object/public/${this.bucket}/${objectPath}`;
  }

  private async removeStoredImage(value: string | null): Promise<void> {
    if (!value) return;
    const marker = `/storage/v1/object/public/${this.bucket}/`;
    const index = value.indexOf(marker);
    if (index === -1) return; // URL externa o legada: no se toca.
    const objectPath = value.slice(index + marker.length).split('?')[0];
    if (!objectPath) return;
    try {
      await this.supabase.client.storage.from(this.bucket).remove([objectPath]);
    } catch (_error: unknown) {
      // Best-effort: el cambio en base de datos ya quedó aplicado.
    }
  }

  private async brandingExists(): Promise<boolean> {
    return this.tableExists('tec_marketplace_branding', 'branding');
  }

  private async bannersExist(): Promise<boolean> {
    return this.tableExists('tec_marketplace_banners', 'banners');
  }

  private async bannerEventsExist(): Promise<boolean> {
    return this.tableExists('tec_marketplace_banner_events', 'banner_events');
  }

  private async assertBrandingAvailable(): Promise<void> {
    if (!(await this.brandingExists())) throw new ServiceUnavailableException(MIGRATION_HINT);
  }

  private async assertBannersAvailable(): Promise<void> {
    if (!(await this.bannersExist())) throw new ServiceUnavailableException(MIGRATION_HINT);
  }

  private async tableExists(
    table: string,
    cache: 'branding' | 'banners' | 'banner_events'
  ): Promise<boolean> {
    const now = Date.now();
    const current =
      cache === 'branding'
        ? this.brandingProbe
        : cache === 'banners'
          ? this.bannersProbe
          : this.bannerEventsProbe;
    if (current && now - current.at < PROBE_CACHE_MS) return current.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.${table}')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    if (cache === 'branding') this.brandingProbe = { exists, at: now };
    else if (cache === 'banners') this.bannersProbe = { exists, at: now };
    else this.bannerEventsProbe = { exists, at: now };
    return exists;
  }
}
