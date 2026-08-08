'use strict';

const { authenticator } = require('otplib');

const TOTP_PERIOD = 30;

function normalizeSecret(value) {
  const secret = String(value || '').trim().replace(/[\s-]+/g, '').toUpperCase();
  const unpadded = secret.replace(/=+$/, '');
  if (unpadded.length < 8 || !/^[A-Z2-7]+$/.test(unpadded)) {
    throw new Error('2FA 密钥不是有效的 Base32 格式');
  }
  return unpadded;
}

function decodeLabel(pathname) {
  try {
    return decodeURIComponent(String(pathname || '').replace(/^\/+/, ''));
  } catch {
    throw new Error('otpauth 地址中的账户名称格式无效');
  }
}

function parseTotpInput(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('请输入 2FA 手动密钥或 otpauth 地址');
  if (input.length > 4096) throw new Error('2FA 密钥或 otpauth 地址过长');

  if (!/^otpauth:\/\//i.test(input)) {
    return { secret: normalizeSecret(input), issuer: '', accountName: '' };
  }

  let uri;
  try {
    uri = new URL(input);
  } catch {
    throw new Error('otpauth 地址格式无效');
  }
  if (uri.protocol !== 'otpauth:' || uri.hostname.toLowerCase() !== 'totp') {
    throw new Error('仅支持 TOTP，不支持 HOTP');
  }

  const algorithm = String(uri.searchParams.get('algorithm') || 'SHA1').toUpperCase();
  const digits = Number(uri.searchParams.get('digits') || 6);
  const period = Number(uri.searchParams.get('period') || TOTP_PERIOD);
  if (algorithm !== 'SHA1' || digits !== 6 || period !== TOTP_PERIOD) {
    throw new Error('仅支持 SHA1、6 位、30 秒周期的标准 TOTP');
  }

  const label = decodeLabel(uri.pathname);
  const separator = label.indexOf(':');
  const labelIssuer = separator >= 0 ? label.slice(0, separator).trim() : '';
  const accountName = (separator >= 0 ? label.slice(separator + 1) : label).trim().slice(0, 160);
  const issuer = String(uri.searchParams.get('issuer') || labelIssuer).trim().slice(0, 120);

  return {
    secret: normalizeSecret(uri.searchParams.get('secret')),
    issuer,
    accountName
  };
}

function generateTotp(secret, nowMs = Date.now()) {
  const instance = authenticator.clone();
  instance.options = { epoch: nowMs, step: TOTP_PERIOD, digits: 6, algorithm: 'sha1' };
  const code = instance.generate(normalizeSecret(secret));
  const elapsed = Math.floor(nowMs / 1000) % TOTP_PERIOD;
  return {
    code,
    period: TOTP_PERIOD,
    remaining: TOTP_PERIOD - elapsed,
    generatedAt: new Date(nowMs).toISOString()
  };
}

module.exports = { TOTP_PERIOD, normalizeSecret, parseTotpInput, generateTotp };
