'use strict';

const form = document.querySelector('#query-form');
const tokenInput = document.querySelector('#token');
const errorBox = document.querySelector('#query-error');
const resultBox = document.querySelector('#result');
const toast = document.querySelector('#toast');
let countdownTimer;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 1800);
}

function render(data) {
  clearInterval(countdownTimer);
  resultBox.classList.remove('hidden');
  if (!data.message) {
    resultBox.innerHTML = `<div class="result-meta"><strong>${escapeHtml(data.label || data.alias)}</strong><span>${escapeHtml(data.alias)}</span></div><p class="muted">当前没有有效验证码，请稍后刷新。</p>`;
    return;
  }
  const message = data.message;
  resultBox.innerHTML = `
    <div class="result-meta"><strong>${escapeHtml(data.label || '邮箱验证码')}</strong><span>${escapeHtml(data.alias)}</span></div>
    <div class="code-line"><span id="code-value" class="code-value">${escapeHtml(message.code)}</span><button id="copy-code" class="btn btn-secondary btn-icon" title="复制验证码" aria-label="复制验证码"><i data-lucide="copy" class="icon"></i></button></div>
    <div class="result-detail"><span>来源：${escapeHtml(message.sender || '未知发件人')}</span><span>主题：${escapeHtml(message.subject || '无主题')}</span><span id="expires"></span></div>`;
  lucide.createIcons();
  document.querySelector('#copy-code').addEventListener('click', async () => {
    await navigator.clipboard.writeText(message.code);
    showToast('验证码已复制');
  });
  const update = () => {
    const seconds = Math.max(0, Math.floor((new Date(message.expiresAt).getTime() - Date.now()) / 1000));
    document.querySelector('#expires').textContent = seconds > 0 ? `剩余有效时间：${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : '验证码已过期';
    if (!seconds) clearInterval(countdownTimer);
  };
  update();
  countdownTimer = setInterval(update, 1000);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  resultBox.classList.add('hidden');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenInput.value.trim() }),
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '查询失败');
    render(data);
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

lucide.createIcons();
