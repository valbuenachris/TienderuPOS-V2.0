import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

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

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string): Promise<UserListRow[]> {
    const result = await this.database.query<UserListRow>(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
              g.name AS group_name, u.store_id, u.active
       FROM public.tec_users u
       LEFT JOIN public.tec_groups g
         ON g.id = u.group_id AND (g.tenant_id = $1 OR g.tenant_id IS NULL)
       WHERE u.tenant_id = $1
       ORDER BY u.username
       LIMIT 200`,
      [tenantId]
    );
    return result.rows;
  }
}
