import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { EvolutionClient } from '../whatsapp/evolution.client';
import { TenantWhatsappSettingsService } from '../whatsapp/tenant-whatsapp-settings.service';
import { hashPassword } from '../auth/password.util';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
export const OTP_LENGTH = 6;
export const DEFAULT_BCRYPT_ROUNDS = 12;

interface OtpEntry {
  customerId: number;
  codeHash: string; // `${salt}:${sha256(salt:code)}`
  expiresAt: number;
  attempts: number;
  createdAt: number;
}

interface CustomerLookupRow {
  id: number;
  tenant_id: string;
  email: string | null;
  phone: string | null;
}

/** Normaliza la identidad para claves internas: email en minúsculas o solo dígitos. */
export function normalizeOtpIdentity(identity: string): string {
  const value = identity.trim();
  if (value.includes('@')) return value.toLowerCase();
  return value.replace(/\D/g, '');
}

/** Código numérico de 6 dígitos (criptográficamente aleatorio). */
export function generateOtp(): string {
  return String(100000 + randomBytes(4).readUInt32BE(0) % 900000);
}

/** Hash del código con sal aleatoria (nunca se guarda el código en claro). */
export function hashOtp(code: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: sha256(`${salt}:${code}`) };
}

/** Recalcula el hash para comparar. */
export function hashOtpWithSalt(salt: string, code: string): string {
  return sha256(`${salt}:${code}`);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Número de WhatsApp con prefijo de país para Colombia. */
export function waNumberFromPhone(phone: string | null): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  return `57${digits}`;
}

/** Mensaje que se envía al cliente. */
export function buildOtpMessage(code: string): string {
  return `Princess Skin: tu código de verificación es ${code}. Vence en 10 minutos. No lo compartas.`;
}

@Injectable()
export class AuthOtpService {
  private readonly logger = new Logger(AuthOtpService.name);
  private readonly allowedTenantId: string | null;
  private readonly bcryptRounds: number;
  private readonly entries = new Map<string, OtpEntry>();

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
    private readonly evolution: EvolutionClient,
    private readonly whatsappSettings: TenantWhatsappSettingsService
  ) {
    this.allowedTenantId = (config.get<string>('CUSTOMER_APP_TENANT_ID') ?? '').trim().toLowerCase() || null;
    this.bcryptRounds = Number(config.get('BCRYPT_ROUNDS') ?? DEFAULT_BCRYPT_ROUNDS);
  }

  /** Solicita el envío de un código de verificación por WhatsApp. */
  async requestOtp(identityRaw: string): Promise<{ sent: true }> {
    const identity = normalizeOtpIdentity(identityRaw);
    if (identity === '' || !this.allowedTenantId) {
      throw new BadRequestException('La verificación por código no está disponible en este entorno.');
    }

    const customer = await this.findCustomer(identity);
    if (!customer) {
      // Neutro para no facilitar enumeración; la cuenta la administra la tienda.
      throw new NotFoundException('No pudimos enviar el código. Verifica tu correo o teléfono registrado.');
    }

    const phone = waNumberFromPhone(customer.phone);
    if (phone === null) {
      throw new BadRequestException('Para recibir el código necesitas un teléfono válido. Solicítalo en la tienda.');
    }

    const previous = this.entries.get(identity);
    if (previous && Date.now() - previous.createdAt < OTP_RESEND_COOLDOWN_MS) {
      throw new BadRequestException('Espera unos segundos antes de solicitar otro código.');
    }

    const instance = await this.whatsappSettings.getForTenant(this.allowedTenantId);
    const instanceName = instance?.instanceName;
    if (!instanceName) {
      throw new BadRequestException('El canal de WhatsApp no está configurado para esta tienda.');
    }

    const code = generateOtp();
    const { salt, hash } = hashOtp(code);
    this.entries.set(identity, {
      customerId: customer.id,
      codeHash: `${salt}:${hash}`,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      createdAt: Date.now()
    });

    try {
      await this.evolution.sendText(instanceName, phone, buildOtpMessage(code));
    } catch (error) {
      this.entries.delete(identity);
      this.logger.warn(`OTP send failed tenant=${this.allowedTenantId}: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new BadRequestException('No se pudo enviar el código. Intenta de nuevo en unos minutos.');
    }

    this.logger.log(`OTP enviado tenant=${this.allowedTenantId} customer=${customer.id}`);
    return { sent: true };
  }

  /** Verifica el código y establece/actualiza la contraseña; invalida tokens previos. */
  async verifyOtp(identityRaw: string, code: string, newPassword: string): Promise<{ ok: true }> {
    const identity = normalizeOtpIdentity(identityRaw);
    const entry = this.entries.get(identity);
    if (!entry || Date.now() > entry.expiresAt) {
      this.entries.delete(identity);
      throw new BadRequestException('El código expiró o no existe. Solicita uno nuevo.');
    }
    if (entry.attempts >= OTP_MAX_ATTEMPTS) {
      this.entries.delete(identity);
      throw new BadRequestException('Demasiados intentos. Solicita un nuevo código.');
    }

    const separator = entry.codeHash.indexOf(':');
    const salt = separator === -1 ? entry.codeHash : entry.codeHash.slice(0, separator);
    const expected = separator === -1 ? '' : entry.codeHash.slice(separator + 1);
    if (expected === '' || hashOtpWithSalt(salt, code) !== expected) {
      entry.attempts += 1;
      if (entry.attempts >= OTP_MAX_ATTEMPTS) this.entries.delete(identity);
      throw new BadRequestException('Código incorrecto. Verifica el número recibido.');
    }

    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw new BadRequestException('La contraseña no puede superar 72 bytes.');
    }

    const passwordHash = await hashPassword(newPassword, this.bcryptRounds);
    const updated = await this.database.query<{ id: number }>(
      `UPDATE public.tec_customers
       SET password = $2,
           token_version = token_version + 1
       WHERE tenant_id = $1 AND id = $3
       RETURNING id`,
      [this.allowedTenantId, passwordHash, entry.customerId]
    );
    if (updated.rowCount !== 1) {
      throw new NotFoundException('La cuenta ya no está disponible.');
    }

    await this.clearLoginAttempts(identity);
    this.entries.delete(identity);
    this.logger.log(`OTP verificado tenant=${this.allowedTenantId} customer=${entry.customerId}`);
    return { ok: true };
  }

  private async findCustomer(identity: string): Promise<CustomerLookupRow | null> {
    const isEmail = identity.includes('@');
    const matchClause = isEmail
      ? 'LOWER(c.email) = LOWER($2)'
      : "regexp_replace(c.phone, '[^0-9]', '', 'g') = $2";
    const result = await this.database.query<CustomerLookupRow>(
      `SELECT c.id, c.tenant_id::text AS tenant_id, c.email, c.phone
       FROM public.tec_customers c
       WHERE c.tenant_id = $1 AND ${matchClause}
       ORDER BY c.id ASC
       LIMIT 1`,
      [this.allowedTenantId, identity]
    );
    return result.rows[0] ?? null;
  }

  private async clearLoginAttempts(identity: string): Promise<void> {
    try {
      await this.database.query(
        'DELETE FROM public.tec_login_attempts WHERE tenant_id = $1 AND login = $2',
        [this.allowedTenantId, identity]
      );
    } catch (error: unknown) {
      this.logger.warn(`No se pudieron limpiar los intentos: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}