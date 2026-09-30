import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TableRow } from '../database/database.types';
import { CreateSupplierDto, UpdateSupplierDto } from './supplier.dto';

type SupplierRow = Pick<TableRow<'tec_suppliers'>, 'id' | 'name' | 'cf1' | 'cf2' | 'phone' | 'email'>;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class SuppliersService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, search: string): Promise<SupplierRow[]> {
    const pattern = `%${escapeLike(search.trim().slice(0, 100))}%`;
    const result = await this.database.query<SupplierRow>(
      `SELECT id, name, cf1, cf2, phone, email
       FROM public.tec_suppliers
       WHERE tenant_id = $1 AND name ILIKE $2
       ORDER BY name
       LIMIT 200`,
      [tenantId, pattern]
    );
    return result.rows;
  }

  async create(tenantId: string, input: CreateSupplierDto): Promise<SupplierRow> {
    const result = await this.database.query<SupplierRow>(
      `INSERT INTO public.tec_suppliers (tenant_id, name, cf1, cf2, phone, email)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, cf1, cf2, phone, email`,
      [tenantId, input.name.trim(), input.cf1 ?? '', input.cf2 ?? '', input.phone ?? '', input.email ?? '']
    );
    return result.rows[0];
  }

  async update(tenantId: string, supplierId: number, input: UpdateSupplierDto): Promise<SupplierRow> {
    const result = await this.database.query<SupplierRow>(
      `UPDATE public.tec_suppliers
       SET name = COALESCE($3, name),
           cf1 = COALESCE($4, cf1),
           cf2 = COALESCE($5, cf2),
           phone = COALESCE($6, phone),
           email = COALESCE($7, email)
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, name, cf1, cf2, phone, email`,
      [
        tenantId,
        supplierId,
        input.name?.trim() ?? null,
        input.cf1 ?? null,
        input.cf2 ?? null,
        input.phone ?? null,
        input.email ?? null
      ]
    );
    const updated = result.rows[0];
    if (!updated) throw new NotFoundException('Supplier not found in this tenant');
    return updated;
  }
}
