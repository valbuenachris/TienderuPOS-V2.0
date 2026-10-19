import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseEvolutionWebhook } from './evolution-webhook.util';

test('parseEvolutionWebhook', async (t) => {
  await t.test('connection.update devuelve el estado normalizado', () => {
    const parsed = parseEvolutionWebhook({ event: 'connection.update', data: { state: 'OPEN' } });
    assert.deepEqual(parsed, { kind: 'connection', state: 'open' });
  });

  await t.test('connection.update sin estado se ignora', () => {
    assert.deepEqual(parseEvolutionWebhook({ event: 'connection.update', data: {} }), { kind: 'ignored' });
  });

  await t.test('messages.upsert de 1:1 parsea teléfono, texto y metadatos', () => {
    const parsed = parseEvolutionWebhook({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '573001234567@s.whatsapp.net', fromMe: false, id: 'ABC123' },
        pushName: 'Ana',
        message: { conversation: '  hola  ' }
      }
    });
    assert.deepEqual(parsed, {
      kind: 'message',
      phone: '573001234567',
      fromMe: false,
      messageId: 'ABC123',
      pushName: 'Ana',
      text: 'hola'
    });
  });

  await t.test('texto extendido y fromMe', () => {
    const parsed = parseEvolutionWebhook({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '573001234567@s.whatsapp.net', fromMe: true, id: 'X1' },
        message: { extendedTextMessage: { text: 'respuesta del asesor' } }
      }
    });
    assert.equal(parsed.kind, 'message');
    if (parsed.kind === 'message') {
      assert.equal(parsed.fromMe, true);
      assert.equal(parsed.text, 'respuesta del asesor');
    }
  });

  await t.test('grupos, difusión y status se ignoran', () => {
    for (const jid of ['12345@g.us', '123@broadcast', 'status@broadcast']) {
      assert.deepEqual(
        parseEvolutionWebhook({
          event: 'messages.upsert',
          data: { key: { remoteJid: jid, id: '1' }, message: { conversation: 'x' } }
        }),
        { kind: 'ignored' }
      );
    }
  });

  await t.test('eventos desconocidos y cuerpos inválidos se ignoran', () => {
    assert.deepEqual(parseEvolutionWebhook({ event: 'messages.update' }), { kind: 'ignored' });
    assert.deepEqual(parseEvolutionWebhook(null), { kind: 'ignored' });
    assert.deepEqual(parseEvolutionWebhook('texto'), { kind: 'ignored' });
  });
});
