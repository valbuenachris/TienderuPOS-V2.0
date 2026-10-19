import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { computeParentOrderStatus } from './marketplace-order-status';

test('computeParentOrderStatus', async (t) => {
  await t.test('todas pagadas -> paid', () => {
    assert.equal(computeParentOrderStatus([{ status: 'paid', count: 2 }]), 'paid');
  });

  await t.test('todas entregadas -> delivered', () => {
    assert.equal(computeParentOrderStatus([{ status: 'delivered', count: 2 }]), 'delivered');
  });

  await t.test('enviadas + entregadas -> shipped', () => {
    assert.equal(
      computeParentOrderStatus([
        { status: 'shipped', count: 1 },
        { status: 'delivered', count: 1 }
      ]),
      'shipped'
    );
  });

  await t.test('pagada + entregada -> paid (paridad con la lógica previa)', () => {
    assert.equal(
      computeParentOrderStatus([
        { status: 'paid', count: 1 },
        { status: 'delivered', count: 1 }
      ]),
      'paid'
    );
  });

  await t.test('todas canceladas -> cancelled', () => {
    assert.equal(computeParentOrderStatus([{ status: 'cancelled', count: 2 }]), 'cancelled');
  });

  await t.test('cancelada + pagada -> paid', () => {
    assert.equal(
      computeParentOrderStatus([
        { status: 'cancelled', count: 1 },
        { status: 'paid', count: 1 }
      ]),
      'paid'
    );
  });

  await t.test('cancelada + pendiente -> pending_payment', () => {
    assert.equal(
      computeParentOrderStatus([
        { status: 'cancelled', count: 1 },
        { status: 'pending', count: 1 }
      ]),
      'pending_payment'
    );
  });

  await t.test('pendiente -> pending_payment', () => {
    assert.equal(computeParentOrderStatus([{ status: 'pending', count: 1 }]), 'pending_payment');
  });

  await t.test('sin sub-órdenes -> pending_payment', () => {
    assert.equal(computeParentOrderStatus([]), 'pending_payment');
  });
});
