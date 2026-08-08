const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

test('deployment script accepts an empty administrator IP allowlist', () => {
  const script = fs.readFileSync('deploy.sh', 'utf8');

  assert.match(script, /if \[ -n "\$ADMIN_ALLOWED_IPS" \]; then/);
  assert.doesNotMatch(
    script,
    /printf '%s' "\$ADMIN_ALLOWED_IPS" \| grep -Eq '[^']*\*'/,
  );
});

test('administrator passwords consistently require at least eight characters', () => {
  const deployScript = fs.readFileSync('deploy.sh', 'utf8');
  const initScript = fs.readFileSync('scripts/init-env.sh', 'utf8');
  const server = fs.readFileSync('src/server.js', 'utf8');
  const adminPage = fs.readFileSync('public/admin.html', 'utf8');

  assert.match(deployScript, /ADMIN_PASSWORD}" -ge 8/);
  assert.match(initScript, /ADMIN_PASSWORD}" -lt 8/);
  assert.match(server, /password\.length < 8/);
  assert.match(server, /newPassword\.length < 8/);
  assert.match(adminPage, /minlength="8"/);
});
