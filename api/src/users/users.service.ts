import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PosUser } from '../auth/auth.types';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { hashForStorage, PasswordStorageMethod } from '../common/password';
import { DatabaseService } from '../database/database.service';
import { TenantManagementService } from '../tenant-management/tenant-management.service';
import { CreateUserDto, UpdateUserDto } from './user.dto';

type UserListRow = {
  id: number;
  username: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  group_name: string | null;
  store_id: number | null;
  active: number | null;
};

type UserSecurityRow = {
  id: number;
  group_id: number | null;
  group_name: string | null;
  store_id: number | null;
  active: number | null;
};

type GroupRow = { id: number; name: string | null };
type StoreIdRow = { id: number };
type CountRow = { count: number };

const USER_LIST_FIELDS = `u.id, u.username, u.email, u.first_name, u.last_name,
  g.name AS group_name, u.store_id, u.active`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class UsersService {
  private readonly passwordMethod: PasswordStorageMethod;
  private readonly bcryptRounds: number;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
    private readonly tenantManagement: TenantManagementService
  ) {
    this.passwordMethod = config.get<string>('USER_PASSWORD_METHOD') === 'bcrypt' ? 'bcrypt' : 'sha1';
    this.bcryptRounds = Number(config.get('BCRYPT_ROUNDS') ?? 12);
  }

  async list(tenantId: string, search: string, pagination: PaginationQuery): Promise<Paginated<UserListRow>> {
    const pattern = `%${escapeLike(search.trim().slice(0, 100))}%`;
    const result = await this.database.query<UserListRow & { total_count: number }>(
      `SELECT ${USER_LIST_FIELDS}, COUNT(*) OVER() AS total_count
       FROM public.tec_users u
       LEFT JOIN public.tec_groups g
         ON g.id = u.group_id AND (g.tenant_id = $1 OR g.tenant_id IS NULL)
       WHERE u.tenant_id = $1
         AND (u.username ILIKE $2 OR u.email ILIKE $2 OR u.first_name ILIKE $2 OR u.last_name ILIKE $2)
       ORDER BY u.username
       LIMIT $3 OFFSET $4`,
      [tenantId, pattern, pagination.limit, pagination.offset]
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  async create(tenantId: string, input: CreateUserDto): Promise<UserListRow> {
    await this.tenantManagement.assertCanAddUser(tenantId);
    await this.assertUnique(tenantId, input.username, input.email);
    const group = await this.resolveGroup(tenantId, input.role);
    await this.assertStore(tenantId, input.store_id);

    const passwordHash = await hashForStorage(input.password, this.passwordMethod, this.bcryptRounds);
    const result = await this.database.query<UserListRow>(
      `INSERT INTO public.tec_users
         (tenant_id, username, email, first_name, last_name, password, group_id, store_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, username, email, first_name, last_name, group_id, store_id, active`,
      [
        tenantId,
        input.username.trim(),
        input.email.trim().toLowerCase(),
        input.first_name.trim(),
        input.last_name.trim(),
        passwordHash,
        group.id,
        input.store_id ?? null,
        input.active === false ? 0 : 1
      ]
    );
    return { ...result.rows[0], group_name: group.name };
  }

  async update(tenantId: string, userId: number, input: UpdateUserDto, currentUser: PosUser): Promise<UserListRow> {
    const existing = await this.getSecurity(tenantId, userId);
    if (!existing) throw new NotFoundException('User not found in this tenant');

    if (input.username !== undefined || input.email !== undefined) {
      await this.assertUnique(tenantId, input.username, input.email, userId);
    }

    let group: GroupRow | null = null;
    if (input.role !== undefined) {
      group = await this.resolveGroup(tenantId, input.role);
    }
    const effectiveRole = input.role ?? (existing.group_name?.toLowerCase() === 'admin' ? 'admin' : 'staff');
    const effectiveStore = input.store_id !== undefined ? input.store_id : existing.store_id;
    if (effectiveRole === 'staff' && !effectiveStore) {
      throw new BadRequestException('Store is required for staff users');
    }
    if (input.store_id !== undefined) await this.assertStore(tenantId, input.store_id);

    if (input.active === false) {
      await this.assertCanDeactivate(tenantId, userId, existing, currentUser);
    }

    let passwordHash: string | null = null;
    if (input.password !== undefined) passwordHash = await hashForStorage(input.password, this.passwordMethod, this.bcryptRounds);

    const result = await this.database.query<UserListRow>(
      `UPDATE public.tec_users
       SET username = COALESCE($3, username),
           email = COALESCE($4, email),
           first_name = COALESCE($5, first_name),
           last_name = COALESCE($6, last_name),
           password = COALESCE($7, password),
           group_id = COALESCE($8, group_id),
           store_id = CASE WHEN $9::boolean THEN $10 ELSE store_id END,
           active = COALESCE($11, active)
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, username, email, first_name, last_name, group_id, store_id, active`,
      [
        tenantId,
        userId,
        input.username?.trim() ?? null,
        input.email?.trim().toLowerCase() ?? null,
        input.first_name?.trim() ?? null,
        input.last_name?.trim() ?? null,
        passwordHash,
        group?.id ?? null,
        input.store_id !== undefined,
        input.store_id ?? null,
        input.active === undefined ? null : (input.active ? 1 : 0)
      ]
    );
    const groupName = group?.name ?? existing.group_name;
    return { ...result.rows[0], group_name: groupName };
  }

  async setActive(tenantId: string, userId: number, active: boolean, currentUser: PosUser): Promise<UserListRow> {
    const existing = await this.getSecurity(tenantId, userId);
    if (!existing) throw new NotFoundException('User not found in this tenant');
    if (!active) await this.assertCanDeactivate(tenantId, userId, existing, currentUser);

    const result = await this.database.query<UserListRow>(
      `UPDATE public.tec_users
       SET active = $3
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, username, email, first_name, last_name, group_id, store_id, active`,
      [tenantId, userId, active ? 1 : 0]
    );
    return { ...result.rows[0], group_name: existing.group_name };
  }

  private async getSecurity(tenantId: string, userId: number): Promise<UserSecurityRow | null> {
    const result = await this.database.query<UserSecurityRow>(
      `SELECT u.id, u.group_id, g.name AS group_name, u.store_id, u.active
       FROM public.tec_users u
       LEFT JOIN public.tec_groups g
         ON g.id = u.group_id AND (g.tenant_id = $1 OR g.tenant_id IS NULL)
       WHERE u.tenant_id = $1 AND u.id = $2
       LIMIT 1`,
      [tenantId, userId]
    );
    return result.rows[0] ?? null;
  }

  private async assertCanDeactivate(
    tenantId: string,
    userId: number,
    existing: UserSecurityRow,
    currentUser: PosUser
  ): Promise<void> {
    if (userId === currentUser.id) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    if (existing.active === 1 && existing.group_name?.toLowerCase() === 'admin') {
      const admins = await this.database.query<CountRow>(
        `SELECT COUNT(*)::integer AS count
         FROM public.tec_users u
         JOIN public.tec_groups g
           ON g.id = u.group_id AND (g.tenant_id = $1 OR g.tenant_id IS NULL)
         WHERE u.tenant_id = $1 AND u.active = 1 AND lower(g.name) = 'admin'`,
        [tenantId]
      );
      if ((admins.rows[0]?.count ?? 0) <= 1) {
        throw new BadRequestException('You cannot deactivate the last active administrator');
      }
    }
  }

  private async resolveGroup(tenantId: string, role: 'admin' | 'staff'): Promise<GroupRow> {
    const result = await this.database.query<GroupRow>(
      `SELECT id, name
       FROM public.tec_groups
       WHERE lower(name) = $2 AND (tenant_id = $1 OR tenant_id IS NULL)
       ORDER BY (tenant_id IS NULL) ASC, id DESC
       LIMIT 1`,
      [tenantId, role]
    );
    const group = result.rows[0];
    if (!group) throw new BadRequestException(`No "${role}" group exists for this tenant`);
    return group;
  }

  private async assertStore(tenantId: string, storeId?: number): Promise<void> {
    if (storeId === undefined) return;
    const store = await this.database.query<StoreIdRow>(
      'SELECT id FROM public.tec_stores WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, storeId]
    );
    if (store.rowCount !== 1) throw new NotFoundException('Store not found in this tenant');
  }

  private async assertUnique(tenantId: string, username?: string, email?: string, excludeId?: number): Promise<void> {
    if (username !== undefined) {
      const values: unknown[] = [tenantId, username.trim().toLowerCase()];
      let exclude = '';
      if (excludeId !== undefined) {
        values.push(excludeId);
        exclude = ` AND id <> $${values.length}`;
      }
      const existing = await this.database.query<{ id: number }>(
        `SELECT id FROM public.tec_users
         WHERE tenant_id = $1 AND lower(username) = $2 ${exclude}
         LIMIT 1`,
        values
      );
      if (existing.rowCount === 1) throw new BadRequestException('Username is already in use');
    }
    if (email !== undefined) {
      const values: unknown[] = [tenantId, email.trim().toLowerCase()];
      let exclude = '';
      if (excludeId !== undefined) {
        values.push(excludeId);
        exclude = ` AND id <> $${values.length}`;
      }
      const existing = await this.database.query<{ id: number }>(
        `SELECT id FROM public.tec_users
         WHERE tenant_id = $1 AND lower(email) = $2 ${exclude}
         LIMIT 1`,
        values
      );
      if (existing.rowCount === 1) throw new BadRequestException('Email is already in use');
    }
  }

}
