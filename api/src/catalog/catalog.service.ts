import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { PosUser } from '../auth/auth.types';
import { resolvePublicBase, trimTrailingSlash } from '../common/image-url';
import { isAdminRole } from '../common/roles';
import { SupabaseService } from '../database/supabase.service';
import { DatabaseService } from '../database/database.service';
import { TableRow } from '../database/database.types';

type ProductListRow = Pick<
  TableRow<'tec_products'>,
  'id' | 'code' | 'name' | 'price' | 'tax' | 'type' | 'image' | 'image_2' | 'image_3' | 'details' | 'reward_points' | 'quantity' | 'points_cost'
>;
type CustomerListRow = Pick<TableRow<'tec_customers'>, 'id' | 'name' | 'email' | 'phone'>;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

const ABSOLUTE_IMAGE_RE = /^(https?:)?\/\//i;

function normalizeImageName(value: string | null): string | null {
  if (!value) return null;
  const clean = value.trim();
  if (!clean || clean.toLowerCase().startsWith('no_image')) return null;
  return clean;
}

function isAbsoluteImageUrl(value: string): boolean {
  return ABSOLUTE_IMAGE_RE.test(value) || value.startsWith('/');
}

function throwCatalogError(): never {
  throw new InternalServerErrorException('Catalog query failed');
}

