import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractSaleIdFromWebhook, maskEmail, maskPhone, maskSecret, normalizeAuthUrl, normalizePhoneForAddi, parseBasicAuthHeader, readAmount, secureCompare } from './addi.service';

describe('parseBasicAuthHeader', () => {
  it('decodes user:password', () => {
    const header = `Basic ${Buffer.from('user-1:secret-1').toString('base64')}`;
    assert.deepEqual(parseBasicAuthHeader(header), { user: 'user-1', password: 'secret-1' });
  });

  it('splits on the first colon (passwords may contain colons)', () => {
    const header = `Basic ${Buffer.from('user:pa:ss').toString('base64')}`;
    assert.deepEqual(parseBasicAuthHeader(header), { user: 'user', password: 'pa:ss' });
  });

  it('returns null for missing or malformed headers', () => {
    assert.equal(parseBasicAuthHeader(undefined), null);
    assert.equal(parseBasicAuthHeader('Bearer token'), null);
    assert.equal(parseBasicAuthHeader('Basic !!!'), null);
    assert.equal(parseBasicAuthHeader(`Basic ${Buffer.from('nocolon').toString('base64')}`), null);
  });
});

describe('secureCompare', () => {
  it('matches equal strings and rejects different ones', () => {
    assert.equal(secureCompare('abc', 'abc'), true);
    assert.equal(secureCompare('abc', 'abd'), false);
    assert.equal(secureCompare('abc', 'abcd'), false);
  });
});

describe('readAmount', () => {
  it('accepts numbers and numeric strings', () => {
    assert.equal(readAmount(50000), '50000');
    assert.equal(readAmount(49999.5), '49999.5');
    assert.equal(readAmount('50000'), '50000');
    assert.equal(readAmount(' 50000.25 '), '50000.25');
  });

  it('rejects empty, invalid and non-finite values', () => {
    assert.equal(readAmount(undefined), null);
    assert.equal(readAmount(null), null);
    assert.equal(readAmount(''), null);
    assert.equal(readAmount(Number.NaN), null);
    assert.equal(readAmount('abc'), null);
    assert.equal(readAmount('5e3'), null);
  });
});

describe('extractSaleIdFromWebhook', () => {
  it('finds ORDER-<saleId> in the known candidate fields', () => {
    assert.equal(extractSaleIdFromWebhook({ orderId: 'ORDER-123-lx9k2' }), 123);
    assert.equal(extractSaleIdFromWebhook({ external_id: 'ORDER-77' }), 77);
    assert.equal(extractSaleIdFromWebhook({ data: { reference: 'order-9-abc' } }), 9);
  });

  it('rejects payloads without our reference format', () => {
    assert.equal(extractSaleIdFromWebhook({ orderId: 'ADDI-98765' }), null);
    assert.equal(extractSaleIdFromWebhook({ orderId: 98765 }), null);
    assert.equal(extractSaleIdFromWebhook({}), null);
  });
});

describe('normalizeAuthUrl', () => {
  it('adds /oauth/token to a bare base URL (v0.3.80 404 hotfix)', () => {
    assert.equal(normalizeAuthUrl('https://auth.addi.com'), 'https://auth.addi.com/oauth/token');
    assert.equal(normalizeAuthUrl('https://auth.addi.com/'), 'https://auth.addi.com/oauth/token');
  });

  it('keeps a full URL unchanged and collapses double slashes', () => {
    assert.equal(normalizeAuthUrl('https://auth.addi-staging.com/oauth/token'), 'https://auth.addi-staging.com/oauth/token');
    assert.equal(normalizeAuthUrl('https://auth.addi.com/oauth/token/'), 'https://auth.addi.com/oauth/token');
    assert.equal(normalizeAuthUrl(' https://auth.addi.com//oauth/token '), 'https://auth.addi.com/oauth/token');
  });
});

describe('maskSecret', () => {
  it('never returns the full value', () => {
    assert.equal(maskSecret('short'), '***(5)');
    assert.equal(maskSecret('abcdefghijkl'), 'abcd…(12)');
  });
});

describe('maskEmail / maskPhone', () => {
  it('masks customer PII in debug logs', () => {
    assert.equal(maskEmail('juan@test.com'), 'j***@test.com');
    assert.equal(maskEmail(''), '');
    assert.equal(maskEmail('sin-arroba'), '***');
    assert.equal(maskPhone('3001234567'), '***4567');
    assert.equal(maskPhone('123'), '***');
  });
});

describe('normalizePhoneForAddi', () => {
  it('prepends 57 (no + sign) to 10-digit Colombian numbers', () => {
    assert.equal(normalizePhoneForAddi('3009998888'), '573009998888');
    assert.equal(normalizePhoneForAddi('300-999-8888'), '573009998888');
  });

  it('strips the + from numbers that already carry a country code', () => {
    assert.equal(normalizePhoneForAddi('+57 300 999 8888'), '573009998888');
    assert.equal(normalizePhoneForAddi('573009998888'), '573009998888');
    assert.equal(normalizePhoneForAddi('+15551234567'), '15551234567');
  });

  it('returns empty string for empty input', () => {
    assert.equal(normalizePhoneForAddi(''), '');
    assert.equal(normalizePhoneForAddi('---'), '');
  });
});
