'use strict';

const state = { data: null, csrfToken: '' };
const modalRoot = document.querySelector('#modal-root');
const toast = document.querySelector('#toast');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '暂无';
}

function toastMessage(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2200);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(url, { ...options, headers, cache: 'no-store' });
  if (response.status === 401) {
    location.replace('/admin/login');
    throw new Error('登录已失效');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}

function empty(text) { return `<div class="empty">${escapeHtml(text)}</div>`; }

function table(headers, rows) {
  if (!rows.length) return empty('暂无记录');
  return `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function badge(status, enabled = true) {
  if (!enabled) return '<span class="badge off">已停用</span>';
  if (status === 'error') return '<span class="badge error">连接异常</span>';
  if (status === 'connected') return '<span class="badge">已连接</span>';
  return '<span class="badge off">等待同步</span>';
}

function render() {
  const data = state.data;
  document.querySelector('#admin-email').textContent = data.admin.email;
  const today = data.recent.filter((row) => new Date(row.received_at).toDateString() === new Date().toDateString()).length;
  const connected = data.accounts.filter((row) => row.enabled && row.status === 'connected').length;
  document.querySelector('#stats').innerHTML = [
    ['inbox', '在线母邮箱', `${connected}/${data.accounts.length}`],
    ['at-sign', '启用子邮箱', data.aliases.filter((row) => row.enabled).length],
    ['badge-check', '今日验证码', today],
    ['scan-search', '未匹配邮件', data.unmatched.length]
  ].map(([icon, label, value]) => `<div class="stat"><div class="stat-label"><i data-lucide="${icon}" class="icon"></i>${label}</div><div class="stat-value">${value}</div></div>`).join('');

  const recentRows = data.recent.slice(0, 10).map((row) => `<tr><td>${escapeHtml(row.address || '未匹配')}</td><td>${escapeHtml(row.sender)}</td><td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.code_masked || '未提取')}</td><td>${formatDate(row.received_at)}</td></tr>`);
  document.querySelector('#overview-recent').innerHTML = table(['子邮箱', '发件人', '主题', '验证码', '收到时间'], recentRows);
  document.querySelector('#messages-table').innerHTML = table(['子邮箱', '发件人', '主题', '验证码', '置信度', '过期时间'], data.recent.map((row) => `<tr><td>${escapeHtml(row.address)}</td><td>${escapeHtml(row.sender)}</td><td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.code_masked || '未提取')}</td><td>${row.confidence}%</td><td>${formatDate(row.expires_at)}</td></tr>`));
  document.querySelector('#unmatched-table').innerHTML = table(['发件人', '主题', '收件信息', '收到时间'], data.unmatched.map((row) => `<tr><td>${escapeHtml(row.sender)}</td><td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.recipient_headers.slice(0, 120))}</td><td>${formatDate(row.received_at)}</td></tr>`));
  document.querySelector('#audit-table').innerHTML = table(['操作者', '动作', '目标', '时间'], data.audit.slice(0, 12).map((row) => `<tr><td>${escapeHtml(row.actor)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.target || row.detail)}</td><td>${formatDate(row.created_at)}</td></tr>`));

  document.querySelector('#accounts-table').innerHTML = table(['邮箱', 'IMAP', '状态', '最后同步', '操作'], data.accounts.map((row) => `<tr><td><strong>${escapeHtml(row.email)}</strong>${row.last_error ? `<br><small class="danger-text">${escapeHtml(row.last_error)}</small>` : ''}</td><td>${escapeHtml(row.host)}:${row.port}</td><td>${badge(row.status, row.enabled)}</td><td>${formatDate(row.last_synced_at)}</td><td><div class="actions"><button class="btn btn-secondary" data-account-toggle="${row.id}">${row.enabled ? '暂停' : '启用'}</button><button class="btn btn-danger btn-icon" title="删除" aria-label="删除" data-account-delete="${row.id}"><i data-lucide="trash-2" class="icon"></i></button></div></td></tr>`));
  document.querySelector('#aliases-table').innerHTML = table(['子邮箱', '备注', '密钥提示', '2FA', '状态', '最近收信', '操作'], data.aliases.map((row) => `<tr><td><strong>${escapeHtml(row.address)}</strong></td><td>${escapeHtml(row.label || '-')}</td><td>末六位 ${escapeHtml(row.token_hint || '-')}</td><td>${row.totp_enabled ? `<span class="badge">已绑定</span>${row.totp_issuer ? `<br><small class="muted">${escapeHtml(row.totp_issuer)}</small>` : ''}` : '<span class="badge off">未绑定</span>'}</td><td>${row.enabled ? '<span class="badge">已启用</span>' : '<span class="badge off">已停用</span>'}</td><td>${formatDate(row.last_received_at)}</td><td><div class="actions"><button class="btn btn-secondary" data-alias-totp="${row.id}">${row.totp_enabled ? '更换 2FA' : '绑定 2FA'}</button>${row.totp_enabled ? `<button class="btn btn-danger btn-icon" title="删除 2FA" aria-label="删除 2FA" data-alias-totp-delete="${row.id}"><i data-lucide="shield-x" class="icon"></i></button>` : ''}<button class="btn btn-secondary" data-alias-reset="${row.id}">重置密钥</button><button class="btn btn-secondary" data-alias-toggle="${row.id}">${row.enabled ? '停用' : '启用'}</button><button class="btn btn-danger btn-icon" title="删除子邮箱" aria-label="删除子邮箱" data-alias-delete="${row.id}"><i data-lucide="trash-2" class="icon"></i></button></div></td></tr>`));

  document.querySelector('#totp-status').textContent = data.admin.totpEnabled ? 'TOTP 动态验证码已启用。' : 'TOTP 尚未启用，管理员登录目前只使用密码。';
  document.querySelector('#setup-totp').classList.toggle('hidden', data.admin.totpEnabled);
  bindRowActions();
  lucide.createIcons();
}

async function loadState() {
  state.data = await api('/api/admin/state');
  state.csrfToken = state.data.csrfToken;
  render();
}

function openModal(title, body) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal"><header class="modal-head"><h2>${escapeHtml(title)}</h2><button class="btn btn-secondary btn-icon" data-close title="关闭" aria-label="关闭"><i data-lucide="x" class="icon"></i></button></header><div class="modal-body">${body}</div></section></div>`;
  modalRoot.querySelector('[data-close]').addEventListener('click', closeModal);
  lucide.createIcons();
}
function closeModal() { modalRoot.innerHTML = ''; }

