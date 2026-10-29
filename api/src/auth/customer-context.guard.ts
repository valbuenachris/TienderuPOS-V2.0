import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PosCustomer, PosRequest } from './auth.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CustomerContextGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PosRequest>();
    const claims = request.posClaims;
    if (claims?.type === 'marketplace_customer') {
      throw new ForbiddenException('Marketplace tokens cannot access the tenant customer app');
    }
    if (!claims?.tenant_id) throw new UnauthorizedException('Tenant-scoped token required');
    if (claims.type !== 'customer') throw new ForbiddenException('Customer token required');

    const tenantId = claims.tenant_id.toLowerCase();
    if (!UUID_RE.test(tenantId)) throw new UnauthorizedException('Invalid tenant claim');

    const customerId = Number(claims.sub);
    if (!Number.isSafeInteger(customerId) || customerId < 1) {
      throw new UnauthorizedException('Invalid customer claim');
    }

    const result = await this.database.query<PosCustomer>(
      `SELECT c.id, c.tenant_id::text AS tenant_id, c.name, c.email, c.phone, c.store_id,
              COALESCE(c.points_balance, 0)::integer AS points_balance
       FROM public.tec_customers c
       JOIN public.tec_tenants t ON t.id = c.tenant_id
       WHERE c.id = $1 AND c.tenant_id = $2 AND t.status = 'active'
         AND c.password IS NOT NULL
       LIMIT 1`,
      [customerId, tenantId]
    );
    const customer = result.rows[0];
    if (!customer) throw new UnauthorizedException('Customer account is unavailable');

    request.tenantId = tenantId;
    request.posCustomer = customer;
    return true;
  }
}
