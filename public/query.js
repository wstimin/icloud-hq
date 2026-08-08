'use strict';

const mailForm = document.querySelector('#mail-query-form');
const mailTokenInput = document.querySelector('#mail-token');
const mailErrorBox = document.querySelector('#mail-query-error');
const mailResultBox = document.querySelector('#mail-result');
const totpForm = document.querySelector('#totp-query-form');
const totpTokenInput = document.querySelector('#totp-token');
const totpErrorBox = document.querySelector('#totp-query-error');
const totpResultBox = document.querySelector('#totp-result');
const toast = document.querySelector('#toast');
let mailCountdownTimer;
let totpCountdownTimer;
let totpRefreshInFlight = false;
let totpDeadline = 0;
let currentTotp = null;

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

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...(options.body || {}) }),
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

function renderTotp(data) {
  clearInterval(totpCountdownTimer);
  currentTotp = data.totp;
  totpResultBox.classList.remove('hidden');
  totpResultBox.innerHTML = `${renderAliasMeta(data)}${data.totp ? `
    <div class="code-line"><span id="totp-code-value" class="code-value">${escapeHtml(data.totp.code)}</span><button id="copy-totp-code" class="btn btn-secondary btn-icon" title="复制 2FA 验证码" aria-label="复制 2FA 验证码"><i data-lucide="copy" class="icon"></i></button></div>
    <div class="result-detail"><span>${escapeHtml(data.totp.issuer || '第三方平台')}${data.totp.accountName ? ` · ${escapeHtml(data.totp.accountName)}` : ''}</span><span id="totp-expires"></span></div>` : '<p class="muted result-empty">这个子邮箱尚未绑定第三方平台 2FA。</p>'}
    <section class="totp-manage">
      <button id="toggle-totp-form" class="btn btn-secondary" type="button"><i data-lucide="shield-keyhole" class="icon"></i><span>${data.totp ? '更换 2FA' : '绑定 2FA'}</span></button>
      <form id="public-totp-form" class="totp-form hidden">
        <div class="field"><label for="public-totp-secret">2FA 手动密钥或 otpauth 地址</label><textarea id="public-totp-secret" rows="4" maxlength="4096" required autocomplete="off" spellcheck="false" placeholder="JBSWY3DPEHPK3PXP 或 otpauth://totp/..."></textarea></div>
        <p class="muted compact-note">保存后不会再次显示原始密钥。${data.totp ? '本次操作会覆盖前后台当前使用的 2FA。' : '绑定后管理后台会同步显示。'}</p>
        <p id="totp-form-error" class="message" role="alert"></p>
        <div class="form-actions"><button class="btn btn-primary" type="submit"><i data-lucide="save" class="icon"></i><span>保存 2FA</span></button></div>
      </form>
    </section>`;
  lucide.createIcons();
  if (data.totp) document.querySelector('#copy-totp-code').addEventListener('click', () => copyCode(currentTotp.code, '2FA 验证码已复制'));
  document.querySelector('#toggle-totp-form').addEventListener('click', () => document.querySelector('#public-totp-form').classList.toggle('hidden'));
  document.querySelector('#public-totp-form').addEventListener('submit', saveTotp);
  if (!data.totp) return;
  totpDeadline = Date.now() + (data.totp.remaining * 1000);
  const update = () => {
    const seconds = Math.max(0, Math.ceil((totpDeadline - Date.now()) / 1000));
    document.querySelector('#totp-expires').textContent = seconds > 0 ? `${seconds} 秒后自动刷新` : '正在同步最新动态码';
    if (!seconds) refreshTotp();
  };
  update();
  totpCountdownTimer = setInterval(update, 1000);
}

async function queryTotp() {
  return request('/api/query/totp', totpTokenInput.value.trim());
}

async function refreshTotp() {
  if (totpRefreshInFlight) return;
  totpRefreshInFlight = true;
  try {
    renderTotp(await queryTotp());
  } catch (error) {
    clearInterval(totpCountdownTimer);
    totpErrorBox.textContent = error.message;
  } finally {
    totpRefreshInFlight = false;
  }
}

async function saveTotp(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const errorBox = document.querySelector('#totp-form-error');
  const replacing = Boolean(currentTotp);
  button.disabled = true;
  errorBox.textContent = '';
  try {
    const data = await request('/api/query/totp', totpTokenInput.value.trim(), {
      method: 'PUT',
      body: { secret: document.querySelector('#public-totp-secret').value.trim() }
    });
    showToast(replacing ? '2FA 已更换，后台已同步' : '2FA 已绑定，后台已同步');
    renderTotp(data);
  } catch (error) {
    errorBox.textContent = error.message;
    button.disabled = false;
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

mailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  mailErrorBox.textContent = '';
  mailResultBox.classList.add('hidden');
  const button = mailForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    renderMail(await request('/api/query', mailTokenInput.value.trim()));
  } catch (error) {
    mailErrorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

totpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  totpErrorBox.textContent = '';
  totpResultBox.classList.add('hidden');
  const button = totpForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    renderTotp(await queryTotp());
  } catch (error) {
    totpErrorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

lucide.createIcons();