@Injectable()
export class CatalogService {
  private readonly imageBase: string;
  private readonly imageFullBase: string;
  private readonly supabasePublicBase: string;
  private readonly supabaseInternalBase: string;
  private reviewsProbe: { exists: boolean; at: number } | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly database: DatabaseService,
    config: ConfigService
  ) {
    this.imageBase = config.get<string>('PRODUCT_IMAGE_BASE_URL') ?? '/uploads/thumbs';
    this.imageFullBase = this.imageBase.endsWith('/thumbs')
      ? this.imageBase.slice(0, -'/thumbs'.length)
      : this.imageBase;
    const internal = config.get<string>('SUPABASE_URL') ?? '';
    this.supabaseInternalBase = trimTrailingSlash(internal);
    this.supabasePublicBase = resolvePublicBase(config.get<string>('SUPABASE_PUBLIC_URL'), internal);
  }

  private resolveImageUrl(base: string, value: string | null): string | null {
    const name = normalizeImageName(value);
    if (!name) return null;
    // Supabase Storage (or any external host) stores the full URL: use it as-is.
    if (isAbsoluteImageUrl(name)) return this.toPublicUrl(name);
    // Legacy rows store just the filename: prefix it with the configured base.
    return `${base.replace(/\/+$/, '')}/${encodeURIComponent(name)}`;
  }

  private toPublicUrl(value: string): string {
    if (this.supabaseInternalBase && this.supabasePublicBase && value.startsWith(this.supabaseInternalBase)) {
      return `${this.supabasePublicBase}${value.slice(this.supabaseInternalBase.length)}`;
    }
    return value;
  }

  // Reusable resolver for other customer-facing modules (combos, etc.).
  resolveProductImageUrl(value: string | null): string | null {
    return this.resolveImageUrl(this.imageBase, value);
  }

  async listStores(tenantId: string, user: PosUser) {
    let query = this.supabase.client.from('tec_stores')
      .select('id, name, code')
      .eq('tenant_id', tenantId)
      .order('name')
      .limit(100);
    if (!isAdminRole(user.group_name)) {
      if (!user.store_id) return [];
      query = query.eq('id', user.store_id);
    }

    const result = await query;
    if (result.error) throwCatalogError();
    return result.data ?? [];
  }

  async listProducts(tenantId: string, search: string, storeId: number, categoryId?: string, withRatings = false) {
    const store = await this.supabase.client.from('tec_stores')
      .select('id').eq('tenant_id', tenantId).eq('id', storeId).maybeSingle();
    if (store.error) throwCatalogError();
    if (!store.data) throw new NotFoundException('Store not found in this tenant');

    const cleanSearch = search.trim().slice(0, 100);
    const fields = 'id, code, name, price, tax, type, image, image_2, image_3, quantity, reward_points, details, points_cost';
    let productRows: ProductListRow[] = [];

    if (!cleanSearch) {
      let query = this.supabase.client.from('tec_products')
        .select(fields).eq('tenant_id', tenantId);
      if (categoryId) query = query.filter('category_id', 'eq', categoryId);
      const result = await query.order('name').limit(100);
      if (result.error) throwCatalogError();
      productRows = result.data ?? [];
    } else {
      const pattern = `%${escapeLike(cleanSearch)}%`;
      let byNameQuery = this.supabase.client.from('tec_products')
        .select(fields).eq('tenant_id', tenantId).ilike('name', pattern);
      let byCodeQuery = this.supabase.client.from('tec_products')
        .select(fields).eq('tenant_id', tenantId).eq('code', cleanSearch);
      if (categoryId) {
        byNameQuery = byNameQuery.filter('category_id', 'eq', categoryId);
        byCodeQuery = byCodeQuery.filter('category_id', 'eq', categoryId);
      }
      const [byName, byCode] = await Promise.all([
        byNameQuery.limit(100),
        byCodeQuery.limit(100)
      ]);
      if (byName.error || byCode.error) throwCatalogError();
      const unique = new Map<number, ProductListRow>();
      for (const product of [...(byName.data ?? []), ...(byCode.data ?? [])]) unique.set(product.id, product);
      productRows = [...unique.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '')).slice(0, 100);
    }

    if (withRatings) {
      const ratings = await this.ratingsForProducts(productRows.map((product) => product.id));
      return productRows.map((product) => this.toProductDto(product, ratings.get(product.id)));
    }
    return productRows.map((product) => this.toProductDto(product));
  }

  async listRewardProducts(tenantId: string, limit = 100) {
    const fields = 'id, code, name, price, tax, type, image, image_2, image_3, quantity, reward_points, details, points_cost';
    const result = await this.supabase.client
      .from('tec_products')
      .select(fields)
      .eq('tenant_id', tenantId)
      .gt('points_cost', 0)
      .order('name')
      .limit(limit);
    if (result.error) throwCatalogError();
    const productRows: ProductListRow[] = result.data ?? [];
    return productRows.map((product) => this.toProductDto(product));
  }

  private toProductDto(product: ProductListRow, rating?: { average: number; count: number }) {
    const price = product.price === null
      ? null
      : new Decimal(product.price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    const rawImage = normalizeImageName(product.image);
    const hasAbsoluteImage = rawImage !== null && isAbsoluteImageUrl(rawImage);
    const imageUrl = this.resolveImageUrl(this.imageBase, product.image);
    const image2Url = this.resolveImageUrl(this.imageBase, product.image_2);
    const image3Url = this.resolveImageUrl(this.imageBase, product.image_3);
    const imageUrls = [imageUrl, image2Url, image3Url]
      .filter((url): url is string => url !== null && url.trim() !== '');
    return {
      ...product,
      price,
      tax: product.tax === null ? null : String(product.tax),
      image_url: imageUrl,
      image_full_url: hasAbsoluteImage ? null : this.resolveImageUrl(this.imageFullBase, product.image),
      image_2_url: image2Url,
      image_3_url: image3Url,
      imageUrls,
      available_quantity: String(product.quantity ?? 0),
      average_rating: rating ? rating.average : null,
      reviews_count: rating ? rating.count : 0
    };
  }

  private async ratingsForProducts(ids: number[]): Promise<Map<number, { average: number; count: number }>> {
    const ratings = new Map<number, { average: number; count: number }>();
    if (ids.length === 0) return ratings;
    if (!(await this.reviewsTableExists())) return ratings;

    const result = await this.database.query<{
      product_id: number;
      average_rating: string | null;
      reviews_count: number;
    }>(
      `SELECT product_id,
              ROUND(AVG(rating)::numeric, 2)::text AS average_rating,
              COUNT(*)::integer AS reviews_count
       FROM public.product_reviews
       WHERE product_id = ANY($1::int[])
       GROUP BY product_id`,
      [ids]
    );
    for (const row of result.rows) {
      ratings.set(row.product_id, {
        average: row.average_rating === null ? 0 : Number(row.average_rating),
        count: row.reviews_count
      });
    }
    return ratings;
  }

  private async reviewsTableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.reviewsProbe && now - this.reviewsProbe.at < 60_000) return this.reviewsProbe.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.product_reviews')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.reviewsProbe = { exists, at: now };
    return exists;
  }

  async listCustomers(tenantId: string, search = '', storeId?: number) {
    if (storeId !== undefined) {
      const store = await this.supabase.client.from('tec_stores')
        .select('id').eq('tenant_id', tenantId).eq('id', storeId).maybeSingle();
      if (store.error) throwCatalogError();
      if (!store.data) throw new NotFoundException('Store not found in this tenant');
    }

    const fields = 'id, name, email, phone';
    const cleanSearch = search.trim().slice(0, 100);
    const load = () => {
      let query = this.supabase.client.from('tec_customers')
        .select(fields).eq('tenant_id', tenantId).order('name').limit(100);
      if (storeId !== undefined) query = query.or(`store_id.is.null,store_id.eq.${storeId}`);
      return query;
    };

    if (!cleanSearch) {
      const result = await load();
      if (result.error) throwCatalogError();
      return result.data ?? [];
    }

    const pattern = `%${escapeLike(cleanSearch)}%`;
    const [byName, byEmail, byPhone] = await Promise.all([
      load().ilike('name', pattern),
      load().ilike('email', pattern),
      load().ilike('phone', pattern)
    ]);
    if (byName.error || byEmail.error || byPhone.error) throwCatalogError();
    const unique = new Map<number, CustomerListRow>();
    for (const customer of [...(byName.data ?? []), ...(byEmail.data ?? []), ...(byPhone.data ?? [])]) {
      unique.set(customer.id, customer);
    }
    return [...unique.values()]
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .slice(0, 100);
  }
}
