import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAddiPayload,
  extractSaleIdFromWebhook,
  maskEmail,
  maskPhone,
  maskSecret,
  normalizeAddiCellphone,
  normalizeAuthUrl,
  parseBasicAuthHeader,
  readAmount,
  secureCompare,
  toAddiAmount
} from './addi.service';
import type { AddiPayloadInput } from './addi.service';

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
  it('finds ORDER-<saleId> in the official orderId field and nested/variant fields', () => {
    assert.equal(extractSaleIdFromWebhook({ orderId: 'ORDER-123-lx9k2' }), 123);
    assert.equal(extractSaleIdFromWebhook({ order_id: 'ORDER-77' }), 77);
    assert.equal(extractSaleIdFromWebhook({ data: { reference: 'order-9-abc' } }), 9);
  });

  it('accepts a pure numeric orderId as saleId (robustez)', () => {
    assert.equal(extractSaleIdFromWebhook({ orderId: 98765 }), 98765);
    assert.equal(extractSaleIdFromWebhook({ order_id: '98765' }), 98765);
  });

  it('rejects payloads without our reference format', () => {
    assert.equal(extractSaleIdFromWebhook({ orderId: 'ADDI-98765' }), null);
    assert.equal(extractSaleIdFromWebhook({ orderId: 'abc' }), null);
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

// ── v0.3.96 · schema oficial (ADDI API · E-commerce CO) ──────────────────────

describe('toAddiAmount', () => {
  it('formats amounts as strings with a dot decimal (spec examples use .0)', () => {
    assert.equal(toAddiAmount(45000), '45000.0');
    assert.equal(toAddiAmount(0), '0.0');
    assert.equal(toAddiAmount(7186.5), '7186.50');
  });
});

describe('normalizeAddiCellphone', () => {
  it('returns the 10-digit cellphone without country code (code goes in cellphoneCountryCode)', () => {
    assert.equal(normalizeAddiCellphone('3009998888'), '3009998888');
    assert.equal(normalizeAddiCellphone('300-999-8888'), '3009998888');
    assert.equal(normalizeAddiCellphone('573009998888'), '3009998888');
    assert.equal(normalizeAddiCellphone('+57 300 999 8888'), '3009998888');
  });

  it('returns empty string for empty input', () => {
    assert.equal(normalizeAddiCellphone(''), '');
    assert.equal(normalizeAddiCellphone('---'), '');
  });
});

const SAMPLE_INPUT: AddiPayloadInput = {
  orderId: 'ORDER-55-mf9k2',
  amount: 45000,
  taxAmount: 7186.5,
  firstName: 'Ana',
  lastName: 'Pérez Gómez',
  email: 'ana@test.com',
  cellphone: '3009998888',
  documentType: 'CC',
  documentNumber: '1001234567',
  callbackUrl: 'https://pos.tienderu.com/api/webhooks/addi',
  redirectionUrl: 'https://pos.tienderu.com/config?payment=return',
  items: [{ sku: 'SKU-1', name: 'Shampoo', quantity: 2, unitPrice: 22500, tax: 0 }],
  address: { lineOne: 'Calle Falsa 123', city: 'Bogotá', country: 'CO' },
  includeShipping: true
};

describe('buildAddiPayload', () => {
  it('matches the official OnlineLoanApplicationRequest schema (v0.3.96)', () => {
    const body = buildAddiPayload(SAMPLE_INPUT);
    assert.equal(body.orderId, 'ORDER-55-mf9k2');
    assert.equal(body.totalAmount, '45000.0');
    assert.equal(body.shippingAmount, '0.0');
    assert.equal(body.totalTaxesAmount, '7186.50');
    assert.equal(body.currency, 'COP');
    assert.equal('order_id' in body, false);
    assert.equal('amount' in body, false);
    assert.equal('discount_amount' in body, false);

    const items = body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0].sku, 'SKU-1');
    assert.equal(items[0].quantity, '2');
    assert.equal(items[0].unitPrice, '22500.0');
    assert.equal(items[0].tax, '0.0');
    assert.equal('price' in items[0], false);
    assert.equal('total_amount' in items[0], false);

    const client = body.client as Record<string, unknown>;
    assert.equal(client.idType, 'CC');
    assert.equal(client.idNumber, '1001234567');
    assert.equal(client.firstName, 'Ana');
    assert.equal(client.lastName, 'Pérez Gómez');
    assert.equal(client.email, 'ana@test.com');
    assert.equal(client.cellphone, '3009998888');
    assert.equal(client.cellphoneCountryCode, '+57');
    assert.deepEqual(client.address, { lineOne: 'Calle Falsa 123', city: 'Bogotá', country: 'CO' });
    assert.equal('customer' in body, false);

    const redirection = body.allyUrlRedirection as Record<string, unknown>;
    assert.equal(redirection.callbackUrl, 'https://pos.tienderu.com/api/webhooks/addi');
    assert.equal(redirection.redirectionUrl, 'https://pos.tienderu.com/config?payment=return');
    assert.equal('callback_url' in body, false);
    assert.equal('redirection_url' in body, false);

    assert.deepEqual(body.shippingAddress, SAMPLE_INPUT.address);
    assert.deepEqual(body.billingAddress, SAMPLE_INPUT.address);
  });

  it('omits shipping/billing blocks when toggled off (they are optional)', () => {
    const body = buildAddiPayload({ ...SAMPLE_INPUT, includeShipping: false });
    assert.equal('shippingAddress' in body, false);
    assert.equal('billingAddress' in body, false);
    assert.deepEqual((body.client as Record<string, unknown>).address, SAMPLE_INPUT.address);
  });
});