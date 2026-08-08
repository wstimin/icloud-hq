'use strict';

const mailForm = document.querySelector('#mail-query-form');
const mailTokenInput = document.querySelector('#mail-token');
const mailErrorBox = document.querySelector('#mail-query-error');
const mailResultBox = document.querySelector('#mail-result');
const totpForm = document.querySelector('#totp-query-form');
const totpSecretInput = document.querySelector('#totp-secret');
const totpQrFileInput = document.querySelector('#totp-qr-file');
const totpQrUploadButton = document.querySelector('#totp-qr-upload');
const totpErrorBox = document.querySelector('#totp-query-error');
const totpResultBox = document.querySelector('#totp-result');
const toast = document.querySelector('#toast');
const activeTotps = new Map();
let mailCountdownTimer;
let totpCountdownTimer;
let totpRefreshInFlight = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 1800);
}

async function copyCode(code, message) {
  await navigator.clipboard.writeText(code);
  showToast(message);
}

async function request(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store'
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}

function renderAliasMeta(data) {
  return `<div class="result-meta"><strong>${escapeHtml(data.label || '子邮箱')}</strong><span>${escapeHtml(data.alias)}</span></div>`;
}

function renderMail(data) {
  clearInterval(mailCountdownTimer);
  const message = data.message;
  mailResultBox.classList.remove('hidden');
  mailResultBox.innerHTML = `${renderAliasMeta(data)}${message ? `
    <div class="code-line"><span class="code-value">${escapeHtml(message.code)}</span><button id="copy-mail-code" class="btn btn-secondary btn-icon" title="复制邮箱验证码" aria-label="复制邮箱验证码"><i data-lucide="copy" class="icon"></i></button></div>
    <div class="result-detail"><span>来源：${escapeHtml(message.sender || '未知发件人')}</span><span>主题：${escapeHtml(message.subject || '无主题')}</span><span id="mail-expires"></span></div>` : '<p class="muted result-empty">当前没有有效的邮箱验证码，请稍后重新查询。</p>'}`;
  lucide.createIcons();
  if (!message) return;
  document.querySelector('#copy-mail-code').addEventListener('click', () => copyCode(message.code, '邮箱验证码已复制'));
  const update = () => {
    const seconds = Math.max(0, Math.floor((new Date(message.expiresAt).getTime() - Date.now()) / 1000));
    document.querySelector('#mail-expires').textContent = seconds > 0 ? `剩余有效时间：${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : '验证码已过期';
    if (!seconds) clearInterval(mailCountdownTimer);
  };
  update();
  mailCountdownTimer = setInterval(update, 1000);
}

function totpTitle(item) {
  const names = [item.data.issuer, item.data.accountName].filter(Boolean);
  return names.length ? names.join(' · ') : `2FA 密钥末四位 ${item.data.secretHint}`;
}

function renderTotps() {
  const entries = [...activeTotps.values()];
  totpResultBox.classList.toggle('hidden', !entries.length);
  if (!entries.length) {
    clearInterval(totpCountdownTimer);
    return;
  }
  totpResultBox.innerHTML = `<div class="result-meta"><strong>当前会话中的 2FA</strong><span>${entries.length} 条独立密钥</span></div><div class="totp-entry-list">${entries.map((item) => `
    <section class="totp-entry" data-totp-entry="${item.data.id}">
      <div class="totp-entry-head"><div><h2>${escapeHtml(totpTitle(item))}</h2><p>密钥末四位 ${escapeHtml(item.data.secretHint)}</p></div><button class="btn btn-danger btn-icon" type="button" data-remove-totp="${item.data.id}" title="从当前页面移除" aria-label="从当前页面移除"><i data-lucide="x" class="icon"></i></button></div>
      <div class="code-line"><span class="code-value">${escapeHtml(item.data.code)}</span><button class="btn btn-secondary btn-icon" type="button" data-copy-totp="${item.data.id}" title="复制 2FA 验证码" aria-label="复制 2FA 验证码"><i data-lucide="copy" class="icon"></i></button></div>
      <div class="result-detail"><span data-totp-remaining="${item.data.id}">${item.data.remaining} 秒后自动刷新</span></div>
    </section>`).join('')}</div>`;
  document.querySelectorAll('[data-copy-totp]').forEach((button) => button.addEventListener('click', () => {
    copyCode(activeTotps.get(button.dataset.copyTotp).data.code, '2FA 验证码已复制');
  }));
  document.querySelectorAll('[data-remove-totp]').forEach((button) => button.addEventListener('click', () => {
    activeTotps.delete(button.dataset.removeTotp);
    renderTotps();
  }));
  lucide.createIcons();
  startTotpCountdown();
}

function startTotpCountdown() {
  clearInterval(totpCountdownTimer);
  const update = () => {
    let shouldRefresh = false;
    for (const item of activeTotps.values()) {
      const elapsed = Math.floor((Date.now() - item.receivedAt) / 1000);
      const remaining = Math.max(0, item.data.remaining - elapsed);
      const label = document.querySelector(`[data-totp-remaining="${item.data.id}"]`);
      if (label) label.textContent = remaining ? `${remaining} 秒后自动刷新` : '正在生成最新动态码';
      if (!remaining) shouldRefresh = true;
    }
    if (shouldRefresh) refreshTotps();
  };
  update();
  totpCountdownTimer = setInterval(update, 1000);
}

async function convertTotps(entries) {
  return request('/api/query/totp', { entries });
}

async function detectQrCode(file) {
  if (!('BarcodeDetector' in window)) throw new Error('当前浏览器不支持本地二维码识别，请直接粘贴原始密钥或 otpauth 地址');
  const supported = await BarcodeDetector.getSupportedFormats();
  if (!supported.includes('qr_code')) throw new Error('当前浏览器未启用二维码识别，请直接粘贴原始密钥');
  const bitmap = await createImageBitmap(file);
  try {
    const codes = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap);
    const value = codes[0]?.rawValue || '';
    if (!value.toLowerCase().startsWith('otpauth://totp/')) throw new Error('图片中没有识别到标准 TOTP 二维码');
    return value;
  } finally {
    bitmap.close();
  }
}

async function refreshTotps() {
  if (totpRefreshInFlight || !activeTotps.size) return;
  totpRefreshInFlight = true;
  try {
    const current = [...activeTotps.values()];
    const response = await convertTotps(current.map((item) => ({ secret: item.secret })));
    for (const data of response.totps) {
      const existing = current.find((item) => item.data.id === data.id);
      if (existing) activeTotps.set(String(data.id), { secret: existing.secret, data, receivedAt: Date.now() });
    }
    renderTotps();
  } catch (error) {
    clearInterval(totpCountdownTimer);
    totpErrorBox.textContent = error.message;
  } finally {
    totpRefreshInFlight = false;
  }
}

document.querySelectorAll('[data-query-tab]').forEach((button) => button.addEventListener('click', () => {
  const selected = button.dataset.queryTab;
  document.querySelectorAll('[data-query-tab]').forEach((tab) => {
    const active = tab === button;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.query-panel').forEach((panel) => {
    const active = panel.id === `${selected}-panel`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}));

totpQrUploadButton.addEventListener('click', () => totpQrFileInput.click());
totpQrFileInput.addEventListener('change', async () => {
  const file = totpQrFileInput.files[0];
  if (!file) return;
  totpErrorBox.textContent = '';
  totpQrUploadButton.disabled = true;
  try {
    totpSecretInput.value = await detectQrCode(file);
    showToast('二维码已识别，请确认后转换');
    totpSecretInput.focus();
  } catch (error) {
    totpErrorBox.textContent = error.message;
  } finally {
    totpQrUploadButton.disabled = false;
    totpQrFileInput.value = '';
  }
});

mailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  mailErrorBox.textContent = '';
  mailResultBox.classList.add('hidden');
  const button = mailForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    renderMail(await request('/api/query', { token: mailTokenInput.value.trim() }));
  } catch (error) {
    mailErrorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

totpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  totpErrorBox.textContent = '';
  const button = totpForm.querySelector('[type="submit"]');
  const secret = totpSecretInput.value.trim();
  button.disabled = true;
  try {
    const response = await convertTotps([{ secret, issuer: document.querySelector('#totp-issuer').value, accountName: document.querySelector('#totp-account-name').value }]);
    const data = response.totps[0];
    activeTotps.set(String(data.id), { secret, data, receivedAt: Date.now() });
    totpForm.reset();
    renderTotps();
    showToast('2FA 已转换并同步到管理后台');
  } catch (error) {
    totpErrorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

lucide.createIcons();
