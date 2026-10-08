import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID } from 'node:crypto';
import { hashForStorage, PasswordStorageMethod } from '../common/password';
import { DatabaseService } from '../database/database.service';
import { SettingsService } from '../settings/settings.service';
import { TenantManagementService } from '../tenant-management/tenant-management.service';
import { CreateTenantDto, UpdateTenantDto } from './tenant.dto';

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

export type TenantBootstrapResult = TenantRow & {
  admin_username: string;
  admin_password: string;
};

type GroupIdRow = { id: number };
type UserIdRow = { id: number };
type StoreIdRow = { id: number };
type CountRow = { count: number };

function sanitizeSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
    .replace(/_+$/g, '');
}

function generatePassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const chars = [upper[randomInt(upper.length)], digits[randomInt(digits.length)]];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join('');
}

@Injectable()
export class TenantsService {
  private readonly passwordMethod: PasswordStorageMethod;
  private readonly bcryptRounds: number;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
    private readonly tenantManagement: TenantManagementService,
    private readonly settings: SettingsService
  ) {
    this.passwordMethod = config.get<string>('USER_PASSWORD_METHOD') === 'bcrypt' ? 'bcrypt' : 'sha1';
    this.bcryptRounds = Number(config.get('BCRYPT_ROUNDS') ?? 12);
  }

  async list(): Promise<TenantRow[]> {
    const result = await this.database.query<TenantRow>(
      `SELECT t.id::text AS id, t.name, t.host, t.status, t.created_at,
              (SELECT COUNT(*) FROM public.tec_users u WHERE u.tenant_id = t.id)::integer AS users_count,
              (SELECT COUNT(*) FROM public.tec_stores s WHERE s.tenant_id = t.id)::integer AS stores_count,
              (SELECT COUNT(*) FROM public.tec_sales v WHERE v.tenant_id = t.id)::integer AS sales_count
       FROM public.tec_tenants t
       WHERE t.status <> 'deleted'
       ORDER BY t.created_at ASC, t.name ASC`
    );
    return result.rows;
  }

  async create(input: CreateTenantDto, performedBy?: number | null): Promise<TenantBootstrapResult> {
    const id = randomUUID();
    const host = input.host?.trim().toLowerCase() || null;
    const name = input.name.trim();
    const status = input.status ?? 'active';
    const slug = sanitizeSlug(name) || 'tenant';
    const plan = await this.tenantManagement.resolvePlanForCreation(input.plan_id);

    try {
      const adminGroup = await this.database.query<GroupIdRow>(
        `SELECT id FROM public.tec_groups
         WHERE lower(name) = 'admin' AND tenant_id IS NULL
         ORDER BY id
         LIMIT 1`
      );
      const groupId = adminGroup.rows[0]?.id;
      if (groupId === undefined) {
        throw new BadRequestException('Shared admin group is not configured');
      }

      let username = '';
      for (let attempt = 0; attempt < 20 && username === ''; attempt += 1) {
        const suffix = attempt === 0 ? '' : `_${attempt}`;
        const candidate = `${slug}_admin${suffix}`;
        const existing = await this.database.query<UserIdRow>(
          'SELECT id FROM public.tec_users WHERE lower(username) = $1 LIMIT 1',
          [candidate]
        );
        if (existing.rowCount === 0) username = candidate;
      }
      if (username === '') {
        throw new BadRequestException('Could not generate a unique admin username');
      }

      const password = generatePassword();
      const passwordHash = await hashForStorage(password, this.passwordMethod, this.bcryptRounds);
      const email = `${username}@${slug}.local`;

      const created = await this.database.transaction(async (client) => {
        const tenantResult = await client.query<Omit<TenantRow, 'users_count' | 'stores_count' | 'sales_count'>>(
          `INSERT INTO public.tec_tenants (id, name, host, status)
           VALUES ($1, $2, $3, $4)
           RETURNING id::text AS id, name, host, status, created_at`,
          [id, name, host, status]
        );
        const storeResult = await client.query<StoreIdRow>(
          `INSERT INTO public.tec_stores (tenant_id, name, code)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [id, 'Tienda Principal', 'MAIN']
        );
        const storeId = storeResult.rows[0]?.id;
        if (storeId === undefined) throw new BadRequestException('Default store could not be created');

        await client.query(
          `INSERT INTO public.tec_users
             (tenant_id, username, email, first_name, last_name, password, group_id, store_id, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)`,
          [id, username, email, 'Administrador', 'Principal', passwordHash, groupId, storeId]
        );

        await this.tenantManagement.bootstrapSubscription(client, id, plan);

        return {
          ...tenantResult.rows[0],
          users_count: 1,
          stores_count: 1,
          sales_count: 0,
          admin_username: username,
          admin_password: password
        };
      });
      await this.tenantManagement.logActivity(
        id,
        'tenant_created',
        { name, host, plan: plan?.name ?? null, admin_username: username },
        performedBy ?? null
      );
      await this.settings.ensureTenantSettings(id, name).catch(() => undefined);
      return created;
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : 'UNKNOWN';
      const constraint = typeof error === 'object' && error !== null && 'constraint' in error
        ? String((error as { constraint?: unknown }).constraint)
        : '';
      if (code === '23505') {
        if (constraint.includes('username')) {
          throw new BadRequestException('Admin username collision; retry tenant creation');
        }
        throw new BadRequestException(
          constraint.includes('host') ? 'Tenant host is already in use' : 'Tenant could not be created'
        );
      }
      throw error;
    }
  }

  async update(tenantId: string, input: UpdateTenantDto): Promise<TenantRow> {
    const id = tenantId.toLowerCase();
    const existing = await this.database.query<{ id: string }>(
      `SELECT id::text AS id FROM public.tec_tenants WHERE id = $1 AND status <> 'deleted' LIMIT 1`,
      [id]
    );
    if (existing.rowCount !== 1) throw new NotFoundException('Tenant not found');

    const sets: string[] = [];
    const values: unknown[] = [id];
    if (input.name !== undefined) {
      values.push(input.name.trim());
      sets.push(`name = $${values.length}`);
    }
    if (input.host !== undefined) {
      const host = input.host === null || input.host.trim() === '' ? null : input.host.trim().toLowerCase();
      values.push(host);
      sets.push(`host = $${values.length}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      sets.push(`status = $${values.length}`);
    }
    if (sets.length === 0) throw new BadRequestException('Nothing to update');

    await this.database.query(
      `UPDATE public.tec_tenants SET ${sets.join(', ')} WHERE id = $1`,
      values
    );

    const result = await this.database.query<TenantRow>(
      `SELECT t.id::text AS id, t.name, t.host, t.status, t.created_at,
              (SELECT COUNT(*) FROM public.tec_users u WHERE u.tenant_id = t.id)::integer AS users_count,
              (SELECT COUNT(*) FROM public.tec_stores s WHERE s.tenant_id = t.id)::integer AS stores_count,
              (SELECT COUNT(*) FROM public.tec_sales v WHERE v.tenant_id = t.id)::integer AS sales_count
       FROM public.tec_tenants t
       WHERE t.id = $1
       LIMIT 1`,
      [id]
    );
    const tenant = result.rows[0];
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async remove(currentTenantId: string, tenantId: string, performedBy?: number | null): Promise<void> {
    const id = tenantId.toLowerCase();
    const existing = await this.database.query<{ id: string; name: string; status: string | null }>(
      'SELECT id::text AS id, name, status FROM public.tec_tenants WHERE id = $1 LIMIT 1',
      [id]
    );
    const tenant = existing.rows[0];
    if (!tenant || tenant.status === 'deleted') throw new NotFoundException('Tenant not found');
    if (id === currentTenantId.toLowerCase()) {
      throw new BadRequestException('No puedes eliminar el tenant activo; cambia de contexto primero');
    }

    const sales = await this.database.query<CountRow>(
      'SELECT COUNT(*)::integer AS count FROM public.tec_sales WHERE tenant_id = $1',
      [id]
    );
    if ((sales.rows[0]?.count ?? 0) > 0) {
      throw new BadRequestException('No se puede eliminar: el tenant tiene ventas registradas');
    }

    const users = await this.database.query<CountRow>(
      `SELECT COUNT(*)::integer AS count
       FROM public.tec_users u
       LEFT JOIN public.tec_groups g
         ON g.id = u.group_id AND (g.tenant_id = u.tenant_id OR g.tenant_id IS NULL)
       WHERE u.tenant_id = $1 AND u.active = 1 AND COALESCE(lower(g.name), '') <> 'admin'`,
      [id]
    );
    if ((users.rows[0]?.count ?? 0) > 0) {
      throw new BadRequestException('No se puede eliminar: el tenant tiene usuarios activos');
    }

    const inventory = await this.database.query<CountRow>(
      `SELECT COUNT(*)::integer AS count
       FROM public.tec_product_store_qty
       WHERE tenant_id = $1 AND COALESCE(quantity, 0) > 0`,
      [id]
    );
    if ((inventory.rows[0]?.count ?? 0) > 0) {
      throw new BadRequestException('No se puede eliminar: el tenant tiene inventario activo');
    }

    await this.database.query(
      `UPDATE public.tec_tenants SET status = 'deleted', host = NULL WHERE id = $1`,
      [id]
    );
    await this.tenantManagement.logActivity(id, 'tenant_deleted', { name: tenant.name }, performedBy ?? null);
  }
}