function showSecret(token) {
  openModal('查询密钥已生成', `<p>此密钥只展示一次。请现在交给对应查询者，后台不会保存可恢复的明文。</p><div id="generated-token" class="secret-box">${escapeHtml(token)}</div><div class="form-actions"><button id="copy-secret" class="btn btn-primary"><i data-lucide="copy" class="icon"></i><span>复制密钥</span></button></div>`);
  document.querySelector('#copy-secret').addEventListener('click', async () => {
    await navigator.clipboard.writeText(token);
    toastMessage('查询密钥已复制');
  });
  lucide.createIcons();
}

function bindRowActions() {
  document.querySelectorAll('[data-account-toggle]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/admin/mail-account/${button.dataset.accountToggle}/toggle`, { method: 'POST' }); await loadState();
  }));
  document.querySelectorAll('[data-account-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('删除母邮箱会同时删除其子邮箱和验证码记录。确认继续？')) return;
    await api(`/api/admin/mail-account/${button.dataset.accountDelete}`, { method: 'DELETE' }); await loadState();
  }));
  document.querySelectorAll('[data-alias-reset]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('旧查询密钥会立即失效，确认重置？')) return;
    const data = await api(`/api/admin/aliases/${button.dataset.aliasReset}/regenerate`, { method: 'POST' }); await loadState(); showSecret(data.token);
  }));
  document.querySelectorAll('[data-alias-totp]').forEach((button) => button.addEventListener('click', () => {
    const alias = state.data.aliases.find((row) => String(row.id) === button.dataset.aliasTotp);
    openAliasTotp(alias);
  }));
  document.querySelectorAll('[data-alias-totp-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('删除后前台将不再显示该子邮箱的 2FA 动态码。确认继续？')) return;
    await api(`/api/admin/aliases/${button.dataset.aliasTotpDelete}/totp`, { method: 'DELETE' });
    await loadState();
    toastMessage('子邮箱 2FA 已删除');
  }));
  document.querySelectorAll('[data-alias-toggle]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/admin/aliases/${button.dataset.aliasToggle}/toggle`, { method: 'POST' }); await loadState();
  }));
  document.querySelectorAll('[data-alias-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('删除后，该子邮箱的验证码记录也会删除。确认继续？')) return;
    await api(`/api/admin/aliases/${button.dataset.aliasDelete}`, { method: 'DELETE' }); await loadState();
  }));
}

