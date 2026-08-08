'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSecret, parseTotpInput, generateTotp } = require('../src/totp');

test('normalizes a Base32 TOTP secret', () => {
  assert.equal(normalizeSecret('jbsw y3dp-ehpk3pxp==='), 'JBSWY3DPEHPK3PXP');
});

test('parses a standard otpauth TOTP URI', () => {
  assert.deepEqual(
    parseTotpInput('otpauth://totp/GitHub:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub'),
    { secret: 'JBSWY3DPEHPK3PXP', issuer: 'GitHub', accountName: 'user@example.com' }
  );
});

test('rejects HOTP and unsupported TOTP parameters', () => {
  assert.throws(() => parseTotpInput('otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=1'), /不支持 HOTP/);
  assert.throws(() => parseTotpInput('otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=8'), /仅支持 SHA1/);
  assert.throws(() => parseTotpInput('otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=60'), /仅支持 SHA1/);
  assert.throws(() => parseTotpInput('A'.repeat(4097)), /过长/);
});

test('generates the RFC 6238 compatible six digit token and timing metadata', () => {
  assert.deepEqual(generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), {
    code: '287082',
    period: 30,
    remaining: 1,
    generatedAt: '1970-01-01T00:00:59.000Z'
  });
});

test('server responses never expose a stored TOTP secret', () => {
  const server = require('node:fs').readFileSync('src/server.js', 'utf8');
  assert.match(server, /totp: aliasTotpResponse\(alias\)/);
  assert.match(server, /totp_secret_encrypted IS NOT NULL\) AS totp_enabled/);
  assert.doesNotMatch(server, /res\.json\([^\n]*parsed\.secret/);
});
