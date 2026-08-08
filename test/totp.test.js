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

test('public and routine admin responses never expose a stored TOTP secret', () => {
  const server = require('node:fs').readFileSync('src/server.js', 'utf8');
  const publicRoutes = server.slice(server.indexOf("app.post('/api/query'"), server.indexOf("app.post('/api/admin/login'"));
  const stateRoute = server.slice(server.indexOf("app.get('/api/admin/state'"), server.indexOf("app.post('/api/admin/mail-account'"));
  assert.match(server, /res\.json\(\{ alias: maskEmail\(alias\.address\), label: alias\.label, totp: aliasTotpResponse\(alias\) \}\)/);
  assert.match(server, /totp_secret_encrypted IS NOT NULL\) AS totp_enabled/);
  assert.doesNotMatch(publicRoutes, /secret:\s*(?:parsed|totpSecret)/);
  assert.match(stateRoute, /token_encrypted IS NOT NULL\) AS token_recoverable/);
  assert.doesNotMatch(stateRoute, /a\.token_encrypted\s*,|decrypt\(|secret:/);
});

test('administrator secret reveal requires password confirmation and is audited', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync('src/server.js', 'utf8');
  const schema = fs.readFileSync('src/schema.sql', 'utf8');
  const admin = fs.readFileSync('public/admin.js', 'utf8');
  const route = server.slice(server.indexOf("app.post('/api/admin/aliases/:id/secrets'"), server.indexOf("app.put('/api/admin/aliases/:id/totp'"));
  assert.match(schema, /token_encrypted TEXT/);
  assert.match(server, /INSERT INTO aliases\(mail_account_id, address, label, token_digest, token_encrypted/);
  assert.match(server, /\[accountId, address, label, digest\(token\), encrypt\(token\)/);
  assert.match(server, /token_digest = \$1, token_encrypted = \$2/);
  assert.match(route, /verifyPassword\(password/);
  assert.match(route, /alias_secrets_revealed/);
  assert.match(route, /queryToken: decrypt\(alias\.token_encrypted\)/);
  assert.match(route, /secret: totpSecret/);
  assert.match(admin, /data-alias-secrets/);
  assert.match(admin, /当前管理员密码/);
});

test('mail and TOTP queries use separate public responses', () => {
  const server = require('node:fs').readFileSync('src/server.js', 'utf8');
  const mailRoute = server.slice(server.indexOf("app.post('/api/query'"), server.indexOf("app.post('/api/query/totp'"));
  const totpRoute = server.slice(server.indexOf("app.post('/api/query/totp'"), server.indexOf("app.put('/api/query/totp'"));
  assert.doesNotMatch(mailRoute, /aliasTotpResponse/);
  assert.doesNotMatch(totpRoute, /verification_messages|code_encrypted/);
});

test('public page keeps mail and TOTP in separate tabs and forms', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const script = fs.readFileSync('public/query.js', 'utf8');
  assert.match(html, /data-query-tab="mail"/);
  assert.match(html, /data-query-tab="totp"/);
  assert.match(html, /id="mail-query-form"/);
  assert.match(html, /id="totp-query-form"/);
  assert.match(script, /request\('\/api\/query', mailTokenInput/);
  assert.match(script, /request\('\/api\/query\/totp', totpTokenInput/);
});
