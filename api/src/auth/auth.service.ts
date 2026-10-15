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
type LoginLookupRow = UserCandidate & { tenant_status: string | null };
type NewSession = Pick<TableRow<'tec_sessions'>, 'id'> & {
  tenant_id: string;
  ip_address: string | null;
  timestamp: number;
  data: Buffer;
};

type CustomerLoginRow = {
  id: number;
  tenant_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  password: string | null;
  points_balance: number;
  tenant_status: string | null;
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
    // Single-domain SaaS: the tenant comes from the user's own `tenant_id`, never
    // from the HTTP Host header. Host is only a fallback bucket for lockout records
    // when the identity does not match any user.
    const matched = await this.findUserByIdentity(identity);
    const tenantId = matched?.tenant_id?.toLowerCase() ?? this.resolveTenantFallback(host);
    await this.assertLoginAllowed(tenantId, identity);

    if (!matched) {
      await this.recordFailure(tenantId, ipAddress, identity);
      throw new UnauthorizedException('Invalid username or password');
    }
    if (matched.tenant_status === 'inactive' || matched.tenant_status === 'deleted') {
      await this.recordFailure(tenantId, ipAddress, identity);
      throw new ForbiddenException('El tenant está inactivo o suspendido');
    }

    const row = matched;
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

    await this.clearLoginAttempts(tenantId, identity);

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

  async customerLogin(identityInput: string, password: string, ipAddress: string) {
    const identity = identityInput.trim();
    const isEmail = identity.includes('@');
    const normalized = isEmail ? identity.toLowerCase() : identity.replace(/\D/g, '');
    if (!normalized) throw new UnauthorizedException('Invalid credentials');

    const matched = await this.findCustomerByIdentity(normalized, isEmail);
    const tenantId = matched?.tenant_id ?? this.resolveTenantFallback('');
    await this.assertLoginAllowed(tenantId, normalized);

    if (!matched || !matched.password) {
      await this.recordFailure(tenantId, ipAddress, normalized);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (matched.tenant_status !== 'active') {
      await this.recordFailure(tenantId, ipAddress, normalized);
      throw new ForbiddenException('El tenant está inactivo o suspendido');
    }

    const verification = await verifyPassword(password, matched.password, this.bcryptRounds);
    if (!verification.valid) {
      await this.recordFailure(tenantId, ipAddress, normalized);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.clearLoginAttempts(tenantId, normalized);
    const accessToken = await this.jwt.signAsync(
      {
        sub: String(matched.id),
        type: 'customer',
        role: 'customer',
        tenant_id: matched.tenant_id
      },
      { expiresIn: this.tokenTtl, issuer: 'pos-gres-v2', algorithm: 'HS256' }
    );

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.tokenTtl,
      customer: {
        id: matched.id,
        tenant_id: matched.tenant_id,
        name: matched.name,
        email: matched.email,
        phone: matched.phone,
        points_balance: matched.points_balance
      }
    };
  }

  async customerSetPassword(identityInput: string, newPassword: string, ipAddress: string) {
    const identity = identityInput.trim();
    const isEmail = identity.includes('@');
    const normalized = isEmail ? identity.toLowerCase() : identity.replace(/\D/g, '');
    if (!normalized) throw new BadRequestException('A valid email or phone number is required');
    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw new BadRequestException('La contraseña no puede superar 72 bytes');
    }

    const matched = await this.findCustomerByIdentity(normalized, isEmail);
    const tenantId = matched?.tenant_id ?? this.resolveTenantFallback('');
    await this.assertLoginAllowed(tenantId, normalized);

    if (!matched) {
      await this.recordFailure(tenantId, ipAddress, normalized);
      throw new NotFoundException('Customer not found');
    }
    if (matched.tenant_status !== 'active') {
      await this.recordFailure(tenantId, ipAddress, normalized);
      throw new ForbiddenException('El tenant está inactivo o suspendido');
    }

    const hash = await hashPassword(newPassword, this.bcryptRounds);
    const updated = await this.database.query<{ id: number }>(
      `UPDATE public.tec_customers
       SET password = $1
       WHERE id = $2 AND tenant_id = $3 AND password IS NULL
       RETURNING id`,
      [hash, matched.id, matched.tenant_id]
    );
    if (updated.rowCount !== 1) {
      throw new BadRequestException('Account already has a password, please use login or reset flow');
    }
    await this.clearLoginAttempts(tenantId, normalized);
    return { ok: true };
  }

  private async findCustomerByIdentity(normalized: string, isEmail: boolean): Promise<CustomerLoginRow | null> {
    const matchClause = isEmail
      ? `c.email IS NOT NULL AND c.email <> '' AND LOWER(c.email) = LOWER($1)`
      : `c.phone IS NOT NULL AND c.phone <> '' AND regexp_replace(c.phone, '[^0-9]', '', 'g') = $1`;
    const result = await this.database.query<CustomerLoginRow>(
      `SELECT c.id, c.tenant_id::text AS tenant_id, c.name, c.email, c.phone, c.password,
              COALESCE(c.points_balance, 0)::integer AS points_balance, t.status AS tenant_status
       FROM public.tec_customers c
       LEFT JOIN public.tec_tenants t ON t.id = c.tenant_id
       WHERE c.tenant_id IS NOT NULL
         AND ${matchClause}
       ORDER BY c.id ASC
       LIMIT 3`,
      [normalized]
    );
    return result.rows.length === 1 ? result.rows[0] : null;
  }

  private async assertLoginAllowed(tenantId: string, identity: string): Promise<void> {
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
  }

  private async clearLoginAttempts(tenantId: string, identity: string): Promise<void> {
    const clearAttempts = await this.supabase.client.from('tec_login_attempts')
      .delete().eq('tenant_id', tenantId).eq('login', identity);
    if (clearAttempts.error) throw new Error('Could not clear successful login attempts');
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

  private async findUserByIdentity(identity: string): Promise<LoginLookupRow | null> {
    const result = await this.database.query<LoginLookupRow>(
      `SELECT u.id, u.tenant_id::text AS tenant_id, u.username, u.email, u.first_name, u.last_name,
              u.group_id, u.store_id, u.active, u.password, t.status AS tenant_status
       FROM public.tec_users u
       LEFT JOIN public.tec_tenants t ON t.id = u.tenant_id
       WHERE u.active = 1
         AND (lower(u.username) = lower($1) OR lower(u.email) = lower($1))
       ORDER BY (lower(u.username) = lower($1)) DESC, u.id ASC
       LIMIT 3`,
      [identity]
    );
    const rows = result.rows;
    if (rows.length === 0) return null;
    const exactUsername = rows.filter((row) => row.username?.toLowerCase() === identity.toLowerCase());
    const exactEmail = rows.filter((row) => row.email?.toLowerCase() === identity.toLowerCase());
    const matches = exactUsername.length > 0 ? exactUsername : exactEmail;
    // Ambiguous or no exact match: fail as invalid credentials (no tenant enumeration).
    return matches.length === 1 ? matches[0] : null;
  }

  private resolveTenantFallback(host: string): string {
    const hostname = (host || '').toLowerCase();
    return this.hostTenantMap.get(hostname) ?? this.defaultTenantId;
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
