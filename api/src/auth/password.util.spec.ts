import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword } from './password.util';

const sha1 = (value: string): string => createHash('sha1').update(value, 'utf8').digest('hex');

test('verifies simple SHA1-40 legacy passwords', async () => {
  const password = 'legacy-test-password';
  const result = await verifyPassword(password, sha1(password), 12);
  assert.equal(result.valid, true);
  assert.equal(result.scheme, 'sha1-40');
  assert.equal(result.needsRehash, true);
});

test('verifies salted SHA1-50 legacy passwords', async () => {
  const password = 'legacy-test-password';
  const salt = 'ab12cd34ef';
  const result = await verifyPassword(password, `${salt}${sha1(password + salt)}`, 12);
  assert.equal(result.valid, true);
  assert.equal(result.scheme, 'sha1-50');
});

test('verifies the old packed Ion Auth SHA1-40 format', async () => {
  const password = 'legacy-test-password';
  const salt = 'ab12cd34ef';
  const stored = salt + sha1(salt + password).slice(0, 30);
  assert.equal((await verifyPassword(password, stored, 12)).valid, true);
});

test('rehashes verified legacy passwords as bcrypt and accepts PHP $2y$ hashes', async () => {
  const password = 'legacy-test-password';
  const bcryptHash = await hashPassword(password, 10);
  assert.equal((await verifyPassword(password, bcryptHash, 12)).valid, true);
  const phpHash = bcryptHash.replace(/^\$2[ab]\$/, '$2y$');
  assert.equal((await verifyPassword(password, phpHash, 10)).valid, true);
  assert.equal(await bcrypt.compare(password, bcryptHash), true);
});
