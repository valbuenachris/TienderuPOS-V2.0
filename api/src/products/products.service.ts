import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TableRow } from '../database/database.types';
import { CreateProductDto, SetStockDto, UpdateProductDto } from './product.dto';

type ProductAdminRow = Pick<TableRow<'tec_products'>, 'id' | 'code' | 'name' | 'type' | 'reward_points'> & {
  price: string | null;
  cost: string | null;
  tax: string | null;
  store_quantity: number | null;
  store_price: string | null;
};
type ProductIdRow = Pick<TableRow<'tec_products'>, 'id'>;
type StoreIdRow = Pick<TableRow<'tec_stores'>, 'id'>;
type StockIdRow = Pick<TableRow<'tec_product_store_qty'>, 'id'>;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class ProductsService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, storeId: number, search: string): Promise<ProductAdminRow[]> {
    const store = await this.database.query<StoreIdRow>(
      'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, storeId]
    );
    if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');

    const pattern = `%${escapeLike(search.trim().slice(0, 100))}%`;
    const result = await this.database.query<ProductAdminRow>(
      `SELECT p.id, p.code, p.name, p.type, p.reward_points,
              p.price::text AS price, p.cost::text AS cost, p.tax::text AS tax,
              q.quantity AS store_quantity, q.price::text AS store_price
       FROM public.tec_products p
       LEFT JOIN public.tec_product_store_qty q
         ON q.tenant_id = p.tenant_id AND q.store_id = $2 AND q.product_id = p.id
       WHERE p.tenant_id = $1 AND (p.name ILIKE $3 OR p.code ILIKE $3)
       ORDER BY p.name
       LIMIT 200`,
      [tenantId, storeId, pattern]
    );
    return result.rows;
  }

  async create(tenantId: string, input: CreateProductDto) {
    return this.database.transaction(async (client) => {
      if (input.store_id !== undefined) {
        const store = await client.query<StoreIdRow>(
          'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
          [tenantId, input.store_id]
        );
        if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');
      }

      const product = await client.query<ProductIdRow>(
        `INSERT INTO public.tec_products (tenant_id, code, name, price, cost, tax, type, reward_points)
         VALUES ($1, $2, $3, $4, $5, $6, 'standard', $7)
         RETURNING id`,
        [
          tenantId,
          input.code.trim(),
          input.name.trim(),
          input.price,
          input.cost ?? '0',
          input.tax ?? '0',
          input.reward_points ?? 0
        ]
      );
      const productId = product.rows[0]?.id;
      if (productId === undefined) throw new BadRequestException('Product could not be created');

      if (input.store_id !== undefined && input.quantity !== undefined) {
        await client.query(
          `INSERT INTO public.tec_product_store_qty (tenant_id, product_id, store_id, quantity)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, productId, input.store_id, input.quantity]
        );
      }

      return { id: productId };
    });
  }

  async update(tenantId: string, productId: number, input: UpdateProductDto) {
    const result = await this.database.query<ProductAdminRow>(
      `UPDATE public.tec_products
       SET code = COALESCE($3, code),
           name = COALESCE($4, name),
           price = COALESCE($5::numeric, price),
           cost = COALESCE($6::numeric, cost),
           tax = COALESCE($7::numeric, tax),
           reward_points = COALESCE($8, reward_points)
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, code, name, type, reward_points, price::text AS price, cost::text AS cost, tax::text AS tax`,
      [
        tenantId,
        productId,
        input.code?.trim() ?? null,
        input.name?.trim() ?? null,
        input.price ?? null,
        input.cost ?? null,
        input.tax ?? null,
        input.reward_points ?? null
      ]
    );
    const updated = result.rows[0];
    if (!updated) throw new NotFoundException('Product not found in this tenant');
    return { ...updated, store_quantity: null, store_price: null };
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

      const updated = await client.query<StockIdRow>(
        `UPDATE public.tec_product_store_qty
         SET quantity = $4
         WHERE tenant_id = $1 AND product_id = $2 AND store_id = $3
         RETURNING id`,
        [tenantId, productId, input.store_id, input.quantity]
      );
      if (updated.rowCount !== 1) {
        await client.query(
          `INSERT INTO public.tec_product_store_qty (tenant_id, product_id, store_id, quantity)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, productId, input.store_id, input.quantity]
        );
      }

      return { product_id: productId, store_id: input.store_id, quantity: input.quantity };
    });
  }
}
