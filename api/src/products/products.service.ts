import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolvePublicBase, trimTrailingSlash } from '../common/image-url';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { DatabaseService } from '../database/database.service';
import { SupabaseService } from '../database/supabase.service';
import { TableRow } from '../database/database.types';
import { CreateProductDto, SetStockDto, UpdateProductDto } from './product.dto';

export type ProductImageSlot = 1 | 2 | 3;

type ProductAdminRow = Pick<
  TableRow<'tec_products'>,
  'id' | 'code' | 'name' | 'type' | 'reward_points' | 'image' | 'image_2' | 'image_3' | 'details'
> & {
  price: string | null;
  cost: string | null;
  tax: string | null;
  store_quantity: number | null;
  store_price: string | null;
  line_total_value: string | null;
  category_id: string | null;
  category_name: string | null;
};

export type ProductAdminPage = Paginated<ProductAdminRow> & {
  meta: Paginated<ProductAdminRow>['meta'] & { grand_total: string };
};
type ProductIdRow = Pick<TableRow<'tec_products'>, 'id'>;
type ProductImageRow = Pick<TableRow<'tec_products'>, 'id' | 'image' | 'image_2' | 'image_3'>;
type StoreIdRow = Pick<TableRow<'tec_stores'>, 'id'>;


const IMAGE_COLUMNS: Record<ProductImageSlot, 'image' | 'image_2' | 'image_3'> = {
  1: 'image',
  2: 'image_2',
  3: 'image_3'
};

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function cleanDetails(value: string | undefined): string | null {
  if (value === undefined) return null;
  const clean = value.replace(/<[^>]*>/g, '').trim();
  return clean.length > 0 ? clean.slice(0, 1000) : null;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  private readonly bucket: string;
  private readonly publicBase: string;
  private readonly internalBase: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly supabase: SupabaseService,
    config: ConfigService
  ) {
    this.bucket = config.get<string>('SUPABASE_PRODUCT_BUCKET') ?? 'productos';
    const internal = config.get<string>('SUPABASE_URL') ?? '';
    this.internalBase = trimTrailingSlash(internal);
    this.publicBase = resolvePublicBase(config.get<string>('SUPABASE_PUBLIC_URL'), internal);
    if (!this.publicBase) {
      this.logger.warn('SUPABASE_PUBLIC_URL is required to store browser-reachable image URLs');
    }
  }

  private toPublicUrl(value: string | null): string | null {
    if (!value) return value;
    if (this.internalBase && this.publicBase && value.startsWith(this.internalBase)) {
      return `${this.publicBase}${value.slice(this.internalBase.length)}`;
    }
    return value;
  }

  async list(
    tenantId: string,
    storeId: number,
    search: string,
    pagination: PaginationQuery
  ): Promise<ProductAdminPage> {
    const store = await this.database.query<StoreIdRow>(
      'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, storeId]
    );
    if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');

    const pattern = `%${escapeLike(search.trim().slice(0, 100))}%`;
    const [result, grandTotal] = await Promise.all([
      this.database.query<ProductAdminRow & { total_count: number }>(
        `SELECT p.id, p.code, p.name, p.type, p.reward_points,
                p.image, p.image_2, p.image_3, p.details,
                p.price::text AS price, p.cost::text AS cost, p.tax::text AS tax,
                COALESCE(p.quantity, 0) AS store_quantity, p.price::text AS store_price,
                ROUND((p.price)::numeric * COALESCE(p.quantity, 0), 2)::text AS line_total_value,
                p.category_id::text AS category_id, cat.name AS category_name,
                COUNT(*) OVER() AS total_count
         FROM public.tec_products p
         LEFT JOIN public.tec_categories cat
           ON cat.id = p.category_id AND cat.tenant_id = p.tenant_id
         WHERE p.tenant_id = $1 AND (p.name ILIKE $2 OR p.code ILIKE $2)
         ORDER BY p.name
         LIMIT $3 OFFSET $4`,
        [tenantId, pattern, pagination.limit, pagination.offset]
      ),
      this.database.query<{ grand_total: string }>(
        `SELECT ROUND(COALESCE(SUM((p.price)::numeric * COALESCE(p.quantity, 0)), 0), 2)::text AS grand_total
         FROM public.tec_products p
         WHERE p.tenant_id = $1 AND (p.name ILIKE $2 OR p.code ILIKE $2)`,
        [tenantId, pattern]
      )
    ]);
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => ({
      ...row,
      image: this.toPublicUrl(row.image),
      image_2: this.toPublicUrl(row.image_2),
      image_3: this.toPublicUrl(row.image_3)
    }));
    const page = buildPaginated(data, total, pagination);
    return { ...page, meta: { ...page.meta, grand_total: grandTotal.rows[0]?.grand_total ?? '0.00' } };
  }

  async create(tenantId: string, input: CreateProductDto) {
    await this.assertCategory(tenantId, input.category_id);
    return this.database.transaction(async (client) => {
      if (input.store_id !== undefined) {
        const store = await client.query<StoreIdRow>(
          'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
          [tenantId, input.store_id]
        );
        if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');
      }

      const product = await client.query<ProductIdRow>(
        `INSERT INTO public.tec_products (tenant_id, code, name, price, cost, tax, type, reward_points, details, category_id, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, 'standard', $7, $8, $9, $10)
         RETURNING id`,
        [
          tenantId,
          input.code.trim(),
          input.name.trim(),
          input.price,
          input.cost ?? '0',
          input.tax ?? '0',
          input.reward_points ?? 0,
          cleanDetails(input.details),
          input.category_id ?? null,
          input.quantity ?? 0
        ]
      );
      const productId = product.rows[0]?.id;
      if (productId === undefined) throw new BadRequestException('Product could not be created');

      return { id: productId };
    });
  }

  async update(tenantId: string, productId: number, input: UpdateProductDto) {
    await this.assertCategory(tenantId, input.category_id);
    const result = await this.database.query<ProductAdminRow>(
      `UPDATE public.tec_products
       SET code = COALESCE($3, code),
           name = COALESCE($4, name),
           price = COALESCE($5::numeric, price),
           cost = COALESCE($6::numeric, cost),
           tax = COALESCE($7::numeric, tax),
           reward_points = COALESCE($8, reward_points),
           details = CASE WHEN $9::boolean THEN $10 ELSE details END,
           category_id = CASE WHEN $11::boolean THEN $12 ELSE category_id END
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, code, name, type, details, reward_points, image, image_2, image_3,
                 price::text AS price, cost::text AS cost, tax::text AS tax,
                 category_id::text AS category_id`,
      [
        tenantId,
        productId,
        input.code?.trim() ?? null,
        input.name?.trim() ?? null,
        input.price ?? null,
        input.cost ?? null,
        input.tax ?? null,
        input.reward_points ?? null,
        input.details !== undefined,
        cleanDetails(input.details),
        input.category_id !== undefined,
        input.category_id ?? null
      ]
    );
    const updated = result.rows[0];
    if (!updated) throw new NotFoundException('Product not found in this tenant');
    return {
      ...updated,
      image: this.toPublicUrl(updated.image),
      image_2: this.toPublicUrl(updated.image_2),
      image_3: this.toPublicUrl(updated.image_3),
      store_quantity: null,
      store_price: null,
      line_total_value: null,
      category_name: null
    };
  }

  private async assertCategory(tenantId: string, categoryId: string | null | undefined): Promise<void> {
    if (categoryId === undefined || categoryId === null) return;
    const result = await this.database.query<{ id: string }>(
      'SELECT id FROM public.tec_categories WHERE tenant_id = $1 AND id::text = $2 LIMIT 1',
      [tenantId, categoryId]
    );
    if (result.rowCount !== 1) throw new NotFoundException('Category not found in this tenant');
  }

  async setStock(tenantId: string, productId: number, input: SetStockDto) {
    return this.database.transaction(async (client) => {
      const product = await client.query<ProductIdRow>(
        'SELECT id FROM public.tec_products WHERE tenant_id = $1 AND id = $2 LIMIT 1',
        [tenantId, productId]
      );
      if (product.rowCount !== 1) throw new NotFoundException('Product not found in this tenant');

      const store = await client.query<StoreIdRow>(
        'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
        [tenantId, input.store_id]
      );
      if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');

      await client.query(
        `UPDATE public.tec_products
         SET quantity = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, productId, input.quantity]
      );

      return { product_id: productId, store_id: input.store_id, quantity: input.quantity };
    });
  }

  async uploadImage(tenantId: string, productId: number, slot: ProductImageSlot, file: Express.Multer.File) {
    const column = IMAGE_COLUMNS[slot];
    const extension = ALLOWED_IMAGE_TYPES[file.mimetype];
    if (!extension) throw new BadRequestException('Only JPG, PNG or WEBP images are allowed');
    if (!file.buffer || file.buffer.length === 0) throw new BadRequestException('The uploaded file is empty');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('The image must be 2 MB or smaller');
    if (!this.publicBase) {
      throw new InternalServerErrorException('SUPABASE_PUBLIC_URL is required to store product images');
    }

    const existing = await this.database.query<ProductImageRow>(
      'SELECT id, image, image_2, image_3 FROM public.tec_products WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, productId]
    );
    const product = existing.rows[0];
    if (!product) throw new NotFoundException('Product not found in this tenant');
    const previous = product[column];

    const objectPath = `${productId}_${slot}_${Date.now()}.${extension}`;
    const uploaded = await this.supabase.client.storage
      .from(this.bucket)
      .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (uploaded.error) throw new InternalServerErrorException('Could not upload the product image');

    const publicUrl = `${this.publicBase}/storage/v1/object/public/${this.bucket}/${objectPath}`;
    await this.database.query(
      `UPDATE public.tec_products SET ${column} = $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, productId, publicUrl]
    );
    await this.removeStoredImage(previous);

    return { slot, image_url: publicUrl };
  }

  async deleteImage(tenantId: string, productId: number, slot: ProductImageSlot) {
    const column = IMAGE_COLUMNS[slot];
    const existing = await this.database.query<ProductImageRow>(
      'SELECT id, image, image_2, image_3 FROM public.tec_products WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, productId]
    );
    const product = existing.rows[0];
    if (!product) throw new NotFoundException('Product not found in this tenant');
    const previous = product[column];

    await this.database.query(
      `UPDATE public.tec_products SET ${column} = NULL WHERE tenant_id = $1 AND id = $2`,
      [tenantId, productId]
    );
    await this.removeStoredImage(previous);

    return { slot, image_url: null };
  }

  private async removeStoredImage(value: string | null): Promise<void> {
    if (!value) return;
    const marker = `/storage/v1/object/public/${this.bucket}/`;
    const index = value.indexOf(marker);
    if (index === -1) return; // Legacy filename or external URL: leave it untouched.
    const objectPath = value.slice(index + marker.length).split('?')[0];
    if (!objectPath) return;
    try {
      await this.supabase.client.storage.from(this.bucket).remove([objectPath]);
    } catch (_error: unknown) {
      // Removing the previous file is best-effort; the product update already succeeded.
    }
  }
}