function openAliasTotp(alias) {
  if (!alias) return;
  openModal(alias.totp_enabled ? '更换子邮箱 2FA' : '绑定子邮箱 2FA', `<p class="muted">将第三方平台显示的 Base32 手动密钥或 <code>otpauth://</code> 地址绑定到 ${escapeHtml(alias.address)}。原始密钥保存后不会回显。</p><form id="alias-totp-form"><div class="field"><label for="alias-totp-secret">2FA 手动密钥或 otpauth 地址</label><textarea id="alias-totp-secret" rows="5" maxlength="4096" required autocomplete="off" spellcheck="false" placeholder="JBSWY3DPEHPK3PXP 或 otpauth://totp/..."></textarea></div>${alias.totp_enabled ? '<p class="muted compact-note">保存后会覆盖当前 2FA 配置。</p>' : ''}<p id="modal-error" class="message"></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-cancel>取消</button><button class="btn btn-primary" type="submit"><i data-lucide="save" class="icon"></i><span>保存 2FA</span></button></div></form>`);
  document.querySelector('[data-cancel]').addEventListener('click', closeModal);
  document.querySelector('#alias-totp-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api(`/api/admin/aliases/${alias.id}/totp`, { method: 'PUT', body: JSON.stringify({ secret: document.querySelector('#alias-totp-secret').value.trim() }) });
      closeModal();
      await loadState();
      toastMessage(alias.totp_enabled ? '子邮箱 2FA 已更换' : '子邮箱 2FA 已绑定');
    } catch (error) {
      document.querySelector('#modal-error').textContent = error.message;
      button.disabled = false;
    }
  });
  lucide.createIcons();
}

document.querySelectorAll('.nav button[data-section]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.nav button').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelectorAll('.section').forEach((section) => section.classList.toggle('active', section.id === button.dataset.section));
  document.querySelector('#page-title').textContent = button.querySelector('span').textContent;
}));

document.querySelector('#refresh').addEventListener('click', loadState);
document.querySelector('#add-account').addEventListener('click', () => {
  openModal('接入母邮箱', `<form id="account-form"><div class="form-grid"><div class="field"><label for="account-email">iCloud 母邮箱</label><input id="account-email" type="email" required placeholder="name@icloud.com"></div><div class="field"><label for="account-password">App 专用密码</label><input id="account-password" type="password" required autocomplete="new-password" placeholder="xxxx-xxxx-xxxx-xxxx"></div><div class="field"><label for="account-host">IMAP 服务器</label><input id="account-host" value="imap.mail.me.com" required></div><div class="field"><label for="account-port">端口</label><input id="account-port" type="number" value="993" min="1" max="65535" required></div></div><p id="modal-error" class="message"></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-cancel>取消</button><button class="btn btn-primary" type="submit"><i data-lucide="plug-zap" class="icon"></i><span>测试并保存</span></button></div></form>`);
  document.querySelector('[data-cancel]').addEventListener('click', closeModal);
  document.querySelector('#account-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try { await api('/api/admin/mail-account', { method: 'POST', body: JSON.stringify({ email: document.querySelector('#account-email').value, appPassword: document.querySelector('#account-password').value, host: document.querySelector('#account-host').value, port: document.querySelector('#account-port').value }) }); closeModal(); await loadState(); toastMessage('母邮箱已接入'); }
    catch (error) { document.querySelector('#modal-error').textContent = error.message; button.disabled = false; }
  });
  lucide.createIcons();
});

