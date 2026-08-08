'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { ImapFlow } = require('imapflow');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
const { parseTotpInput, generateTotp } = require('./totp');
const {
  pool, initDatabase, randomToken, digest, encrypt, decrypt, hashPassword,
  verifyPassword, normalizeEmail, validEmail, maskEmail, extractClientIp,
  audit, cleanExpired
} = require('./lib');

const app = express();
const port = Number(process.env.PORT || 3000);
const sessionHours = Number(process.env.SESSION_HOURS || 12);
const queryLimit = Number(process.env.QUERY_LIMIT_PER_10_MINUTES || 30);
const loginLimit = Number(process.env.LOGIN_LIMIT_PER_15_MINUTES || 10);
const adminAllowedIps = new Set(String(process.env.ADMIN_ALLOWED_IPS || '')
  .split(',').map((item) => item.trim()).filter(Boolean));
const rateBuckets = new Map();

if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use('/assets', express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  maxAge: '1h',
  index: false
}));

function noStore(res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
}

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  return {
    allowed: current.count <= max,
    retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  };
}

async function findPublicAlias(token) {
  if (token.length < 20 || token.length > 200) return null;
  const result = await pool.query(
    `SELECT id, address, label, totp_secret_encrypted, totp_issuer, totp_account_name
     FROM aliases
     WHERE token_digest = $1 AND enabled = TRUE
       AND (token_expires_at IS NULL OR token_expires_at > NOW())`,
    [digest(token)]
  );
  return result.rows[0] || null;
}

function aliasTotpResponse(alias) {
  if (!alias.totp_secret_encrypted) return null;
  return {
    ...generateTotp(decrypt(alias.totp_secret_encrypted)),
    issuer: alias.totp_issuer || '',
    accountName: alias.totp_account_name || ''
  };
}

function adminNetwork(req, res, next) {
  if (!adminAllowedIps.size || adminAllowedIps.has(extractClientIp(req))) return next();
  return res.status(403).json({ error: '此网络无权访问管理端' });
}

async function sessionAuth(req, res, next) {
  try {
    const sessionToken = readCookie(req, 'cv_session');
    if (!sessionToken) return res.status(401).json({ error: '请先登录' });
    const result = await pool.query(
      `SELECT s.csrf_token, s.expires_at, u.id, u.email, u.role, u.totp_secret_encrypted
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = $1 AND s.expires_at > NOW()`,
      [digest(sessionToken)]
    );
    if (!result.rowCount) return res.status(401).json({ error: '登录已失效' });
    req.admin = result.rows[0];
    req.sessionToken = sessionToken;
    next();
  } catch (error) {
    next(error);
  }
}

async function adminPageAuth(req, res, next) {
  const sessionToken = readCookie(req, 'cv_session');
  if (!sessionToken) return res.redirect('/admin/login');
  try {
    const result = await pool.query(
      'SELECT 1 FROM sessions WHERE id_hash = $1 AND expires_at > NOW()',
      [digest(sessionToken)]
    );
    if (!result.rowCount) return res.redirect('/admin/login');
    next();
  } catch (error) { next(error); }
}

function csrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const supplied = String(req.headers['x-csrf-token'] || '');
  if (!supplied || supplied !== req.admin.csrf_token) {
    return res.status(403).json({ error: '安全校验失败，请刷新页面' });
  }
  next();
}

function adminApi(handler) {
  return [adminNetwork, sessionAuth, csrf, async (req, res, next) => {
    try { await handler(req, res); } catch (error) { next(error); }
  }];
}

async function createSession(userId, res) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  await pool.query(
    `INSERT INTO sessions(id_hash, user_id, csrf_token, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::interval)`,
    [digest(token), userId, csrfToken, String(sessionHours)]
  );
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `cv_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionHours * 3600}${secure}`);
  return csrfToken;
}

async function ensureAdmin() {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (result.rows[0].count > 0) return;
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!validEmail(email) || password.length < 8 || password.startsWith('replace-')) {
    throw new Error('Set a valid ADMIN_EMAIL and an ADMIN_PASSWORD of at least 8 characters before first boot');
  }
  const passwordHash = await hashPassword(password);
  await pool.query('INSERT INTO users(email, password_hash) VALUES ($1, $2)', [email, passwordHash]);
  console.log(`Initial administrator created: ${email}`);
}

