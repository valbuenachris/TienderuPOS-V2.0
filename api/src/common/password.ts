import { createHash } from 'node:crypto';
import { hashPassword } from '../auth/password.util';

export type PasswordStorageMethod = 'sha1' | 'bcrypt';

export async function hashForStorage(
  password: string,
  method: PasswordStorageMethod,
  bcryptRounds: number
): Promise<string> {
  if (method === 'bcrypt') return hashPassword(password, bcryptRounds);
  return createHash('sha1').update(password, 'utf8').digest('hex');
}
