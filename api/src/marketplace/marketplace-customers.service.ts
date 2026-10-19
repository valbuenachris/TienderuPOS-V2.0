import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hashPassword, verifyPassword } from '../auth/password.util';
import { Paginated, PaginationQuery, buildPaginated } from '../common/pagination';
import { DatabaseService } from '../database/database.service';
import {
  MarketplaceAccountUpdateDto,
  MarketplaceAddressDto,
  MarketplaceAddressUpdateDto,
  MarketplaceLoginDto,
  MarketplaceRegisterDto
} from './marketplace.dto';
import { MarketplaceSettingsService } from './marketplace-settings.service';
import { MarketplaceRateLimitService, REGISTER_RATE_RULE } from './marketplace-rate-limit.service';

export type MarketplaceCustomerRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string | null;
};

export type MarketplaceAddressRow = {
  id: number;
  customer_id: number;
  recipient_name: string;
  label: string;
  street_address: string;
  neighborhood: string | null;
  city: string | null;
  phone: string | null;
  additional_notes: string | null;
  is_default: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type LoginRow = MarketplaceCustomerRow & { password: string | null };

const DEFAULT_CITY = 'Bogotá';
const ADDRESS_FIELDS = `id, customer_id, recipient_name, label, street_address, neighborhood, city,
                        phone, additional_notes, is_default, created_at, updated_at`;

function normalizeOptional(value?: string | null): string | null {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
}

function normalizePhone(value?: string | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export type MarketplaceAdminCustomerRow = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string | null;
  has_password: boolean;
  orders_count: number;
};

/**
 * Cuenta global de tienderu.com: registro/login con email + contraseña (bcrypt)
 * y direcciones de envío. Independiente de `tec_customers` (que es por tenant).
 */
@Injectable()
export class MarketplaceCustomersService {
  private readonly logger = new Logger(MarketplaceCustomersService.name);
  private readonly bcryptRounds: number;
  private readonly tokenTtl: number;
  private readonly maxLoginAttempts: number;
  private readonly lockoutSeconds: number;

  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly settings: MarketplaceSettingsService,
    private readonly rateLimit: MarketplaceRateLimitService,
    config: ConfigService
  ) {
    this.bcryptRounds = Number(config.get('BCRYPT_ROUNDS') ?? 12);
    this.tokenTtl = Number(config.get('JWT_TTL_SECONDS') ?? 28800);
    this.maxLoginAttempts = Number(config.get('LOGIN_MAX_ATTEMPTS') ?? 5);
    this.lockoutSeconds = Number(config.get('LOGIN_LOCKOUT_SECONDS') ?? 600);
  }

  async register(input: MarketplaceRegisterDto, ipAddress: string) {
    await this.settings.assertAvailable();
    this.rateLimit.assertWithin(`mp-register:${ipAddress || 'unknown'}`, REGISTER_RATE_RULE);
    const email = input.email.trim().toLowerCase();
    if (Buffer.byteLength(input.password, 'utf8') > 72) {
      throw new BadRequestException('La contraseña no puede superar 72 bytes');
    }

    const existing = await this.database.query<{ id: number }>(
      `SELECT id FROM public.tec_marketplace_customers WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (existing.rowCount !== 0) {
      throw new ConflictException('Ya existe una cuenta con este correo');
    }

    const passwordHash = await hashPassword(input.password, this.bcryptRounds);
    const created = await this.database.query<MarketplaceCustomerRow>(
      `INSERT INTO public.tec_marketplace_customers (name, email, phone, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, created_at`,
      [input.name.trim(), email, normalizePhone(input.phone), passwordHash]
    );
    const customer = created.rows[0];
    if (!customer) throw new BadRequestException('No se pudo crear la cuenta');

    await this.clearLoginAttempts(email);
    return this.authPayload(customer);
  }

  async login(input: MarketplaceLoginDto, ipAddress: string) {
    await this.settings.assertAvailable();
    const email = input.email.trim().toLowerCase();
    await this.assertLoginAllowed(email, ipAddress);

    const result = await this.database.query<LoginRow>(
      `SELECT id, name, email, phone, created_at, password
       FROM public.tec_marketplace_customers
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email]
    );
    const customer = result.rows[0];
    if (!customer?.password) {
      await this.recordFailure(ipAddress, email);
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const verification = await verifyPassword(input.password, customer.password, this.bcryptRounds);
    if (!verification.valid) {
      await this.recordFailure(ipAddress, email);
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    await this.clearLoginAttempts(email);
    return this.authPayload(customer);
  }

  async profile(customerId: number): Promise<MarketplaceCustomerRow> {
    const result = await this.database.query<MarketplaceCustomerRow>(
      `SELECT id, name, email, phone, created_at
       FROM public.tec_marketplace_customers
       WHERE id = $1
       LIMIT 1`,
      [customerId]
    );
    const customer = result.rows[0];
    if (!customer) throw new NotFoundException('Account not found');
    return customer;
  }

  async updateProfile(customerId: number, input: MarketplaceAccountUpdateDto): Promise<MarketplaceCustomerRow> {
    const sets: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [customerId];
    if (input.name !== undefined) {
      values.push(input.name.trim());
      sets.push(`name = $${values.length}`);
    }
    if (input.phone !== undefined) {
      values.push(normalizePhone(input.phone));
      sets.push(`phone = $${values.length}`);
    }
    const result = await this.database.query<MarketplaceCustomerRow>(
      `UPDATE public.tec_marketplace_customers
       SET ${sets.join(', ')}
       WHERE id = $1
       RETURNING id, name, email, phone, created_at`,
      values
    );
    if (!result.rows[0]) throw new NotFoundException('Account not found');
    return result.rows[0];
  }

  /**
   * Comprador del chatbot del marketplace (v0.12.0): find-or-create por teléfono.
   * Se crea con email sintético `wa-<digits>@tienderu.com` y contraseña aleatoria
   * (compra 100% por WhatsApp; soporte puede resetearla si luego quiere cuenta web).
   */
  async ensureWhatsappCustomer(phone: string, name: string | null): Promise<MarketplaceCustomerRow> {
    await this.settings.assertAvailable();
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length < 7) throw new BadRequestException('El teléfono de la conversación no es válido');
    const email = `wa-${digits}@tienderu.com`;

    const found = await this.database.query<MarketplaceCustomerRow>(
      `SELECT id, name, email, phone, created_at
       FROM public.tec_marketplace_customers
       WHERE LOWER(email) = $1
          OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $2
       ORDER BY id ASC
       LIMIT 1`,
      [email, digits]
    );
    const existing = found.rows[0];
    if (existing) {
      if ((existing.name === null || existing.name.trim() === '') && name !== null && name.trim() !== '') {
        const cleanName = name.trim().slice(0, 120);
        await this.database.query(
          `UPDATE public.tec_marketplace_customers SET name = $1, updated_at = NOW() WHERE id = $2`,
          [cleanName, existing.id]
        );
        existing.name = cleanName;
      }
      return existing;
    }

    const hash = await hashPassword(randomBytes(24).toString('base64url'), this.bcryptRounds);
    try {
      const created = await this.database.query<MarketplaceCustomerRow>(
        `INSERT INTO public.tec_marketplace_customers (name, email, phone, password)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, phone, created_at`,
        [name?.trim().slice(0, 120) || 'Cliente WhatsApp', email, digits, hash]
      );
      const customer = created.rows[0];
      this.logger.log(`Cliente del marketplace por WhatsApp creado: #${customer.id} (${digits})`);
      return customer;
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      if (code === '23505') {
        const retry = await this.database.query<MarketplaceCustomerRow>(
          `SELECT id, name, email, phone, created_at
           FROM public.tec_marketplace_customers
           WHERE LOWER(email) = $1
           LIMIT 1`,
          [email]
        );
        if (retry.rows[0]) return retry.rows[0];
      }
      throw error;
    }
  }

  /** Dirección predeterminada del comprador (usada por el bot cuando no pide dirección nueva). */
  async defaultAddress(customerId: number): Promise<MarketplaceAddressRow | null> {
    await this.settings.assertAvailable();
    const result = await this.database.query<MarketplaceAddressRow>(
      `SELECT ${ADDRESS_FIELDS}
       FROM public.tec_marketplace_addresses
       WHERE customer_id = $1
       ORDER BY is_default DESC, id ASC
       LIMIT 1`,
      [customerId]
    );
    return result.rows[0] ?? null;
  }

  async listAddresses(customerId: number): Promise<MarketplaceAddressRow[]> {
    await this.settings.assertAvailable();
    const result = await this.database.query<MarketplaceAddressRow>(
      `SELECT ${ADDRESS_FIELDS}
       FROM public.tec_marketplace_addresses
       WHERE customer_id = $1
       ORDER BY is_default DESC, created_at ASC, id ASC`,
      [customerId]
    );
    return result.rows;
  }

  async createAddress(customerId: number, input: MarketplaceAddressDto): Promise<MarketplaceAddressRow> {
    await this.settings.assertAvailable();
    return this.database.transaction(async (client) => {
      const countResult = await client.query<{ count: number }>(
        `SELECT COUNT(*)::integer AS count FROM public.tec_marketplace_addresses WHERE customer_id = $1`,
        [customerId]
      );
      const isFirst = (countResult.rows[0]?.count ?? 0) === 0;
      const isDefault = input.is_default === true || isFirst;
      if (isDefault) {
        await client.query(
          `UPDATE public.tec_marketplace_addresses
           SET is_default = false, updated_at = NOW()
           WHERE customer_id = $1 AND is_default = true`,
          [customerId]
        );
      }
      const result = await client.query<MarketplaceAddressRow>(
        `INSERT INTO public.tec_marketplace_addresses
           (customer_id, recipient_name, label, street_address, neighborhood, city, phone, additional_notes, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${ADDRESS_FIELDS}`,
        [
          customerId,
          input.recipient_name.trim(),
          input.label,
          input.street_address.trim(),
          normalizeOptional(input.neighborhood),
          normalizeOptional(input.city) ?? DEFAULT_CITY,
          normalizePhone(input.phone),
          normalizeOptional(input.additional_notes),
          isDefault
        ]
      );
      return result.rows[0];
    });
  }

  async updateAddress(customerId: number, addressId: number, input: MarketplaceAddressUpdateDto): Promise<MarketplaceAddressRow> {
    await this.settings.assertAvailable();
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM public.tec_marketplace_addresses
         WHERE id = $1 AND customer_id = $2
         LIMIT 1 FOR UPDATE`,
        [addressId, customerId]
      );
      if (existing.rowCount !== 1) throw new NotFoundException('Address not found');

      const sets: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [addressId, customerId];
      if (input.recipient_name !== undefined) {
        values.push(input.recipient_name.trim());
        sets.push(`recipient_name = $${values.length}`);
      }
      if (input.label !== undefined) {
        values.push(input.label);
        sets.push(`label = $${values.length}`);
      }
      if (input.street_address !== undefined) {
        values.push(input.street_address.trim());
        sets.push(`street_address = $${values.length}`);
      }
      if (input.neighborhood !== undefined) {
        values.push(normalizeOptional(input.neighborhood));
        sets.push(`neighborhood = $${values.length}`);
      }
      if (input.city !== undefined) {
        values.push(normalizeOptional(input.city) ?? DEFAULT_CITY);
        sets.push(`city = $${values.length}`);
      }
      if (input.phone !== undefined) {
        values.push(normalizePhone(input.phone));
        sets.push(`phone = $${values.length}`);
      }
      if (input.additional_notes !== undefined) {
        values.push(normalizeOptional(input.additional_notes));
        sets.push(`additional_notes = $${values.length}`);
      }

      const result = await client.query<MarketplaceAddressRow>(
        `UPDATE public.tec_marketplace_addresses
         SET ${sets.join(', ')}
         WHERE id = $1 AND customer_id = $2
         RETURNING ${ADDRESS_FIELDS}`,
        values
      );
      return result.rows[0];
    });
  }

  async setDefaultAddress(customerId: number, addressId: number): Promise<MarketplaceAddressRow> {
    await this.settings.assertAvailable();
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM public.tec_marketplace_addresses
         WHERE id = $1 AND customer_id = $2
         LIMIT 1 FOR UPDATE`,
        [addressId, customerId]
      );
      if (existing.rowCount !== 1) throw new NotFoundException('Address not found');

      await client.query(
        `UPDATE public.tec_marketplace_addresses
         SET is_default = false, updated_at = NOW()
         WHERE customer_id = $1 AND id <> $2 AND is_default = true`,
        [customerId, addressId]
      );
      const result = await client.query<MarketplaceAddressRow>(
        `UPDATE public.tec_marketplace_addresses
         SET is_default = true, updated_at = NOW()
         WHERE id = $1 AND customer_id = $2
         RETURNING ${ADDRESS_FIELDS}`,
        [addressId, customerId]
      );
      return result.rows[0];
    });
  }

  async removeAddress(customerId: number, addressId: number) {
    await this.settings.assertAvailable();
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ id: number; is_default: boolean | null }>(
        `SELECT id, is_default FROM public.tec_marketplace_addresses
         WHERE id = $1 AND customer_id = $2
         LIMIT 1 FOR UPDATE`,
        [addressId, customerId]
      );
      const address = existing.rows[0];
      if (!address) throw new NotFoundException('Address not found');

      await client.query(
        'DELETE FROM public.tec_marketplace_addresses WHERE id = $1 AND customer_id = $2',
        [addressId, customerId]
      );
      if (address.is_default === true) {
        const fallback = await client.query<{ id: number }>(
          `SELECT id FROM public.tec_marketplace_addresses
           WHERE customer_id = $1
           ORDER BY created_at ASC, id ASC
           LIMIT 1`,
          [customerId]
        );
        const next = fallback.rows[0];
        if (next) {
          await client.query(
            `UPDATE public.tec_marketplace_addresses
             SET is_default = true, updated_at = NOW()
             WHERE id = $1`,
            [next.id]
          );
        }
      }
      return { id: addressId, deleted: true };
    });
  }

  // ---------------------------------------------------------------------------
  // Admin de plataforma (v0.11.1): listado y restablecimiento de contraseña
  // ---------------------------------------------------------------------------

  async adminListCustomers(
    search: string | undefined,
    pagination: PaginationQuery
  ): Promise<Paginated<MarketplaceAdminCustomerRow>> {
    await this.settings.assertAvailable();
    const values: unknown[] = [];
    let filter = '';
    const clean = search?.trim().slice(0, 100) ?? '';
    if (clean !== '') {
      values.push(`%${escapeLike(clean)}%`);
      filter = `WHERE c.name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1`;
    }
    values.push(pagination.limit, pagination.offset);
    const result = await this.database.query<MarketplaceAdminCustomerRow & { total_count: number }>(
      `SELECT c.id, c.name, c.email, c.phone, c.created_at,
              (c.password IS NOT NULL) AS has_password,
              (SELECT COUNT(*)::integer FROM public.tec_marketplace_orders o
                WHERE o.customer_id = c.id AND o.payment_status = 'paid') AS orders_count,
              COUNT(*) OVER() AS total_count
       FROM public.tec_marketplace_customers c
       ${filter}
       ORDER BY c.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    const total = result.rows[0]?.total_count ?? 0;
    const data = result.rows.map(({ total_count: _totalCount, ...row }) => row);
    return buildPaginated(data, total, pagination);
  }

  /** Genera una contraseña temporal (se muestra UNA vez) y limpia el lockout. */
  async adminResetPassword(customerId: number) {
    await this.settings.assertAvailable();
    const temporary = randomBytes(6).toString('base64url');
    const hash = await hashPassword(temporary, this.bcryptRounds);
    const updated = await this.database.query<{ id: number; email: string | null }>(
      `UPDATE public.tec_marketplace_customers
       SET password = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email`,
      [hash, customerId]
    );
    const customer = updated.rows[0];
    if (!customer) throw new NotFoundException('Account not found');
    if (customer.email) await this.clearLoginAttempts(customer.email.toLowerCase());
    return { id: customer.id, email: customer.email, temporary_password: temporary };
  }

  /** Cambio de contraseña desde «Mi cuenta» (requiere la actual). */
  async changePassword(customerId: number, currentPassword: string, newPassword: string) {
    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw new BadRequestException('La contraseña no puede superar 72 bytes');
    }
    const result = await this.database.query<{ id: number; password: string | null }>(
      `SELECT id, password FROM public.tec_marketplace_customers WHERE id = $1 LIMIT 1`,
      [customerId]
    );
    const row = result.rows[0];
    if (!row?.password) throw new NotFoundException('Account not found');
    const verification = await verifyPassword(currentPassword, row.password, this.bcryptRounds);
    if (!verification.valid) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }
    const hash = await hashPassword(newPassword, this.bcryptRounds);
    await this.database.query(
      `UPDATE public.tec_marketplace_customers SET password = $1, updated_at = NOW() WHERE id = $2`,
      [hash, customerId]
    );
    return { ok: true };
  }

  private async authPayload(customer: MarketplaceCustomerRow) {
    const accessToken = await this.jwt.signAsync(
      { sub: String(customer.id), type: 'marketplace_customer', role: 'marketplace_customer' },
      { expiresIn: this.tokenTtl, issuer: 'pos-gres-v2', algorithm: 'HS256' }
    );
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.tokenTtl,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone
      }
    };
  }

  // Lockout compartido (tec_login_attempts) con tenant_id NULL para la cuenta global.
  private async assertLoginAllowed(email: string, _ipAddress: string): Promise<void> {
    const lockoutStart = Math.floor(Date.now() / 1000) - this.lockoutSeconds;
    const result = await this.database.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count
       FROM public.tec_login_attempts
       WHERE tenant_id IS NULL AND login = $1 AND time >= $2`,
      [email, lockoutStart]
    );
    if ((result.rows[0]?.count ?? 0) >= this.maxLoginAttempts) {
      throw new HttpException('Too many failed logins; try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async clearLoginAttempts(email: string): Promise<void> {
    await this.database.query(
      'DELETE FROM public.tec_login_attempts WHERE tenant_id IS NULL AND login = $1',
      [email]
    );
  }

  private async recordFailure(ipAddress: string, email: string): Promise<void> {
    try {
      await this.database.query(
        `INSERT INTO public.tec_login_attempts (tenant_id, ip_address, login, time)
         VALUES (NULL, $1, $2, $3)`,
        [ipAddress || null, email, Math.floor(Date.now() / 1000)]
      );
    } catch (_error: unknown) {
      // Auditoría best-effort: nunca bloquea el login.
    }
  }
}
