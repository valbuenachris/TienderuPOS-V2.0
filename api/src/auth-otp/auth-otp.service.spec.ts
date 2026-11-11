import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildOtpMessage,
  generateOtp,
  hashOtp,
  hashOtpWithSalt,
  normalizeOtpIdentity,
  waNumberFromPhone
} from './auth-otp.service';

describe('AuthOtpService pure helpers', () => {
  it('normaliza identidades: email a minúsculas y teléfono a dígitos', () => {
    assert.equal(normalizeOtpIdentity(' Juan@Example.COM '), 'juan@example.com');
    assert.equal(normalizeOtpIdentity(' 300 123-4567 '), '3001234567');
    assert.equal(normalizeOtpIdentity(''), '');
  });

  it('genera códigos de 6 dígitos', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtp();
      assert.match(code, /^\d{6}$/);
      assert.ok(Number(code) >= 100000 && Number(code) <= 999999);
    }
  });

  it('hash del código es determinista por sal y no guarda el código en claro', () => {
    const { salt, hash } = hashOtp('123456');
    assert.notEqual(hash, '123456');
    assert.ok(!hash.includes('123456'));
    assert.equal(hashOtpWithSalt(salt, '123456'), hash);
    assert.notEqual(hashOtpWithSalt(salt, '654321'), hash);
    const other = hashOtp('123456');
    assert.notEqual(other.hash, hash, 'sal distinta debe producir hash distinto');
  });

  it('construye el número de WhatsApp con +57', () => {
    assert.equal(waNumberFromPhone('3001234567'), '573001234567');
    assert.equal(waNumberFromPhone(' 300 123-4567 '), '573001234567');
    assert.equal(waNumberFromPhone('123'), null);
    assert.equal(waNumberFromPhone(''), null);
    assert.equal(waNumberFromPhone(null), null);
  });

  it('mensaje incluye el código y la vigencia', () => {
    const msg = buildOtpMessage('123456');
    assert.ok(msg.includes('123456'));
    assert.ok(msg.includes('10 minutos'));
    assert.ok(msg.includes('Princess Skin'));
  });
});