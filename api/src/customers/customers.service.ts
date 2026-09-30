import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TableRow } from '../database/database.types';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto';

type CustomerAdminRow = Pick<TableRow<'tec_customers'>, 'id' | 'name' | 'email' | 'phone' | 'store_id'>;
type StoreIdRow = Pick<TableRow<'tec_stores'>, 'id'>;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class CustomersService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, search: string, storeId?: number): Promise<CustomerAdminRow[]> {
    const pattern = `%${escapeLike(search.trim().slice(0, 100))}%`;
    const values: unknown[] = [tenantId, pattern];
    let storeFilter = '';
    if (storeId !== undefined) {
      values.push(storeId);
      storeFilter = ` AND (store_id IS NULL OR store_id = $${values.length})`;
    }
    const result = await this.database.query<CustomerAdminRow>(
      `SELECT id, name, email, phone, store_id
       FROM public.tec_customers
       WHERE tenant_id = $1 AND name ILIKE $2 ${storeFilter}
       ORDER BY name
       LIMIT 200`,
      values
    );
    return result.rows;
  }

  async create(tenantId: string, input: CreateCustomerDto): Promise<CustomerAdminRow> {
    await this.assertStore(tenantId, input.store_id);
    const result = await this.database.query<CustomerAdminRow>(
      `INSERT INTO public.tec_customers (tenant_id, name, email, phone, cf1, cf2, store_id)
       VALUES ($1, $2, $3, $4, '', '', $5)
       RETURNING id, name, email, phone, store_id`,
      [tenantId, input.name.trim(), input.email ?? '', input.phone ?? '', input.store_id ?? null]
    );
    return result.rows[0];
  }

  async update(tenantId: string, customerId: number, input: UpdateCustomerDto): Promise<CustomerAdminRow> {
    if (input.store_id !== undefined) await this.assertStore(tenantId, input.store_id);
    const result = await this.database.query<CustomerAdminRow>(
      `UPDATE public.tec_customers
       SET name = COALESCE($3, name),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone),
           store_id = COALESCE($6, store_id)
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, name, email, phone, store_id`,
      [
        tenantId,
        customerId,
        input.name?.trim() ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.store_id ?? null
      ]
    );
    const updated = result.rows[0];
    if (!updated) throw new NotFoundException('Customer not found in this tenant');
    return updated;
  }

  private async assertStore(tenantId: string, storeId?: number): Promise<void> {
    if (storeId === undefined) return;
    const store = await this.database.query<StoreIdRow>(
      'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, storeId]
    );
    if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');
  }
}
