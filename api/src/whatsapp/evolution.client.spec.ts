import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { EvolutionClient } from './evolution.client';

type Call = { url: string; method: string; body: Record<string, unknown> | null };

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeClient(): EvolutionClient {
  const config = {
    get: (name: string): string | undefined =>
      name === 'EVOLUTION_API_URL'
        ? 'https://evolution.example.com'
        : name === 'EVOLUTION_API_KEY'
          ? 'test-key'
          : undefined
  } as unknown as ConfigService;
  return new EvolutionClient(config);
}

function stubFetch(handler: (call: Call) => { status: number; body?: unknown }): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    };
    calls.push(call);
    const result = handler(call);
    return new Response(result.body === undefined ? '' : JSON.stringify(result.body), { status: result.status });
  }) as typeof fetch;
  return calls;
}

describe('EvolutionClient.ensureInstance', () => {
  test('recrea la instancia cuando no existe en Evolution (404)', async () => {
    const calls = stubFetch((call) =>
      call.url.includes('/instance/connectionState/')
        ? { status: 404, body: { status: 404, error: 'Not Found' } }
        : { status: 200, body: { instance: { state: 'connecting' } } }
    );

    const recreated = await makeClient().ensureInstance('pos-smoke-12345678');

    assert.equal(recreated, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, 'https://evolution.example.com/instance/connectionState/pos-smoke-12345678');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].url, 'https://evolution.example.com/instance/create');
    assert.equal(calls[1].body?.instanceName, 'pos-smoke-12345678');
    assert.equal(calls[1].body?.integration, 'WHATSAPP-BAILEYS');
  });

  test('no recrea cuando la instancia ya existe', async () => {
    const calls = stubFetch(() => ({ status: 200, body: { instance: { state: 'open' } } }));

    const recreated = await makeClient().ensureInstance('pos-smoke-12345678');

    assert.equal(recreated, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  });

  test('tolera 409 al crear (instancia ya existe en race)', async () => {
    stubFetch((call) =>
      call.url.includes('/instance/connectionState/')
        ? { status: 404, body: {} }
        : { status: 409, body: { status: 409, error: 'Conflict', response: { message: 'already exists' } } }
    );

    const recreated = await makeClient().ensureInstance('pos-smoke-12345678');

    assert.equal(recreated, true);
  });
});
