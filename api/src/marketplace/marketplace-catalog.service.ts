import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { CatalogService } from '../catalog/catalog.service';
import { DatabaseService } from '../database/database.service';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { MarketplaceSettingsService } from './marketplace-settings.service';

export type MarketplaceProductQuery = {
  q?: string;
  category?: string;
  tenant?: string;
  minPrice?: string;
  maxPrice?: string;
  minRating?: string;
  sort?: string;
  excludeId?: number;
};

type ProductRow = {
  id: number;
  code: string | null;
  name: string | null;
  details: string | null;
  type: string | null;
  image: string | null;
  image_2: string | null;
  image_3: string | null;
  price: string | null;
  tax: string | null;
  quantity: number | null;
  tenant_id: string;
  seller_name: string | null;
  markup_percent: string;
  category_name: string | null;
  average_rating: string | null;
  reviews_count: number;
  total_count?: number;
};

type CategoryRow = { name: string; products_count: number };

type BannerRow = { id: number; image_url: string | null };

type ReviewRow = {
  id: number;
  rating: number;
  comment: string | null;
  created_at: string | null;
  customer_name: string | null;
};

const PROBE_CACHE_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;
const SORT_OPTIONS = ['relevance', 'price_asc', 'price_desc', 'rating', 'newest', 'name'] as const;
const REVIEW_IDENTITIES_HIDDEN = 'Cliente';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function parseMoneyFilter(value: string | undefined, field: string): Decimal | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new BadRequestException(`${field} must be a non-negative number`);
  }
  return parsed;
}

/**
 * Catálogo público de tienderu.com: solo productos de tenants con opt-in
 * (`tec_marketplace_settings.enabled`), tenants activos, con stock y precio.
 * El precio mostrado ya incluye impuestos del tenant y el markup del marketplace.
 */