document.querySelector('#add-alias').addEventListener('click', () => {
  if (!state.data.accounts.length) return toastMessage('请先接入母邮箱');
  const options = state.data.accounts.map((row) => `<option value="${row.id}">${escapeHtml(row.email)}</option>`).join('');
  openModal('添加子邮箱', `<form id="alias-form"><div class="form-grid"><div class="field"><label for="alias-account">所属母邮箱</label><select id="alias-account">${options}</select></div><div class="field"><label for="alias-address">子邮箱地址</label><input id="alias-address" type="email" required></div><div class="field"><label for="alias-label">备注</label><input id="alias-label" maxlength="80" placeholder="例如：测试账号 01"></div><div class="field"><label for="alias-days">密钥有效天数</label><input id="alias-days" type="number" min="1" max="3650" placeholder="留空表示长期"></div></div><p id="modal-error" class="message"></p><div class="form-actions"><button class="btn btn-secondary" type="button" data-cancel>取消</button><button class="btn btn-primary" type="submit"><i data-lucide="key-round" class="icon"></i><span>创建并生成密钥</span></button></div></form>`);
  document.querySelector('[data-cancel]').addEventListener('click', closeModal);
  document.querySelector('#alias-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try { const data = await api('/api/admin/aliases', { method: 'POST', body: JSON.stringify({ mailAccountId: document.querySelector('#alias-account').value, address: document.querySelector('#alias-address').value, label: document.querySelector('#alias-label').value, expiresDays: document.querySelector('#alias-days').value || null }) }); closeModal(); await loadState(); showSecret(data.token); }
    catch (error) { document.querySelector('#modal-error').textContent = error.message; button.disabled = false; }
  });
  lucide.createIcons();
});

document.querySelector('#setup-totp').addEventListener('click', async () => {
  const setup = await api('/api/admin/totp/setup', { method: 'POST' });
  openModal('启用 TOTP', `<img class="qr" src="${setup.qrDataUrl}" alt="TOTP 二维码"><p>用身份验证器扫描二维码，然后输入当前六位动态码。</p><div class="secret-box">${escapeHtml(setup.secret)}</div><form id="totp-form"><div class="field"><label for="totp-code">六位动态码</label><input id="totp-code" inputmode="numeric" maxlength="6" required></div><p id="modal-error" class="message"></p><div class="form-actions"><button class="btn btn-primary" type="submit">确认启用</button></div></form>`);
  document.querySelector('#totp-form').addEventListener('submit', async (event) => {
    event.preventDefault(); try { await api('/api/admin/totp/enable', { method: 'POST', body: JSON.stringify({ secret: setup.secret, code: document.querySelector('#totp-code').value }) }); closeModal(); await loadState(); toastMessage('TOTP 已启用'); } catch (error) { document.querySelector('#modal-error').textContent = error.message; }
  });
});

document.querySelector('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await api('/api/admin/password', { method: 'POST', body: JSON.stringify({ currentPassword: document.querySelector('#current-password').value, newPassword: document.querySelector('#new-password').value }) }); event.currentTarget.reset(); toastMessage('登录密码已更新'); } catch (error) { toastMessage(error.message); }
});

document.querySelector('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.replace('/admin/login'); });

lucide.createIcons();
loadState().catch((error) => toastMessage(error.message));
