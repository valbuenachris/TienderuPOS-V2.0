import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

describe('customer checkout gateway preflight', () => {
  test('does not create a sale when the gateway is not configured', async () => {
    let salesCreated = 0;
    const sales = { createForCustomer: async () => { salesCreated++; return {}; } };
    const settings = { requireProvider: async () => { throw new BadRequestException('not configured'); } };
    const service = new PaymentsService(
      sales as never, {} as never, {} as never, settings as never,
      {} as never, {} as never, {} as never
    );

    await assert.rejects(
      service.checkoutWithPayment('tenant', {} as never, { payment_method: 'bold' }),
      /not configured/
    );
    assert.equal(salesCreated, 0);
  });

  test('cash checkout does not require gateway configuration', async () => {
    const sales = { createForCustomer: async () => ({ id: 7, status: 'due' }) };
    const settings = { requireProvider: async () => { throw new Error('unexpected gateway lookup'); } };
    const service = new PaymentsService(
      sales as never, {} as never, {} as never, settings as never,
      {} as never, {} as never, {} as never
    );

    const result = await service.checkoutWithPayment('tenant', {} as never, { payment_method: 'cash' });
    assert.equal(result.order_id, 7);
    assert.equal(result.payment_url, null);
  });

  test('does not create a sale when financing prerequisites are missing', async () => {
    for (const method of ['addi', 'sistecredito'] as const) {
      let salesCreated = 0;
      const sales = { createForCustomer: async () => { salesCreated++; return {}; } };
      const settings = { requireProvider: async () => ({}) };
      const gateway = { validateCustomer: async () => { throw new BadRequestException('missing customer data'); } };
      const service = new PaymentsService(
        sales as never, {} as never, {} as never, settings as never,
        {} as never, gateway as never, gateway as never
      );

      await assert.rejects(service.checkoutWithPayment('tenant', {} as never, { payment_method: method }), /missing customer data/);
      assert.equal(salesCreated, 0);
    }
  });
});