@Injectable()
export class MarketplaceCatalogService {
  private reviewsProbe: { exists: boolean; at: number } | null = null;
  private bannersProbe: { exists: boolean; at: number } | null = null;
  private categoriesProbe: { exists: boolean; at: number } | null = null;
  private unaccentProbe: { exists: boolean; at: number } | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly catalog: CatalogService,
    private readonly settings: MarketplaceSettingsService
  ) {}

  async listProducts(
    query: MarketplaceProductQuery,
    pagination: PaginationQuery
  ): Promise<Paginated<ReturnType<MarketplaceCatalogService['toProductDto']>>> {
    if (!(await this.settings.tableExists())) {
      return buildPaginated([], 0, pagination);
    }

    const values: unknown[] = [];
    const filters: string[] = [];
    const search = query.q?.trim().slice(0, 100) ?? '';
    if (search !== '') {
      const pattern = `%${escapeLike(search)}%`;
      values.push(pattern);
      const index = values.length;
      const useUnaccent = await this.unaccentAvailable();
      filters.push(
        useUnaccent
          ? `(public.immutable_unaccent(p.name) ILIKE public.immutable_unaccent($${index}) OR p.code ILIKE $${index} OR public.immutable_unaccent(t.name) ILIKE public.immutable_unaccent($${index}))`
          : `(p.name ILIKE $${index} OR p.code ILIKE $${index} OR t.name ILIKE $${index})`
      );
    }
    if (query.category !== undefined && query.category.trim() !== '') {
      values.push(query.category.trim().slice(0, 120));
      filters.push(`LOWER(c.name) = LOWER($${values.length})`);
    }
    if (query.tenant !== undefined && query.tenant.trim() !== '') {
      const tenant = query.tenant.trim().toLowerCase();
      if (!UUID_RE.test(tenant)) throw new BadRequestException('tenant must be a UUID');
      values.push(tenant);
      filters.push(`p.tenant_id = $${values.length}`);
    }
    const minRatingRaw = query.minRating?.trim() ?? '';
    let minRating: number | null = null;
    if (minRatingRaw !== '') {
      const parsed = Number(minRatingRaw);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
        throw new BadRequestException('min_rating must be between 1 and 5');
      }
      minRating = parsed;
    }
    const minPrice = parseMoneyFilter(query.minPrice, 'min_price');
    const maxPrice = parseMoneyFilter(query.maxPrice, 'max_price');
    if (minPrice !== null) {
      values.push(minPrice.toFixed(2));
      filters.push(`(p.price * (1 + COALESCE(p.tax, 0) / 100) * (1 + mk.markup_percent / 100)) >= $${values.length}::numeric`);
    }
    if (maxPrice !== null) {
      values.push(maxPrice.toFixed(2));
      filters.push(`(p.price * (1 + COALESCE(p.tax, 0) / 100) * (1 + mk.markup_percent / 100)) <= $${values.length}::numeric`);
    }
    if (query.excludeId !== undefined) {
      values.push(query.excludeId);
      filters.push(`p.id <> $${values.length}`);
    }

    const includeRatings = await this.reviewsTableExists();
    const includeCategories = await this.categoriesTableExists();
    const sort = (query.sort ?? 'relevance').trim().toLowerCase();
    if (!(SORT_OPTIONS as readonly string[]).includes(sort)) {
      throw new BadRequestException(`sort must be one of ${SORT_OPTIONS.join(', ')}`);
    }
    if (minRating !== null && includeRatings) {
      values.push(minRating.toFixed(2));
      filters.push(`COALESCE(r.average_rating, 0) >= $${values.length}::numeric`);
    }
    const orderBy = this.orderBy(sort, includeRatings);
    const ratingsJoin = includeRatings
      ? `LEFT JOIN (
           SELECT product_id, AVG(rating)::numeric(3,2) AS average_rating, COUNT(*)::integer AS reviews_count
           FROM public.product_reviews
           GROUP BY product_id
         ) r ON r.product_id = p.id`
      : '';
    const ratingsSelect = includeRatings
      ? `r.average_rating::text AS average_rating, COALESCE(r.reviews_count, 0)::integer AS reviews_count`
      : `NULL::text AS average_rating, 0::integer AS reviews_count`;
    const categoriesJoin = includeCategories
      ? `LEFT JOIN public.tec_categories c ON c.id::text = p.category_id::text AND c.tenant_id = p.tenant_id`
      : '';
    const categoriesSelect = includeCategories ? 'c.name AS category_name' : 'NULL::text AS category_name';

    values.push(pagination.limit, pagination.offset);
    const result = await this.database.query<ProductRow>(
      `SELECT p.id, p.code, p.name, p.details, p.type, p.image, p.image_2, p.image_3,
              p.price::text AS price, p.tax::text AS tax, p.quantity,
              p.tenant_id::text AS tenant_id,
              COALESCE(NULLIF(TRIM(mk.store_display_name), ''), t.name) AS seller_name,
              mk.markup_percent::text AS markup_percent,
              ${categoriesSelect},
              ${ratingsSelect},
              COUNT(*) OVER() AS total_count
       FROM public.tec_products p
       JOIN public.tec_tenants t ON t.id = p.tenant_id AND t.status = 'active'
       JOIN public.tec_marketplace_settings mk ON mk.tenant_id = p.tenant_id AND mk.enabled = true
       ${categoriesJoin}
       ${ratingsJoin}
       WHERE p.quantity > 0
         AND p.price IS NOT NULL AND p.price > 0
         AND COALESCE(p.type, 'standard') <> 'combo'
         ${filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''}
       ORDER BY ${orderBy}
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = result.rows[0]?.total_count ?? 0;
    return buildPaginated(
      result.rows.map(({ total_count: _totalCount, ...row }) => this.toProductDto(row)),
      total,
      pagination
    );
  }

  async getProduct(productId: number) {
    if (!(await this.settings.tableExists())) throw new NotFoundException('Product not found');
    const includeRatings = await this.reviewsTableExists();
    const includeCategories = await this.categoriesTableExists();
    const ratingsJoin = includeRatings
      ? `LEFT JOIN (
           SELECT product_id, AVG(rating)::numeric(3,2) AS average_rating, COUNT(*)::integer AS reviews_count
           FROM public.product_reviews
           GROUP BY product_id
         ) r ON r.product_id = p.id`
      : '';
    const ratingsSelect = includeRatings
      ? `r.average_rating::text AS average_rating, COALESCE(r.reviews_count, 0)::integer AS reviews_count`
      : `NULL::text AS average_rating, 0::integer AS reviews_count`;
    const categoriesJoin = includeCategories
      ? `LEFT JOIN public.tec_categories c ON c.id::text = p.category_id::text AND c.tenant_id = p.tenant_id`
      : '';
    const categoriesSelect = includeCategories ? 'c.name AS category_name' : 'NULL::text AS category_name';

    const result = await this.database.query<ProductRow>(
      `SELECT p.id, p.code, p.name, p.details, p.type, p.image, p.image_2, p.image_3,
              p.price::text AS price, p.tax::text AS tax, p.quantity,
              p.tenant_id::text AS tenant_id,
              COALESCE(NULLIF(TRIM(mk.store_display_name), ''), t.name) AS seller_name,
              mk.markup_percent::text AS markup_percent,
              ${categoriesSelect},
              ${ratingsSelect}
       FROM public.tec_products p
       JOIN public.tec_tenants t ON t.id = p.tenant_id AND t.status = 'active'
       JOIN public.tec_marketplace_settings mk ON mk.tenant_id = p.tenant_id AND mk.enabled = true
       ${categoriesJoin}
       ${ratingsJoin}
       WHERE p.id = $1
         AND p.quantity > 0
         AND p.price IS NOT NULL AND p.price > 0
         AND COALESCE(p.type, 'standard') <> 'combo'
       LIMIT 1`,
      [productId]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Product not found');

    const product = this.toProductDto(row);
    const related = await this.listProducts(
      { category: row.category_name ?? undefined, excludeId: productId, sort: 'rating' },
      { page: 1, limit: 8, offset: 0 }
    );
    return { ...product, related: related.data };
  }

  async listCategories(): Promise<CategoryRow[]> {
    if (!(await this.settings.tableExists())) return [];
    if (!(await this.categoriesTableExists())) return [];
    const result = await this.database.query<CategoryRow>(
      `SELECT c.name AS name, COUNT(*)::integer AS products_count
       FROM public.tec_products p
       JOIN public.tec_tenants t ON t.id = p.tenant_id AND t.status = 'active'
       JOIN public.tec_marketplace_settings mk ON mk.tenant_id = p.tenant_id AND mk.enabled = true
       JOIN public.tec_categories c ON c.id::text = p.category_id::text AND c.tenant_id = p.tenant_id
       WHERE p.quantity > 0 AND p.price IS NOT NULL AND p.price > 0
         AND COALESCE(p.type, 'standard') <> 'combo'
         AND c.name IS NOT NULL AND btrim(c.name) <> ''
       GROUP BY c.name
       ORDER BY products_count DESC, c.name ASC
       LIMIT 100`
    );
    return result.rows;
  }

  async getSeller(tenantId: string, pagination: PaginationQuery = { page: 1, limit: 24, offset: 0 }) {
    const tenant = tenantId.trim().toLowerCase();
    if (!UUID_RE.test(tenant)) throw new BadRequestException('Invalid seller id');
    if (!(await this.settings.tableExists())) throw new NotFoundException('Seller not found');

    let seller: { id: string; name: string; enabled: boolean; logo_url: string | null } | undefined;
    try {
      const result = await this.database.query<{ id: string; name: string; enabled: boolean; logo_url: string | null }>(
        `SELECT t.id::text AS id, t.name, mk.enabled, ts.logo_url
         FROM public.tec_tenants t
         JOIN public.tec_marketplace_settings mk ON mk.tenant_id = t.id AND mk.enabled = true
         LEFT JOIN public.tec_tenant_settings ts ON ts.tenant_id = t.id
         WHERE t.id = $1 AND t.status = 'active'
         LIMIT 1`,
        [tenant]
      );
      seller = result.rows[0];
    } catch (_error: unknown) {
      // tec_tenant_settings ausente: el vendedor se muestra sin logo.
      const result = await this.database.query<{ id: string; name: string; enabled: boolean; logo_url: string | null }>(
        `SELECT t.id::text AS id, t.name, mk.enabled, NULL::text AS logo_url
         FROM public.tec_tenants t
         JOIN public.tec_marketplace_settings mk ON mk.tenant_id = t.id AND mk.enabled = true
         WHERE t.id = $1 AND t.status = 'active'
         LIMIT 1`,
        [tenant]
      );
      seller = result.rows[0];
    }
    if (!seller) throw new NotFoundException('Seller not found');

    const products = await this.listProducts({ tenant, sort: 'newest' }, pagination);
    return {
      seller: { id: seller.id, name: seller.name, logo_url: seller.logo_url },
      products
    };
  }

  /** XML del sitemap público (v0.11.2): home, búsqueda, productos, vendedores y categorías. */
  async buildSitemap(baseUrl: string): Promise<string> {
    const escapeXml = (value: string): string =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    const urls: string[] = [`${baseUrl}/`, `${baseUrl}/buscar`];
    if (await this.settings.tableExists()) {
      const [products, sellers, categories] = await Promise.all([
        this.database.query<{ id: number }>(
          `SELECT p.id FROM public.tec_products p
           JOIN public.tec_tenants t ON t.id = p.tenant_id AND t.status = 'active'
           JOIN public.tec_marketplace_settings mk ON mk.tenant_id = p.tenant_id AND mk.enabled = true
           WHERE p.quantity > 0 AND p.price IS NOT NULL AND p.price > 0
             AND COALESCE(p.type, 'standard') <> 'combo'
           ORDER BY p.id DESC
           LIMIT 5000`
        ),
        this.database.query<{ id: string }>(
          `SELECT t.id::text AS id FROM public.tec_tenants t
           JOIN public.tec_marketplace_settings mk ON mk.tenant_id = t.id AND mk.enabled = true
           WHERE t.status = 'active'
           ORDER BY t.id
           LIMIT 500`
        ),
        this.listCategories()
      ]);
      for (const product of products.rows) urls.push(`${baseUrl}/producto/${product.id}`);
      for (const seller of sellers.rows) urls.push(`${baseUrl}/vendedor/${seller.id}`);
      for (const category of categories) {
        urls.push(`${baseUrl}/buscar?category=${encodeURIComponent(category.name)}`);
      }
    }
    const body = urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
  }

  async getHome() {    const [newest, topRated, categories, banners] = await Promise.all([
      this.listProducts({ sort: 'newest' }, { page: 1, limit: 12, offset: 0 }),
      this.listProducts({ sort: 'rating' }, { page: 1, limit: 12, offset: 0 }),
      this.listCategories(),
      this.listBanners()
    ]);
    return {
      banners,
      categories: categories.slice(0, 10),
      newest: newest.data,
      top_rated: topRated.data.filter((product) => product.average_rating !== null).slice(0, 8)
    };
  }

  async listReviews(productId: number, pagination: PaginationQuery) {
    if (!(await this.reviewsTableExists())) {
      return { product_id: productId, average_rating: null, reviews_count: 0, reviews: buildPaginated([], 0, pagination) };
    }
    const [summary, list] = await Promise.all([
      this.database.query<{ average_rating: string | null; reviews_count: number }>(
        `SELECT AVG(rating)::numeric(3,2)::text AS average_rating, COUNT(*)::integer AS reviews_count
         FROM public.product_reviews
         WHERE product_id = $1`,
        [productId]
      ),
      this.database.query<ReviewRow & { total_count: number }>(
        `SELECT r.id, r.rating, r.comment, r.created_at,
                CASE
                  WHEN c.name IS NULL OR btrim(c.name) = '' THEN '${REVIEW_IDENTITIES_HIDDEN}'
                  WHEN POSITION(' ' IN btrim(c.name)) = 0 THEN SPLIT_PART(btrim(c.name), ' ', 1)
                  ELSE CONCAT(SPLIT_PART(btrim(c.name), ' ', 1), ' ', LEFT(SPLIT_PART(btrim(c.name), ' ', 2), 1), '.')
                END AS customer_name,
                COUNT(*) OVER() AS total_count
         FROM public.product_reviews r
         LEFT JOIN public.tec_customers c ON c.id = r.customer_id
         WHERE r.product_id = $1
         ORDER BY r.id DESC
         LIMIT $2 OFFSET $3`,
        [productId, pagination.limit, pagination.offset]
      )
    ]);
    const total = list.rows[0]?.total_count ?? 0;
    return {
      product_id: productId,
      average_rating: summary.rows[0]?.average_rating ?? null,
      reviews_count: summary.rows[0]?.reviews_count ?? 0,
      reviews: buildPaginated(
        list.rows.map(({ total_count: _totalCount, ...row }) => row),
        total,
        pagination
      )
    };
  }

  private orderBy(sort: string, includeRatings: boolean): string {
    switch (sort) {
      case 'price_asc':
        return `(p.price * (1 + COALESCE(p.tax, 0) / 100) * (1 + mk.markup_percent / 100)) ASC, p.id DESC`;
      case 'price_desc':
        return `(p.price * (1 + COALESCE(p.tax, 0) / 100) * (1 + mk.markup_percent / 100)) DESC, p.id DESC`;
      case 'rating':
        return includeRatings ? `r.average_rating DESC NULLS LAST, p.id DESC` : `p.id DESC`;
      case 'name':
        return `p.name ASC NULLS LAST, p.id DESC`;
      case 'newest':
      case 'relevance':
      default:
        return `p.id DESC`;
    }
  }

  private toProductDto(row: ProductRow) {
    const base = new Decimal(row.price ?? '0');
    const tax = new Decimal(row.tax ?? '0');
    const markup = new Decimal(row.markup_percent ?? '10');
    const baseWithTax = base.plus(base.times(tax).dividedBy(100).toDecimalPlaces(2, MONEY_ROUNDING));
    const price = baseWithTax.times(new Decimal(1).plus(markup.dividedBy(100))).toDecimalPlaces(2, MONEY_ROUNDING);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      details: row.details,
      category_name: row.category_name,
      price: price.toFixed(2),
      image_url: this.catalog.resolveProductImageUrl(row.image),
      image_2_url: this.catalog.resolveProductImageUrl(row.image_2),
      image_3_url: this.catalog.resolveProductImageUrl(row.image_3),
      available_quantity: row.quantity ?? 0,
      seller: { id: row.tenant_id, name: row.seller_name },
      average_rating: row.average_rating === null ? null : Number(row.average_rating),
      reviews_count: Number(row.reviews_count ?? 0)
    };
  }

  private async unaccentAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.unaccentProbe && now - this.unaccentProbe.at < PROBE_CACHE_MS) return this.unaccentProbe.exists;
    const result = await this.database.query<{ fn: string | null }>(
      `SELECT to_regprocedure('public.immutable_unaccent(text)')::text AS fn`
    );
    const exists = Boolean(result.rows[0]?.fn);
    this.unaccentProbe = { exists, at: now };
    return exists;
  }

  private async reviewsTableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.reviewsProbe && now - this.reviewsProbe.at < PROBE_CACHE_MS) return this.reviewsProbe.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.product_reviews')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.reviewsProbe = { exists, at: now };
    return exists;
  }

  private async categoriesTableExists(): Promise<boolean> {
    const now = Date.now();
    if (this.categoriesProbe && now - this.categoriesProbe.at < PROBE_CACHE_MS) return this.categoriesProbe.exists;
    const result = await this.database.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.tec_categories')::text AS table_name`
    );
    const exists = Boolean(result.rows[0]?.table_name);
    this.categoriesProbe = { exists, at: now };
    return exists;
  }

  private async listBanners(): Promise<Array<{ id: number; image_url: string }>> {
    const now = Date.now();
    if (!this.bannersProbe || now - this.bannersProbe.at >= PROBE_CACHE_MS) {
      const result = await this.database.query<{ table_name: string | null }>(
        `SELECT to_regclass('public.banners')::text AS table_name`
      );
      this.bannersProbe = { exists: Boolean(result.rows[0]?.table_name), at: now };
    }
    if (!this.bannersProbe.exists) return [];
    const result = await this.database.query<BannerRow>(
      `SELECT id, image_url
       FROM public.banners
       WHERE image_url IS NOT NULL AND btrim(image_url) <> ''
       ORDER BY created_at DESC, id DESC
       LIMIT 20`
    );
    return result.rows
      .filter((row): row is BannerRow & { image_url: string } => typeof row.image_url === 'string')
      .map((row) => ({ id: row.id, image_url: row.image_url }));
  }
}
