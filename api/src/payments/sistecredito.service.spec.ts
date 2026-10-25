import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSistecreditoStubPayload, buildSistecreditoStubUrl } from './sistecredito.service';

describe('buildSistecreditoStubUrl', () => {
  it('builds the ORDER- reference URL and trims trailing slashes', () => {
    assert.equal(
      buildSistecreditoStubUrl('https://sandbox.sistecredito.com/checkout', 123),
      'https://sandbox.sistecredito.com/checkout?order=ORDER-123'
    );
    assert.equal(
      buildSistecreditoStubUrl('https://checkout.sistecredito.com/', 7),
      'https://checkout.sistecredito.com?order=ORDER-7'
    );
  });
});

describe('buildSistecreditoStubPayload', () => {
  it('rounds the amount and uses ORDER-<saleId> as reference', () => {
    const payload = buildSistecreditoStubPayload({
      tenantId: 'tenant-1',
      saleId: 88,
      amount: 45000.4,
      redirectionUrl: 'https://pos.tienderu.com/config?payment=return'
    });
    assert.deepEqual(payload, {
      merchant_order_id: 'ORDER-88',
      reference: 'ORDER-88',
      amount: 45000,
      currency: 'COP',
      callback_url: 'https://pos.tienderu.com/config?payment=return',
      tenant_id: 'tenant-1'
    });
  });

  it('falls back to the platform URL when no redirection is configured', () => {
    const payload = buildSistecreditoStubPayload({
      tenantId: 'tenant-1',
      saleId: 5,
      amount: 1000,
      redirectionUrl: null
    });
    assert.equal(payload.callback_url, 'https://pos.tienderu.com');
  });
});