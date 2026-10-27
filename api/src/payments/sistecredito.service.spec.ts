import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SISTECREDITO_GENERIC_ERROR_MESSAGE,
  SISTECREDITO_CREDIT_IN_PROGRESS_MESSAGE,
  buildSistecreditoAck,
  buildSistecreditoCreatePayload,
  buildSistecreditoJwt,
  buildSistecreditoToken,
  formatSistecreditoDate,
  mapSistecreditoError,
  normalizeSistecreditoDocumentNumber,
  normalizeSistecreditoDocumentType,
  toCents,
  verifySistecreditoJwt
} from './sistecredito.service';

const SECRET = 'test-secret-0123456789abcdef';
const AUDIENCE = 'https://pos.tienderu.com';

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>;
}

describe('buildSistecreditoToken', () => {
  it('es determinista por venta y cambia entre ventas (HMAC del secreto)', () => {
    const token = buildSistecreditoToken(SECRET, 123);
    assert.equal(token, buildSistecreditoToken(SECRET, 123));
    assert.notEqual(token, buildSistecreditoToken(SECRET, 124));
    assert.notEqual(token, buildSistecreditoToken('otro-secreto', 123));
    assert.match(token, /^[0-9a-f]{64}$/);
  });
});

describe('buildSistecreditoJwt / verifySistecreditoJwt', () => {
  it('construye un JWT HS256 con iss/aud de la URL pública y nbf +30 s (contrato del plugin)', () => {
    const token = buildSistecreditoToken(SECRET, 55);
    const jwt = buildSistecreditoJwt(token, AUDIENCE, 1_700_000_000);
    const parts = jwt.split('.');
    assert.equal(parts.length, 3);
    const header = decodePart(parts[0]);
    assert.equal(header.alg, 'HS256');
    assert.equal(header.typ, 'JWT');
    const payload = decodePart(parts[1]);
    assert.equal(payload.iss, AUDIENCE);
    assert.equal(payload.aud, AUDIENCE);
    assert.equal(payload.iat, 1_700_000_000);
    assert.equal(payload.nbf, 1_700_000_030);
  });

  it('verifica firma y aud; rechaza token, aud o payload alterados', () => {
    const token = buildSistecreditoToken(SECRET, 55);
    const jwt = buildSistecreditoJwt(token, AUDIENCE, 1_700_000_000);
    assert.equal(verifySistecreditoJwt(jwt, token, AUDIENCE), true);
    assert.equal(verifySistecreditoJwt(jwt, buildSistecreditoToken(SECRET, 56), AUDIENCE), false);
    assert.equal(verifySistecreditoJwt(jwt, token, 'https://otro.tienderu.com'), false);

    const [header, payload, signature] = jwt.split('.');
    const tampered = `${header}.${payload.slice(0, -2)}AA.${signature}`;
    assert.equal(verifySistecreditoJwt(tampered, token, AUDIENCE), false);
    assert.equal(verifySistecreditoJwt('no-es-un-jwt', token, AUDIENCE), false);
    assert.equal(verifySistecreditoJwt(`${header}.${payload}.`, token, AUDIENCE), false);
  });
});

describe('formatSistecreditoDate', () => {
  it('formatea ISO-8601 con offset (Y-m-d\\TH:i:sP)', () => {
    const text = formatSistecreditoDate(new Date('2026-10-26T12:00:00Z'));
    assert.match(text, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});

describe('normalizeSistecreditoDocumentType / Number', () => {
  it('acepta CC/CE (cualquier caja) y solo dígitos para el número', () => {
    assert.equal(normalizeSistecreditoDocumentType('cc'), 'CC');
    assert.equal(normalizeSistecreditoDocumentType('Ce'), 'CE');
    assert.equal(normalizeSistecreditoDocumentType('XX'), null);
    assert.equal(normalizeSistecreditoDocumentType(''), null);
    assert.equal(normalizeSistecreditoDocumentNumber(' 1234567 '), '1234567');
    assert.equal(normalizeSistecreditoDocumentNumber('12 34'), null);
    assert.equal(normalizeSistecreditoDocumentNumber('ABC123'), null);
    assert.equal(normalizeSistecreditoDocumentNumber(null), null);
  });
});

describe('buildSistecreditoCreatePayload', () => {
  it('arma el body exacto del checkout (valueToPaid numérico, orderId int)', () => {
    const body = buildSistecreditoCreatePayload({
      saleId: 77,
      amount: 55000.5,
      documentType: 'CC',
      documentNumber: '1234567',
      vendorId: 'vendor-1',
      storeId: 'store-1',
      responseUrl: 'https://pos.tienderu.com/api/webhooks/sistecredito',
      transactionDate: '2026-10-26T12:00:00+00:00'
    });
    assert.deepEqual(body, {
      typeDocument: 'CC',
      idDocument: '1234567',
      transactionDate: '2026-10-26T12:00:00+00:00',
      valueToPaid: 55000.5,
      vendorId: 'vendor-1',
      storeId: 'store-1',
      orderId: 77,
      responseUrl: 'https://pos.tienderu.com/api/webhooks/sistecredito'
    });
  });

  it('genera transactionDate con offset cuando no se inyecta', () => {
    const body = buildSistecreditoCreatePayload({
      saleId: 1,
      amount: 1000,
      documentType: 'CE',
      documentNumber: '99',
      vendorId: 'v',
      storeId: 's',
      responseUrl: 'https://pos.tienderu.com/api/webhooks/sistecredito'
    });
    assert.match(String(body.transactionDate), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    assert.equal(body.valueToPaid, 1000);
  });
});

describe('toCents', () => {
  it('convierte a centavos enteros y rechaza valores inválidos', () => {
    assert.equal(toCents(45000), 4500000);
    assert.equal(toCents('45000.10'), 4500010);
    assert.equal(toCents('0'), 0);
    assert.equal(toCents('45000,10'), null);
    assert.equal(toCents('abc'), null);
    assert.equal(toCents(null), null);
  });
});

describe('mapSistecreditoError', () => {
  it('mapea el catálogo público y usa genérico para el resto', () => {
    assert.equal(mapSistecreditoError('801'), SISTECREDITO_CREDIT_IN_PROGRESS_MESSAGE);
    assert.match(mapSistecreditoError('802'), /mínimo permitido/);
    assert.equal(mapSistecreditoError('999'), SISTECREDITO_GENERIC_ERROR_MESSAGE);
    assert.equal(mapSistecreditoError(null), SISTECREDITO_GENERIC_ERROR_MESSAGE);
  });
});

describe('buildSistecreditoAck', () => {
  it('arma el acuse exacto que espera la pasarela', () => {
    const ack = buildSistecreditoAck({
      errorCode: 0,
      message: '',
      orderId: 77,
      transactionId: 'tx-1',
      status: 'VALID',
      errors: []
    });
    assert.deepEqual(ack, {
      function: '/api/webhooks/sistecredito',
      errorCode: 0,
      message: '',
      country: 'co',
      data: { orderId: 77, transactionId: 'tx-1', status: 'VALID', errors: [] }
    });
  });
});
