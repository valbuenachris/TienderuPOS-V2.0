import { CanActivate, ExecutionContext, ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { SupabaseService } from '../database/supabase.service';
import { TableRow } from '../database/database.types';
import { PosRequest, PosUser } from './auth.types';

type SessionDataRow = Omit<Pick<TableRow<'tec_sessions'>, 'data'>, 'data'> & { data: Buffer | string };
type SessionPayload = { tenantId: string; userId: number; issuedAt: number; homeTenantId?: string; super?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSessionPayload(value: Buffer | string): SessionPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);
  } catch (_error: unknown) {
    return null;
  }
  if (!isRecord(parsed)
    || typeof parsed.tenantId !== 'string'
    || typeof parsed.userId !== 'number'
    || !Number.isSafeInteger(parsed.userId)
    || typeof parsed.issuedAt !== 'number'
    || !Number.isSafeInteger(parsed.issuedAt)) {
    return null;
  }
  if (parsed.homeTenantId !== undefined && typeof parsed.homeTenantId !== 'string') return null;
  if (parsed.super !== undefined && typeof parsed.super !== 'boolean') return null;
  return {
    tenantId: parsed.tenantId,
    userId: parsed.userId,
    issuedAt: parsed.issuedAt,
    homeTenantId: parsed.homeTenantId as string | undefined,
    super: parsed.super as boolean | undefined
  };
}

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PosRequest>();
    const claims = request.posClaims;
    if (!claims?.tenant_id) throw new UnauthorizedException('Tenant-scoped token required');
    if (claims.type === 'customer' || claims.type === 'marketplace_customer') {
      throw new ForbiddenException('Customer tokens cannot access POS endpoints');
    }
    const tenantId = claims.tenant_id.toLowerCase();
    if (!UUID_RE.test(tenantId)) {
      throw new UnauthorizedException('Invalid tenant claim');
    }
    const homeTenantId = claims.home_tenant_id?.toLowerCase();
    if (homeTenantId !== undefined && !UUID_RE.test(homeTenantId)) {
      throw new UnauthorizedException('Invalid home tenant claim');
    }
    const userTenantId = homeTenantId ?? tenantId;

    const minimumTimestamp = Math.floor(Date.now() / 1000) - Number(this.config.get('JWT_TTL_SECONDS') ?? 28800);
    const sessions = await this.database.query<SessionDataRow>(
      `SELECT data FROM public.tec_sessions
       WHERE id = $1 AND tenant_id = $2 AND "timestamp" >= $3
       LIMIT 1`,
      [claims.sid, tenantId, minimumTimestamp]
    );
    if (sessions.rowCount !== 1) throw new UnauthorizedException('Session expired');

    const sessionData = parseSessionPayload(sessions.rows[0].data);
    if (!sessionData) throw new UnauthorizedException('Session data invalid');

    const userId = Number(claims.sub);
    if (!Number.isSafeInteger(userId) || sessionData.tenantId !== tenantId || sessionData.userId !== userId) {
      throw new UnauthorizedException('Session does not match token');
    }
    if (homeTenantId !== undefined && sessionData.homeTenantId !== homeTenantId) {
      throw new UnauthorizedException('Session does not match home tenant');
    }
    if (homeTenantId === undefined && sessionData.homeTenantId !== undefined) {
      throw new UnauthorizedException('Session does not match token scope');
    }
    if ((claims.super === true) !== (sessionData.super === true)) {
      throw new UnauthorizedException('Session does not match token scope');
    }

    const userResult = await this.supabase.client.from('tec_users')
      .select('id, tenant_id, username, email, first_name, last_name, group_id, store_id, active')
      .eq('id', userId)
      .eq('tenant_id', userTenantId)
      .eq('active', 1)
      .maybeSingle();
    if (userResult.error) throw new InternalServerErrorException('Could not validate POS user');
    if (!userResult.data || Number(userResult.data.active) !== 1) {
      throw new UnauthorizedException('POS user is inactive');
    }

    let groupName: string | null = null;
    if (userResult.data.group_id !== null) {
      const tenantGroup = await this.supabase.client.from('tec_groups')
        .select('name')
        .eq('id', userResult.data.group_id)
        .eq('tenant_id', userTenantId)
        .maybeSingle();
      if (tenantGroup.error) throw new InternalServerErrorException('Could not load POS permissions');
      if (tenantGroup.data) {
        groupName = tenantGroup.data.name;
      } else {
        const sharedGroup = await this.supabase.client.from('tec_groups')
          .select('name')
          .eq('id', userResult.data.group_id)
          .is('tenant_id', null)
          .maybeSingle();
        if (sharedGroup.error) throw new InternalServerErrorException('Could not load POS permissions');
        groupName = sharedGroup.data?.name ?? null;
      }
    }

    if (homeTenantId !== undefined
      && homeTenantId !== tenantId
      && (groupName?.toLowerCase() !== 'super_admin' || claims.super !== true)) {
      throw new ForbiddenException('Cross-tenant access requires a super administrator');
    }

    const user: PosUser = { ...userResult.data, tenant_id: tenantId, active: 1, group_name: groupName };

    request.tenantId = tenantId;
    request.posUser = user;
    return true;
  }
}
