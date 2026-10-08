import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../database/supabase.service';
import { TableRow } from '../database/database.types';
import { DatabaseService } from '../database/database.service';
import { hashPassword, verifyPassword } from './password.util';
import { PosUser } from './auth.types';

type UserCandidate = Pick<
  TableRow<'tec_users'>,
  'id' | 'tenant_id' | 'username' | 'email' | 'first_name' | 'last_name' |
  'group_id' | 'store_id' | 'active' | 'password'
>;
type AuthenticatedUser = Omit<UserCandidate, 'tenant_id' | 'active'> & {
  tenant_id: string;
  active: 1;
  group_name: string | null;
};
type NewSession = Pick<TableRow<'tec_sessions'>, 'id'> & {
  tenant_id: string;
  ip_address: string | null;
  timestamp: number;
  data: Buffer;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class AuthService {
  private readonly bcryptRounds: number;
  private readonly tokenTtl: number;
  private readonly defaultTenantId: string;
  private readonly hostTenantMap: ReadonlyMap<string, string>;
  private readonly maxLoginAttempts: number;
  private readonly lockoutSeconds: number;
  private readonly rehashEnabled: boolean;

  constructor(
    private readonly database: DatabaseService,
    private readonly supabase: SupabaseService,
    private readonly jwt: JwtService,
    config: ConfigService
  ) {
    this.bcryptRounds = Number(config.get('BCRYPT_ROUNDS') ?? 12);
    const tokenTtl = Number(config.get('JWT_TTL_SECONDS') ?? 28800);
    if (!Number.isInteger(tokenTtl) || tokenTtl < 900 || tokenTtl > 86400) {
      throw new Error('JWT_TTL_SECONDS must be an integer between 900 and 86400');
    }
    this.tokenTtl = tokenTtl;
    this.maxLoginAttempts = Number(config.get('LOGIN_MAX_ATTEMPTS') ?? 5);
    this.lockoutSeconds = Number(config.get('LOGIN_LOCKOUT_SECONDS') ?? 600);
    // Disabled by default: the legacy POS verifies sha1 and shares tec_users.
    this.rehashEnabled = config.get<string>('PASSWORD_REHASH_ENABLED') === 'true';
    this.defaultTenantId = this.validateUuid(config.getOrThrow<string>('DEFAULT_TENANT_ID'));
    this.hostTenantMap = this.parseHostMap(config.get<string>('TENANT_HOST_MAP') ?? '{}');
  }

  async login(identityInput: string, password: string, host: string, ipAddress: string) {
    const identity = identityInput.trim();
    const tenantId = this.hostTenantMap.get(host.toLowerCase()) ?? this.defaultTenantId;
    const lockoutStart = Math.floor(Date.now() / 1000) - this.lockoutSeconds;
    const attempts = await this.supabase.client
      .from('tec_login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('login', identity)
      .gte('time', lockoutStart);
    if (attempts.error) throw new Error('Could not check login-attempt policy');
    if ((attempts.count ?? 0) >= this.maxLoginAttempts) {
      throw new HttpException('Too many failed logins; try again later', HttpStatus.TOO_MANY_REQUESTS);
    }

    const userSelect = 'id, tenant_id, username, email, first_name, last_name, group_id, store_id, active, password';
    const [usernameResult, emailResult] = await Promise.all([
      this.supabase.client.from('tec_users').select(userSelect)
        .eq('tenant_id', tenantId).eq('active', 1).eq('username', identity).limit(2),
      this.supabase.client.from('tec_users').select(userSelect)
        .eq('tenant_id', tenantId).eq('active', 1).eq('email', identity).limit(2)
    ]);
    if (usernameResult.error || emailResult.error) throw new Error('Could not look up POS user');

    const userCandidates = new Map<number, UserCandidate>();
    for (const row of [...(usernameResult.data ?? []), ...(emailResult.data ?? [])]) {
      userCandidates.set(row.id, row);
    }
    if (userCandidates.size !== 1) {
      await this.recordFailure(tenantId, ipAddress, identity);
      throw new UnauthorizedException('Invalid username or password');
    }

    const row = [...userCandidates.values()][0];
    let groupName: string | null = null;
    if (row.group_id !== null) {
      const tenantGroup = await this.supabase.client.from('tec_groups')
        .select('name').eq('id', row.group_id).eq('tenant_id', tenantId).maybeSingle();
      if (tenantGroup.error) throw new Error('Could not resolve POS user group');
      if (tenantGroup.data) {
        groupName = tenantGroup.data.name;
      } else {
        const sharedGroup = await this.supabase.client.from('tec_groups')
          .select('name').eq('id', row.group_id).is('tenant_id', null).maybeSingle();
        if (sharedGroup.error) throw new Error('Could not resolve POS user group');
        groupName = sharedGroup.data?.name ?? null;
      }
    }
    const user: AuthenticatedUser = { ...row, tenant_id: tenantId, active: 1, group_name: groupName };
    const isSuperAdmin = groupName?.toLowerCase() === 'super_admin';

    if (!user.password || Number(user.active) !== 1) {
      await this.recordFailure(tenantId, ipAddress, identity);
      throw new UnauthorizedException('Invalid username or password');
    }

    const verification = await verifyPassword(password, user.password, this.bcryptRounds);
    if (!verification.valid) {
      await this.recordFailure(tenantId, ipAddress, identity);
      throw new UnauthorizedException('Invalid username or password');
    }

    if (verification.needsRehash && this.rehashEnabled) {
      try {
        const replacement = await hashPassword(password, this.bcryptRounds);
        const rehash = await this.supabase.client.from('tec_users')
          .update({ password: replacement })
          .eq('id', user.id)
          .eq('tenant_id', tenantId)
          .eq('password', user.password)
          .select('id');
        if (rehash.error) throw new Error('Could not migrate legacy password hash');
      } catch (error: unknown) {
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code) : 'UNKNOWN';
        console.error('Legacy password rehash deferred', { code });
      }
    }

    const clearAttempts = await this.supabase.client.from('tec_login_attempts')
      .delete().eq('tenant_id', tenantId).eq('login', identity);
    if (clearAttempts.error) throw new Error('Could not clear successful login attempts');

    // 20 bytes -> 40 hex chars, compatible with tec_sessions.id VARCHAR(40).
    const sessionId = randomBytes(20).toString('hex');
    const issuedAt = Math.floor(Date.now() / 1000);
    const accessToken = await this.jwt.signAsync(
      {
        sub: String(user.id),
        tenant_id: tenantId,
        sid: sessionId,
        home_tenant_id: tenantId,
        ...(isSuperAdmin ? { super: true } : {})
      },
      { expiresIn: this.tokenTtl, issuer: 'pos-gres-v2', algorithm: 'HS256' }
    );
    const sessionData = Buffer.from(JSON.stringify({
      userId: user.id,
      tenantId,
      homeTenantId: tenantId,
      ...(isSuperAdmin ? { super: true } : {}),
      issuedAt
    }), 'utf8');
    const session: NewSession = {
      id: sessionId,
      tenant_id: tenantId,
      ip_address: ipAddress || null,
      timestamp: issuedAt,
      data: sessionData
    };
    await this.database.query(
      `INSERT INTO public.tec_sessions (id, tenant_id, ip_address, "timestamp", data)
       VALUES ($1, $2, $3, $4, $5)`,
      [session.id, session.tenant_id, session.ip_address, session.timestamp, session.data]
    );

    const { password: _storedPassword, ...publicUser } = user;
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.tokenTtl,
      user: { ...publicUser, tenant_id: tenantId }
    };
  }

  async logout(sessionId: string, tenantId: string): Promise<void> {
    await this.database.query(
      'DELETE FROM public.tec_sessions WHERE id = $1 AND tenant_id = $2',
      [sessionId, tenantId]
    );
  }

  async switchTenant(user: PosUser, currentSessionId: string, targetTenantId: string, ipAddress: string) {
    if (user.group_name?.toLowerCase() !== 'super_admin') {
      throw new ForbiddenException('Super administrator access required');
    }
    const target = targetTenantId.toLowerCase();
    const tenantResult = await this.database.query<{ id: string; name: string | null; status: string | null }>(
      `SELECT id::text AS id, name, status
       FROM public.tec_tenants
       WHERE id = $1
       LIMIT 1`,
      [target]
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'active') throw new BadRequestException('Tenant is not active');

    const sessionId = randomBytes(20).toString('hex');
    const issuedAt = Math.floor(Date.now() / 1000);
    const accessToken = await this.jwt.signAsync(
      { sub: String(user.id), tenant_id: target, sid: sessionId, home_tenant_id: user.tenant_id, super: true },
      { expiresIn: this.tokenTtl, issuer: 'pos-gres-v2', algorithm: 'HS256' }
    );
    const sessionData = Buffer.from(JSON.stringify({
      userId: user.id,
      tenantId: target,
      homeTenantId: user.tenant_id,
      super: true,
      issuedAt
    }), 'utf8');

    await this.database.transaction(async (client) => {
      await client.query('DELETE FROM public.tec_sessions WHERE id = $1', [currentSessionId]);
      await client.query(
        `INSERT INTO public.tec_sessions (id, tenant_id, ip_address, "timestamp", data)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, target, ipAddress || null, issuedAt, sessionData]
      );
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.tokenTtl,
      tenant_id: target,
      tenant: { id: tenant.id, name: tenant.name }
    };
  }

  private async recordFailure(tenantId: string, ipAddress: string, identity: string): Promise<void> {
    try {
      const insert = await this.supabase.client.from('tec_login_attempts').insert({
        tenant_id: tenantId,
        ip_address: ipAddress || null,
        login: identity,
        time: Math.floor(Date.now() / 1000)
      });
      if (insert.error) throw new Error('Could not record login attempt');
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code) : 'UNKNOWN';
      console.error('Login failure audit deferred', { code });
    }
  }

  private validateUuid(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error('DEFAULT_TENANT_ID must be a UUID');
    }
    return value.toLowerCase();
  }

  private parseHostMap(raw: string): ReadonlyMap<string, string> {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) throw new Error('TENANT_HOST_MAP must be a JSON object');
    const result = new Map<string, string>();
    for (const [host, tenantId] of Object.entries(value)) {
      if (typeof tenantId !== 'string') throw new Error('TENANT_HOST_MAP values must be tenant UUIDs');
      result.set(host.toLowerCase(), this.validateUuid(tenantId));
    }
    return result;
  }
}
