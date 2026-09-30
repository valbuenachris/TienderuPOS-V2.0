import * as crypto from 'node:crypto';
import * as bcrypt from 'bcryptjs';

export interface PasswordVerification {
  valid: boolean;
  scheme: 'bcrypt' | 'sha1-50' | 'sha1-40' | 'ion-auth-packed-40' | 'unknown';
  needsRehash: boolean;
}

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const SHA1_RE = /^[a-f0-9]{40}$/i;

function sha1(value: string): string {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex');
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeBcrypt(hash: string): string {
  return hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
}

export async function verifyPassword(
  password: string,
  stored: string,
  desiredRounds: number
): Promise<PasswordVerification> {
  if (!password || !stored) return { valid: false, scheme: 'unknown', needsRehash: false };

  if (BCRYPT_RE.test(stored)) {
    try {
      const normalized = normalizeBcrypt(stored);
      const valid = await bcrypt.compare(password, normalized);
      const rounds = Number(normalized.slice(4, 6));
      return { valid, scheme: 'bcrypt', needsRehash: valid && rounds < desiredRounds };
    } catch (_error: unknown) {
      return { valid: false, scheme: 'bcrypt', needsRehash: false };
    }
  }

  if (stored.length === 50 && SHA1_RE.test(stored.slice(10))) {
    const salt = stored.slice(0, 10);
    const digest = stored.slice(10).toLowerCase();
    const valid = [sha1(password + salt), sha1(salt + password)]
      .some((candidate) => equalText(candidate, digest));
    return { valid, scheme: 'sha1-50', needsRehash: valid };
  }

  if (stored.length === 40 && SHA1_RE.test(stored)) {
    const normalized = stored.toLowerCase();
    if (equalText(sha1(password), normalized)) {
      return { valid: true, scheme: 'sha1-40', needsRehash: true };
    }

    // Ion Auth's packed legacy format: salt(10) + first 30 chars of SHA1(salt + password).
    const salt = stored.slice(0, 10);
    const packed = salt + sha1(salt + password).slice(0, 30);
    const valid = equalText(packed, normalized);
    return { valid, scheme: 'ion-auth-packed-40', needsRehash: valid };
  }

  return { valid: false, scheme: 'unknown', needsRehash: false };
}

export async function hashPassword(password: string, rounds: number): Promise<string> {
  if (!password || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must contain 1 to 72 UTF-8 bytes for bcrypt');
  }
  return bcrypt.hash(password, rounds);
}
