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

test('mail accounts support fixed iCloud, Gmail, and Outlook provider presets', () => {
  const createRoute = server.slice(
    server.indexOf("app.post('/api/admin/mail-account'"),
    server.indexOf("app.patch('/api/admin/mail-account/:id'")
  );
  const editRoute = server.slice(
    server.indexOf("app.patch('/api/admin/mail-account/:id'"),
    server.indexOf("app.post('/api/admin/mail-account/:id/secrets'")
  );

  assert.match(schema, /provider TEXT NOT NULL DEFAULT 'icloud'/);
  assert.match(schema, /LOWER\(host\) = 'imap\.gmail\.com'/);
  assert.match(schema, /'outlook\.office365\.com', 'imap-mail\.outlook\.com'/);
  assert.match(server, /icloud: \{ host: 'imap\.mail\.me\.com', port: 993, secure: true \}/);
  assert.match(server, /gmail: \{ host: 'imap\.gmail\.com', port: 993, secure: true \}/);
  assert.match(server, /outlook: \{ host: 'outlook\.office365\.com', port: 993, secure: true \}/);
  assert.match(createRoute, /const config = mailAccountConfig\(req\.body\)/);
  assert.doesNotMatch(createRoute, /req\.body\.host|req\.body\.port/);
  assert.match(editRoute, /config\.provider !== current\.rows\[0\]\.provider && !suppliedPassword/);
  assert.match(admin, /id="account-provider"/);
  assert.match(admin, /id="edit-account-provider"/);
  assert.match(admin, /Google 应用专用密码/);
  assert.match(admin, /Microsoft 账户或企业租户需要 OAuth/);
  assert.doesNotMatch(admin, /id="account-host"|id="account-port"/);
});

test('mail authorization passwords require administrator confirmation before reveal', () => {
  const revealRoute = server.slice(
    server.indexOf("app.post('/api/admin/mail-account/:id/secrets'"),
    server.indexOf("app.post('/api/admin/mail-account/:id/toggle'")
  );
  const stateRoute = server.slice(
    server.indexOf("app.get('/api/admin/state'"),
    server.indexOf("app.post('/api/admin/sessions/revoke-others'")
  );

  assert.match(revealRoute, /noStore\(res\)/);
  assert.match(revealRoute, /verifyPassword/);
  assert.match(revealRoute, /mail_account_secret_reveal_failed/);
  assert.match(revealRoute, /mail_account_secret_revealed/);
  assert.match(revealRoute, /appPassword: decrypt\(account\.app_password_encrypted\)/);
  assert.doesNotMatch(stateRoute, /app_password_encrypted|appPassword:/);
  assert.match(admin, /data-account-secrets/);
  assert.match(admin, /当前管理员登录密码/);
  assert.match(admin, /copy-app-password/);
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