async function testImap({ email, password, host = 'imap.mail.me.com', port: imapPort = 993, secure = true }) {
  const client = new ImapFlow({
    host, port: Number(imapPort), secure: Boolean(secure),
    auth: { user: email, pass: password },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    lock.release();
  } finally {
    if (client.usable) await client.logout().catch(() => {});
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => {
  noStore(res);
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.get('/admin/login', adminNetwork, (_req, res) => {
  noStore(res);
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});
app.get('/admin', adminNetwork, adminPageAuth, (_req, res) => {
  noStore(res);
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.post('/api/query', async (req, res, next) => {
  noStore(res);
  const ip = extractClientIp(req);
  const limit = rateLimit(`query:${ip}`, queryLimit, 10 * 60 * 1000);
  if (!limit.allowed) {
    res.set('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ error: `请求过于频繁，请在 ${limit.retryAfter} 秒后重试` });
  }
  try {
    const token = String(req.body.token || '').trim();
    if (token.length < 20 || token.length > 200) {
      await audit({ actor: 'public', action: 'query_failed', ip, detail: 'invalid token format' });
      return res.status(401).json({ error: '查询密钥无效或已失效' });
    }
    const alias = await findPublicAlias(token);
    if (!alias) {
      await audit({ actor: 'public', action: 'query_failed', ip, detail: 'unknown token' });
      return res.status(401).json({ error: '查询密钥无效或已失效' });
    }
    const messageResult = await pool.query(
      `SELECT id, sender, subject, code_encrypted, received_at, expires_at
       FROM verification_messages
       WHERE alias_id = $1 AND expires_at > NOW() AND code_encrypted IS NOT NULL
       ORDER BY received_at DESC LIMIT 1`,
      [alias.id]
    );
    await audit({ actor: `alias:${alias.id}`, action: 'query_success', target: String(alias.id), ip });
    const message = messageResult.rows[0] || null;
    return res.json({
      alias: maskEmail(alias.address),
      label: alias.label,
      message: message ? {
        id: message.id,
        code: decrypt(message.code_encrypted),
        sender: message.sender,
        subject: message.subject,
        receivedAt: message.received_at,
        expiresAt: message.expires_at
      } : null,
      totp: aliasTotpResponse(alias)
    });
  } catch (error) { next(error); }
});

app.put('/api/query/totp', async (req, res, next) => {
  noStore(res);
  const ip = extractClientIp(req);
  const limit = rateLimit(`query-totp:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) return res.status(429).json({ error: '2FA 绑定操作过于频繁，请稍后再试' });
  try {
    const token = String(req.body.token || '').trim();
    const alias = await findPublicAlias(token);
    if (!alias) {
      await audit({ actor: 'public', action: 'alias_totp_save_failed', ip, detail: 'unknown token' });
      return res.status(401).json({ error: '查询密钥无效或已失效' });
    }
    const parsed = parseTotpInput(req.body.secret);
    const generated = generateTotp(parsed.secret);
    await pool.query(
      `UPDATE aliases SET totp_secret_encrypted = $1, totp_issuer = $2,
       totp_account_name = $3, updated_at = NOW() WHERE id = $4`,
      [encrypt(parsed.secret), parsed.issuer, parsed.accountName, alias.id]
    );
    await audit({ actor: `alias:${alias.id}`, action: 'alias_totp_saved_public', target: String(alias.id), ip });
    res.json({ ok: true, totp: { ...generated, issuer: parsed.issuer, accountName: parsed.accountName } });
  } catch (error) {
    if (/TOTP|HOTP|2FA|Base32|otpauth/.test(error.message || '')) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.post('/api/query/totp/code', async (req, res, next) => {
  noStore(res);
  const ip = extractClientIp(req);
  const limit = rateLimit(`query-totp-code:${ip}`, 60, 10 * 60 * 1000);
  if (!limit.allowed) return res.status(429).json({ error: '2FA 动态码刷新过于频繁，请稍后再试' });
  try {
    const token = String(req.body.token || '').trim();
    const alias = await findPublicAlias(token);
    if (!alias) return res.status(401).json({ error: '查询密钥无效或已失效' });
    res.json({ totp: aliasTotpResponse(alias) });
  } catch (error) { next(error); }
});

app.post('/api/admin/login', adminNetwork, async (req, res, next) => {
  noStore(res);
  const ip = extractClientIp(req);
  const limit = rateLimit(`login:${ip}`, loginLimit, 15 * 60 * 1000);
  if (!limit.allowed) return res.status(429).json({ error: '登录尝试过多，请稍后再试' });
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      await audit({ actor: email || 'unknown', action: 'login_failed', ip });
      return res.status(401).json({ error: '邮箱或密码不正确' });
    }
    if (user.totp_secret_encrypted) {
      const challenge = randomToken(24);
      await pool.query(
        `INSERT INTO login_challenges(id_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
        [digest(challenge), user.id]
      );
      return res.json({ requiresTotp: true, challenge });
    }
    await createSession(user.id, res);
    await audit({ actor: `user:${user.id}`, action: 'login_success', ip });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/admin/login/totp', adminNetwork, async (req, res, next) => {
  noStore(res);
  try {
    const challenge = String(req.body.challenge || '');
    const code = String(req.body.code || '').replace(/\s/g, '');
    const result = await pool.query(
      `SELECT c.user_id, u.totp_secret_encrypted FROM login_challenges c
       JOIN users u ON u.id = c.user_id
       WHERE c.id_hash = $1 AND c.expires_at > NOW()`,
      [digest(challenge)]
    );
    if (!result.rowCount || !authenticator.check(code, decrypt(result.rows[0].totp_secret_encrypted))) {
      return res.status(401).json({ error: '动态验证码不正确' });
    }
    await pool.query('DELETE FROM login_challenges WHERE id_hash = $1', [digest(challenge)]);
    await createSession(result.rows[0].user_id, res);
    await audit({ actor: `user:${result.rows[0].user_id}`, action: 'login_totp_success', ip: extractClientIp(req) });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/admin/state', ...adminApi(async (req, res) => {
  noStore(res);
  const [accounts, aliases, recent, unmatched, auditResult] = await Promise.all([
    pool.query(`SELECT id, email, host, port, secure, enabled, status, last_error, last_synced_at, created_at FROM mail_accounts ORDER BY id`),
    pool.query(`SELECT a.id, a.mail_account_id, a.address, a.label, a.enabled, a.token_hint, a.token_expires_at, a.created_at,
      (a.totp_secret_encrypted IS NOT NULL) AS totp_enabled, a.totp_issuer, a.totp_account_name,
      (SELECT received_at FROM verification_messages v WHERE v.alias_id = a.id ORDER BY received_at DESC LIMIT 1) AS last_received_at
      FROM aliases a ORDER BY a.id DESC`),
    pool.query(`SELECT v.id, v.alias_id, a.address, v.sender, v.subject, v.code_masked, v.confidence, v.received_at, v.expires_at
      FROM verification_messages v LEFT JOIN aliases a ON a.id = v.alias_id ORDER BY v.received_at DESC LIMIT 50`),
    pool.query(`SELECT id, sender, subject, recipient_headers, received_at FROM unmatched_messages ORDER BY received_at DESC LIMIT 30`),
    pool.query(`SELECT actor, action, target, detail, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 50`)
  ]);
  res.json({
    csrfToken: req.admin.csrf_token,
    admin: { email: req.admin.email, totpEnabled: Boolean(req.admin.totp_secret_encrypted) },
    accounts: accounts.rows,
    aliases: aliases.rows,
    recent: recent.rows,
    unmatched: unmatched.rows,
    audit: auditResult.rows
  });
}));

app.post('/api/admin/mail-account', ...adminApi(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const appPassword = String(req.body.appPassword || '').trim();
  const host = String(req.body.host || 'imap.mail.me.com').trim();
  const imapPort = Number(req.body.port || 993);
  if (!validEmail(email) || appPassword.length < 8 || !host || imapPort < 1 || imapPort > 65535) {
    return res.status(400).json({ error: '请填写有效的邮箱和 IMAP 配置' });
  }
  await testImap({ email, password: appPassword, host, port: imapPort, secure: true });
  const result = await pool.query(
    `INSERT INTO mail_accounts(email, app_password_encrypted, host, port, secure, status, last_error)
     VALUES ($1, $2, $3, $4, TRUE, 'connected', NULL)
     ON CONFLICT (email) DO UPDATE SET app_password_encrypted = EXCLUDED.app_password_encrypted,
       host = EXCLUDED.host, port = EXCLUDED.port, secure = TRUE, enabled = TRUE,
       status = 'connected', last_error = NULL, updated_at = NOW()
     RETURNING id, email`,
    [email, encrypt(appPassword), host, imapPort]
  );
  await audit({ actor: `user:${req.admin.id}`, action: 'mail_account_saved', target: email, ip: extractClientIp(req) });
  res.json({ ok: true, account: result.rows[0] });
}));

app.post('/api/admin/mail-account/:id/toggle', ...adminApi(async (req, res) => {
  const result = await pool.query('UPDATE mail_accounts SET enabled = NOT enabled, updated_at = NOW() WHERE id = $1 RETURNING email, enabled', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: '母邮箱不存在' });
  await audit({ actor: `user:${req.admin.id}`, action: 'mail_account_toggled', target: result.rows[0].email, ip: extractClientIp(req) });
  res.json({ ok: true });
}));

app.delete('/api/admin/mail-account/:id', ...adminApi(async (req, res) => {
  const result = await pool.query('DELETE FROM mail_accounts WHERE id = $1 RETURNING email', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: '母邮箱不存在' });
  await audit({ actor: `user:${req.admin.id}`, action: 'mail_account_deleted', target: result.rows[0].email, ip: extractClientIp(req) });
  res.json({ ok: true });
}));

app.post('/api/admin/aliases', ...adminApi(async (req, res) => {
  const address = normalizeEmail(req.body.address);
  const label = String(req.body.label || '').trim().slice(0, 80);
  const accountId = Number(req.body.mailAccountId);
  const expiresDays = req.body.expiresDays ? Math.max(1, Math.min(3650, Number(req.body.expiresDays))) : null;
  if (!validEmail(address) || !accountId) return res.status(400).json({ error: '请填写有效的子邮箱' });
  const token = `cv_${randomToken(24)}`;
  const result = await pool.query(
    `INSERT INTO aliases(mail_account_id, address, label, token_digest, token_hint, token_expires_at)
     VALUES ($1, $2, $3, $4, $5,
       CASE WHEN $6::int IS NULL THEN NULL ELSE NOW() + ($6::text || ' days')::interval END)
     RETURNING id, address`,
    [accountId, address, label, digest(token), token.slice(-6), expiresDays]
  );
  await audit({ actor: `user:${req.admin.id}`, action: 'alias_created', target: address, ip: extractClientIp(req) });
  res.status(201).json({ ok: true, alias: result.rows[0], token });
}));

app.post('/api/admin/aliases/:id/regenerate', ...adminApi(async (req, res) => {
  const token = `cv_${randomToken(24)}`;
  const result = await pool.query(
    `UPDATE aliases SET token_digest = $1, token_hint = $2, enabled = TRUE, updated_at = NOW()
     WHERE id = $3 RETURNING address`,
    [digest(token), token.slice(-6), req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: '子邮箱不存在' });
  await audit({ actor: `user:${req.admin.id}`, action: 'alias_token_regenerated', target: result.rows[0].address, ip: extractClientIp(req) });
  res.json({ ok: true, token });
}));

app.post('/api/admin/aliases/:id/toggle', ...adminApi(async (req, res) => {
  const result = await pool.query('UPDATE aliases SET enabled = NOT enabled, updated_at = NOW() WHERE id = $1 RETURNING address, enabled', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: '子邮箱不存在' });
  await audit({ actor: `user:${req.admin.id}`, action: 'alias_toggled', target: result.rows[0].address, ip: extractClientIp(req) });
  res.json({ ok: true });
}));

app.put('/api/admin/aliases/:id/totp', ...adminApi(async (req, res) => {
  let parsed;
  try {
    parsed = parseTotpInput(req.body.secret);
    generateTotp(parsed.secret);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const result = await pool.query(
    `UPDATE aliases SET totp_secret_encrypted = $1, totp_issuer = $2,
     totp_account_name = $3, updated_at = NOW() WHERE id = $4 RETURNING address`,
    [encrypt(parsed.secret), parsed.issuer, parsed.accountName, req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: '子邮箱不存在' });
  await audit({ actor: `user:${req.admin.id}`, action: 'alias_totp_saved', target: result.rows[0].address, ip: extractClientIp(req) });
  res.json({ ok: true });
}));

app.delete('/api/admin/aliases/:id/totp', ...adminApi(async (req, res) => {
  const result = await pool.query(
    `UPDATE aliases SET totp_secret_encrypted = NULL, totp_issuer = '',
     totp_account_name = '', updated_at = NOW() WHERE id = $1 RETURNING address`,
    [req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ error: '子邮箱不存在' });
  await audit({ actor: `user:${req.admin.id}`, action: 'alias_totp_deleted', target: result.rows[0].address, ip: extractClientIp(req) });
  res.json({ ok: true });
}));

app.delete('/api/admin/aliases/:id', ...adminApi(async (req, res) => {
  const result = await pool.query('DELETE FROM aliases WHERE id = $1 RETURNING address', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: '子邮箱不存在' });
  await audit({ actor: `user:${req.admin.id}`, action: 'alias_deleted', target: result.rows[0].address, ip: extractClientIp(req) });
  res.json({ ok: true });
}));

app.post('/api/admin/totp/setup', ...adminApi(async (req, res) => {
  if (req.admin.totp_secret_encrypted) return res.status(409).json({ error: 'TOTP 已启用' });
  const secret = authenticator.generateSecret();
  const uri = authenticator.keyuri(req.admin.email, 'iCloud Code Vault', secret);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  res.json({ secret, qrDataUrl });
}));

app.post('/api/admin/totp/enable', ...adminApi(async (req, res) => {
  const secret = String(req.body.secret || '');
  const code = String(req.body.code || '');
  if (!secret || !authenticator.check(code, secret)) return res.status(400).json({ error: '动态验证码不正确' });
  await pool.query('UPDATE users SET totp_secret_encrypted = $1, updated_at = NOW() WHERE id = $2', [encrypt(secret), req.admin.id]);
  await audit({ actor: `user:${req.admin.id}`, action: 'totp_enabled', ip: extractClientIp(req) });
  res.json({ ok: true });
}));

app.post('/api/admin/password', ...adminApi(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: '新密码至少需要 8 个字符' });
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.admin.id]);
  if (!(await verifyPassword(currentPassword, result.rows[0].password_hash))) return res.status(401).json({ error: '当前密码不正确' });
  await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [await hashPassword(newPassword), req.admin.id]);
  await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id_hash <> $2', [req.admin.id, digest(req.sessionToken)]);
  await audit({ actor: `user:${req.admin.id}`, action: 'password_changed', ip: extractClientIp(req) });
  res.json({ ok: true });
}));

app.post('/api/admin/logout', ...adminApi(async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE id_hash = $1', [digest(req.sessionToken)]);
  res.setHeader('Set-Cookie', 'cv_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
}));

app.use((error, req, res, _next) => {
  console.error(error);
  noStore(res);
  const known = /authentication|login|credentials/i.test(error.message || '');
  res.status(known ? 400 : 500).json({ error: known ? 'iCloud IMAP 登录失败，请检查邮箱和 App 专用密码' : '服务器处理失败' });
});

async function start() {
  await initDatabase();
  await ensureAdmin();
  await cleanExpired();
  setInterval(() => cleanExpired().catch(console.error), 60 * 60 * 1000).unref();
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(key);
  }, 10 * 60 * 1000).unref();
  app.listen(port, '0.0.0.0', () => console.log(`Web server listening on port ${port}`));
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
