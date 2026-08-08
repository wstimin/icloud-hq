'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const server = fs.readFileSync('src/server.js', 'utf8');
const schema = fs.readFileSync('src/schema.sql', 'utf8');
const admin = fs.readFileSync('public/admin.js', 'utf8');

test('mail, alias, and TOTP records have scoped edit routes', () => {
  const mailEdit = server.slice(
    server.indexOf("app.patch('/api/admin/mail-account/:id'"),
    server.indexOf("app.post('/api/admin/mail-account/:id/toggle'")
  );
  const aliasEdit = server.slice(
    server.indexOf("app.patch('/api/admin/aliases/:id'"),
    server.indexOf("app.get('/api/admin/aliases/export'")
  );
  const totpEdit = server.slice(
    server.indexOf("app.patch('/api/admin/totp-entries/:id'"),
    server.indexOf("app.delete('/api/admin/totp-entries/:id'")
  );

  assert.match(mailEdit, /suppliedPassword \|\| decrypt\(current\.rows\[0\]\.app_password_encrypted\)/);
  assert.doesNotMatch(mailEdit, /enabled = TRUE/);
  assert.match(mailEdit, /mail_account_edited/);
  assert.match(aliasEdit, /label = \$3/);
  assert.match(aliasEdit, /WHEN \$4 = 'keep' THEN token_expires_at/);
  assert.doesNotMatch(aliasEdit, /token_digest|token_encrypted|token_hint/);
  assert.match(aliasEdit, /alias_edited/);
  assert.match(totpEdit, /SET issuer = \$1, account_name = \$2/);
  assert.doesNotMatch(totpEdit, /secret_encrypted|secret_fingerprint/);
  assert.match(totpEdit, /totp_entry_edited/);
  assert.match(admin, /openAliasEditor/);
  assert.match(admin, /openTotpEditor/);
  assert.match(admin, /不会修改原始 2FA 密钥/);
});

test('duplicate and invalid relation errors return useful client responses', () => {
  const errorHandler = server.slice(server.indexOf('app.use((error, req, res, _next)'), server.indexOf('async function start()'));
  assert.match(errorHandler, /error\.code === '23505'/);
  assert.match(errorHandler, /status\(409\)/);
  assert.match(errorHandler, /该母邮箱已经存在/);
  assert.match(errorHandler, /该子邮箱已经存在/);
  assert.match(errorHandler, /error\.code === '23503'/);
});

test('sessions and persistent failure guards are backed by database state', () => {
  assert.match(schema, /CREATE SEQUENCE IF NOT EXISTS sessions_session_id_seq/);
  assert.match(schema, /UPDATE sessions SET session_id = nextval/);
  assert.match(schema, /user_agent TEXT NOT NULL DEFAULT ''/);
  assert.match(server, /async function failureGuard/);
  assert.match(server, /FROM audit_logs/);
  assert.match(server, /app\.delete\('\/api\/admin\/sessions\/:id'/);
  assert.match(server, /app\.post\('\/api\/admin\/sessions\/revoke-others'/);
  assert.match(admin, /data-session-revoke/);
});
