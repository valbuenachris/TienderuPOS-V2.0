import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PosUser } from '../auth/auth.types';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { isAdminRole } from '../common/roles';
import { DatabaseService } from '../database/database.service';
import { TableRow } from '../database/database.types';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto';

type CustomerAdminRow = Pick<TableRow<'tec_customers'>, 'id' | 'name' | 'email' | 'phone' | 'store_id'>;
type StoreIdRow = Pick<TableRow<'tec_stores'>, 'id'>;
type CustomerScopeRow = Pick<TableRow<'tec_customers'>, 'id' | 'store_id'>;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function normalizePhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

@Injectable()
export class CustomersService {
  constructor(private readonly database: DatabaseService) {}

  private isAdmin(user: PosUser): boolean {
    return isAdminRole(user.group_name);
  }

  private staffStoreId(user: PosUser): number {
    if (!user.store_id) {
      throw new BadRequestException('Assign this POS user to a store before managing customers');
    }
    return user.store_id;
  }

  async list(
    tenantId: string,
    user: PosUser,
    search: string,
    storeId: number | undefined,
    pagination: PaginationQuery
  ): Promise<Paginated<CustomerAdminRow>> {
    const effectiveStoreId = this.isAdmin(user) ? storeId : this.staffStoreId(user);
    const pattern = `%${escapeLike(search.trim().slice(0, 100))}%`;
    const values: unknown[] = [tenantId, pattern];
    let storeFilter = '';
    if (effectiveStoreId !== undefined) {
      values.push(effectiveStoreId);
      storeFilter = ` AND (store_id IS NULL OR store_id = $${values.length})`;
    }
    values.push(pagination.limit, pagination.offset);
    const result = await this.database.query<CustomerAdminRow & { total_count: number }>(
      `SELECT id, name, email, phone, store_id, COUNT(*) OVER() AS total_count
       FROM public.tec_customers
       WHERE tenant_id = $1 AND name ILIKE $2 ${storeFilter}
       ORDER BY name
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async create(tenantId: string, user: PosUser, input: CreateCustomerDto): Promise<CustomerAdminRow> {
    let storeId = input.store_id;
    if (!this.isAdmin(user)) {
      const assignedStore = this.staffStoreId(user);
      if (input.store_id !== undefined && input.store_id !== assignedStore) {
        throw new ForbiddenException('POS users cannot create customers for another store');
      }
      storeId = assignedStore;
    }
    await this.assertStore(tenantId, storeId);
    const result = await this.database.query<CustomerAdminRow>(
      `INSERT INTO public.tec_customers (tenant_id, name, email, phone, cf1, cf2, store_id)
       VALUES ($1, $2, $3, $4, '', '', $5)
       RETURNING id, name, email, phone, store_id`,
      [tenantId, input.name.trim(), input.email ?? '', normalizePhone(input.phone), storeId ?? null]
    );
    return result.rows[0];
  }

  async update(tenantId: string, user: PosUser, customerId: number, input: UpdateCustomerDto): Promise<CustomerAdminRow> {
    let storeId = input.store_id;
    if (!this.isAdmin(user)) {
      const assignedStore = this.staffStoreId(user);
      const existing = await this.database.query<CustomerScopeRow>(
        'SELECT id, store_id FROM public.tec_customers WHERE tenant_id = $1 AND id = $2 LIMIT 1',
        [tenantId, customerId]
      );
      const customer = existing.rows[0];
      if (!customer) throw new NotFoundException('Customer not found in this tenant');
      if (customer.store_id !== assignedStore) {
        throw new ForbiddenException('POS users can only edit customers of their own store');
      }
      if (input.store_id !== undefined && input.store_id !== assignedStore) {
        throw new ForbiddenException('POS users cannot move customers to another store');
      }
      storeId = assignedStore;
    }
    if (storeId !== undefined) await this.assertStore(tenantId, storeId);
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
        input.phone === undefined ? null : normalizePhone(input.phone),
        storeId ?? null
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
