import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PosUser } from '../auth/auth.types';
import { SupabaseService } from '../database/supabase.service';
import { TableRow } from '../database/database.types';

type ProductListRow = Pick<
  TableRow<'tec_products'>,
  'id' | 'code' | 'name' | 'price' | 'tax' | 'type'
>;

type StoreStockRow = Pick<TableRow<'tec_product_store_qty'>, 'product_id' | 'quantity' | 'price'>;
type CustomerListRow = Pick<TableRow<'tec_customers'>, 'id' | 'name' | 'email' | 'phone'>;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function throwCatalogError(): never {
  throw new InternalServerErrorException('Catalog query failed');
}

@Injectable()
export class CatalogService {
  constructor(private readonly supabase: SupabaseService) {}

  async listStores(tenantId: string, user: PosUser) {
    let query = this.supabase.client.from('tec_stores')
      .select('id, name, code')
      .eq('tenant_id', tenantId)
      .order('name')
      .limit(100);
    if (user.group_name?.toLowerCase() !== 'admin') {
      if (!user.store_id) return [];
      query = query.eq('id', user.store_id);
    }

    const result = await query;
    if (result.error) throwCatalogError();
    return result.data ?? [];
  }

  async listProducts(tenantId: string, search: string, storeId: number) {
    const store = await this.supabase.client.from('tec_stores')
      .select('id').eq('tenant_id', tenantId).eq('id', storeId).maybeSingle();
    if (store.error) throwCatalogError();
    if (!store.data) throw new NotFoundException('Store not found in this tenant');

    const cleanSearch = search.trim().slice(0, 100);
    const fields = 'id, code, name, price, tax, type';
    let productRows: ProductListRow[] = [];

    if (!cleanSearch) {
      const result = await this.supabase.client.from('tec_products')
        .select(fields).eq('tenant_id', tenantId).order('name').limit(100);
      if (result.error) throwCatalogError();
      productRows = result.data ?? [];
    } else {
      const pattern = `%${escapeLike(cleanSearch)}%`;
      const [byName, byCode] = await Promise.all([
        this.supabase.client.from('tec_products')
          .select(fields).eq('tenant_id', tenantId).ilike('name', pattern).limit(100),
        this.supabase.client.from('tec_products')
          .select(fields).eq('tenant_id', tenantId).eq('code', cleanSearch).limit(100)
      ]);
      if (byName.error || byCode.error) throwCatalogError();
      const unique = new Map<number, ProductListRow>();
      for (const product of [...(byName.data ?? []), ...(byCode.data ?? [])]) unique.set(product.id, product);
      productRows = [...unique.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '')).slice(0, 100);
    }

    const stockByProduct = new Map<number, StoreStockRow>();
    const duplicateStockProducts = new Set<number>();
    if (productRows.length > 0) {
      const stock = await this.supabase.client.from('tec_product_store_qty')
        .select('product_id, quantity, price')
        .eq('tenant_id', tenantId)
        .eq('store_id', storeId)
        .in('product_id', productRows.map((product) => product.id));
      if (stock.error) throwCatalogError();
      for (const row of stock.data ?? []) {
        if (stockByProduct.has(row.product_id)) duplicateStockProducts.add(row.product_id);
        else stockByProduct.set(row.product_id, row);
      }
    }

    return productRows.map((product) => {
      const stock = stockByProduct.get(product.id);
      const rawPrice = stock?.price ?? product.price;
      const price = rawPrice === null
        ? null
        : new Decimal(rawPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
      return {
        ...product,
        price,
        tax: product.tax === null ? null : String(product.tax),
        available_quantity: duplicateStockProducts.has(product.id) ? '0' : String(stock?.quantity ?? 0)
      };
    });
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

    let customers: CustomerListRow[] = [];
    if (!cleanSearch) {
      const result = await load();
      if (result.error) throwCatalogError();
      customers = result.data ?? [];
    } else {
      const result = await load().ilike('name', `%${escapeLike(cleanSearch)}%`);
      if (result.error) throwCatalogError();
      customers = result.data ?? [];
    }
    return customers;
  }
}
