import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { MarketplaceRateLimitService } from './marketplace-rate-limit.service';

test('MarketplaceRateLimitService', async (t) => {
  await t.test('permite hasta el límite y bloquea el exceso con 429', () => {
    const service = new MarketplaceRateLimitService();
    const rule = { limit: 2, windowMs: 60_000 };
    service.assertWithin('clave', rule);
    service.assertWithin('clave', rule);
    assert.throws(
      () => service.assertWithin('clave', rule),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429
    );
  });

  await t.test('claves distintas no comparten ventana', () => {
    const service = new MarketplaceRateLimitService();
    const rule = { limit: 1, windowMs: 60_000 };
    service.assertWithin('a', rule);
    service.assertWithin('b', rule);
    assert.throws(() => service.assertWithin('a', rule));
  });

  await t.test('la ventana deslizante expira', async () => {
    const service = new MarketplaceRateLimitService();
    const rule = { limit: 1, windowMs: 30 };
    service.assertWithin('ventana', rule);
    await new Promise((resolve) => setTimeout(resolve, 50));
    service.assertWithin('ventana', rule);
  });
});
