'use strict';

const form = document.querySelector('#login-form');
const errorBox = document.querySelector('#login-error');
const totpField = document.querySelector('#totp-field');
let challenge = '';

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const url = challenge ? '/api/admin/login/totp' : '/api/admin/login';
    const payload = challenge
      ? { challenge, code: document.querySelector('#totp').value }
      : { email: document.querySelector('#email').value, password: document.querySelector('#password').value };
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '登录失败');
    if (data.requiresTotp) {
      challenge = data.challenge;
      totpField.classList.remove('hidden');
      document.querySelector('#email').disabled = true;
      document.querySelector('#password').disabled = true;
      document.querySelector('#totp').required = true;
      document.querySelector('#totp').focus();
    } else {
      location.replace('/admin');
    }
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

lucide.createIcons();
