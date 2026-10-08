import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { CreateTenantDto } from './tenant.dto';

type TenantRow = {
  id: string;
  name: string;
  host: string | null;
  status: string;
  created_at: string | null;
  users_count: number;
  stores_count: number;
  sales_count: number;
};

@Injectable()
export class TenantsService {
  constructor(private readonly database: DatabaseService) {}

  async list(): Promise<TenantRow[]> {
    const result = await this.database.query<TenantRow>(
      `SELECT t.id::text AS id, t.name, t.host, t.status, t.created_at,
              (SELECT COUNT(*) FROM public.tec_users u WHERE u.tenant_id = t.id)::integer AS users_count,
              (SELECT COUNT(*) FROM public.tec_stores s WHERE s.tenant_id = t.id)::integer AS stores_count,
              (SELECT COUNT(*) FROM public.tec_sales v WHERE v.tenant_id = t.id)::integer AS sales_count
       FROM public.tec_tenants t
       ORDER BY t.created_at ASC, t.name ASC`
    );
    return result.rows;
  }

  async create(input: CreateTenantDto): Promise<TenantRow> {
    const id = randomUUID();
    const host = input.host?.trim().toLowerCase() || null;
    const name = input.name.trim();
    const status = input.status ?? 'active';
    try {
      return await this.database.transaction(async (client) => {
        const result = await client.query<Omit<TenantRow, 'users_count' | 'stores_count' | 'sales_count'>>(
          `INSERT INTO public.tec_tenants (id, name, host, status)
           VALUES ($1, $2, $3, $4)
           RETURNING id::text AS id, name, host, status, created_at`,
          [id, name, host, status]
        );
        await client.query(
          `INSERT INTO public.tec_stores (tenant_id, name, code)
           VALUES ($1, $2, $3)`,
          [id, 'Tienda Principal', 'MAIN']
        );
        return { ...result.rows[0], users_count: 0, stores_count: 1, sales_count: 0 };
      });
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : 'UNKNOWN';
      const constraint = typeof error === 'object' && error !== null && 'constraint' in error
        ? String((error as { constraint?: unknown }).constraint)
        : '';
      if (code === '23505') {
        throw new BadRequestException(
          constraint.includes('host') ? 'Tenant host is already in use' : 'Tenant could not be created'
        );
      }
      throw error;
    }
  }
}
