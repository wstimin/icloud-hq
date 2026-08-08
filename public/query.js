'use strict';

const form = document.querySelector('#query-form');
const tokenInput = document.querySelector('#token');
const errorBox = document.querySelector('#query-error');
const resultBox = document.querySelector('#result');
const toast = document.querySelector('#toast');
let countdownTimer;
let currentData = null;
let refreshInFlight = false;
let totpDeadline = 0;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 1800);
}

function codeBlock({ title, code, codeId, copyId, detail, emptyText }) {
  return `<section class="code-section">
    <div class="code-section-head"><h2>${escapeHtml(title)}</h2></div>
    ${code ? `<div class="code-line"><span id="${codeId}" class="code-value">${escapeHtml(code)}</span><button id="${copyId}" class="btn btn-secondary btn-icon" title="复制${escapeHtml(title)}" aria-label="复制${escapeHtml(title)}"><i data-lucide="copy" class="icon"></i></button></div>${detail}` : `<p class="muted">${escapeHtml(emptyText)}</p>`}
  </section>`;
}

function render(data) {
  clearInterval(countdownTimer);
  currentData = data;
  resultBox.classList.remove('hidden');
  const message = data.message;
  const totp = data.totp;
  resultBox.innerHTML = `
    <div class="result-meta"><strong>${escapeHtml(data.label || '验证码')}</strong><span>${escapeHtml(data.alias)}</span></div>
    ${codeBlock({
      title: '邮箱验证码',
      code: message?.code,
      codeId: 'mail-code-value',
      copyId: 'copy-mail-code',
      detail: message ? `<div class="result-detail"><span>来源：${escapeHtml(message.sender || '未知发件人')}</span><span>主题：${escapeHtml(message.subject || '无主题')}</span><span id="mail-expires"></span></div>` : '',
      emptyText: '当前没有有效的邮箱验证码，请稍后刷新。'
    })}
    ${codeBlock({
      title: '2FA 动态码',
      code: totp?.code,
      codeId: 'totp-code-value',
      copyId: 'copy-totp-code',
      detail: totp ? `<div class="result-detail"><span>${escapeHtml(totp.issuer || '第三方平台')}${totp.accountName ? ` · ${escapeHtml(totp.accountName)}` : ''}</span><span id="totp-expires"></span></div>` : '',
      emptyText: '这个子邮箱尚未绑定第三方平台 2FA。'
    })}
    <section class="totp-manage">
      <button id="toggle-totp-form" class="btn btn-secondary" type="button"><i data-lucide="shield-keyhole" class="icon"></i><span>${totp ? '更换 2FA' : '绑定 2FA'}</span></button>
      <form id="public-totp-form" class="totp-form hidden">
        <div class="field"><label for="public-totp-secret">2FA 手动密钥或 otpauth 地址</label><textarea id="public-totp-secret" rows="4" maxlength="4096" required autocomplete="off" spellcheck="false" placeholder="JBSWY3DPEHPK3PXP 或 otpauth://totp/..."></textarea></div>
        <p class="muted compact-note">保存后不会再次显示原始密钥。${totp ? '本次操作会覆盖当前 2FA。' : ''}</p>
        <p id="totp-form-error" class="message" role="alert"></p>
        <div class="form-actions"><button class="btn btn-primary" type="submit"><i data-lucide="save" class="icon"></i><span>保存 2FA</span></button></div>
      </form>
    </section>`;
  lucide.createIcons();

  if (message) document.querySelector('#copy-mail-code').addEventListener('click', () => copyCode(message.code, '邮箱验证码已复制'));
  if (totp) document.querySelector('#copy-totp-code').addEventListener('click', () => copyCode(currentData.totp.code, '2FA 动态码已复制'));
  document.querySelector('#toggle-totp-form').addEventListener('click', () => document.querySelector('#public-totp-form').classList.toggle('hidden'));
  document.querySelector('#public-totp-form').addEventListener('submit', saveTotp);

  totpDeadline = totp ? Date.now() + (totp.remaining * 1000) : 0;
  const update = () => {
    if (message) {
      const seconds = Math.max(0, Math.floor((new Date(message.expiresAt).getTime() - Date.now()) / 1000));
      document.querySelector('#mail-expires').textContent = seconds > 0 ? `剩余有效时间：${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : '验证码已过期';
    }
    if (totp) {
      const seconds = Math.max(0, Math.ceil((totpDeadline - Date.now()) / 1000));
      document.querySelector('#totp-expires').textContent = seconds > 0 ? `${seconds} 秒后自动刷新` : '正在刷新动态码';
      if (!seconds) refreshTotpCode();
    }
  };
  update();
  countdownTimer = setInterval(update, 1000);
}

async function copyCode(code, message) {
  await navigator.clipboard.writeText(code);
  showToast(message);
}

async function requestQuery() {
  const response = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: tokenInput.value.trim() }),
    cache: 'no-store'
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '查询失败');
  return data;
}

async function refreshQuery() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    render(await requestQuery());
  } catch (error) {
    clearInterval(countdownTimer);
    errorBox.textContent = error.message;
  } finally {
    refreshInFlight = false;
  }
}

async function refreshTotpCode() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const response = await fetch('/api/query/totp/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenInput.value.trim() }),
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '2FA 动态码刷新失败');
    if (!data.totp || !currentData?.totp) return render(await requestQuery());
    currentData.totp = data.totp;
    document.querySelector('#totp-code-value').textContent = data.totp.code;
    totpDeadline = Date.now() + (data.totp.remaining * 1000);
  } catch (error) {
    clearInterval(countdownTimer);
    errorBox.textContent = error.message;
  } finally {
    refreshInFlight = false;
  }
}

async function saveTotp(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const error = document.querySelector('#totp-form-error');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/api/query/totp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenInput.value.trim(), secret: document.querySelector('#public-totp-secret').value.trim() }),
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '2FA 保存失败');
    showToast(currentData?.totp ? '2FA 已更换' : '2FA 已绑定');
    await refreshQuery();
  } catch (saveError) {
    error.textContent = saveError.message;
    button.disabled = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  resultBox.classList.add('hidden');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    render(await requestQuery());
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

lucide.createIcons();
