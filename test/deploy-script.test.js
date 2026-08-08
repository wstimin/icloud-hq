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

test('production deployment includes backups, log rotation, health wait, and rollback', () => {
  const deployScript = fs.readFileSync('deploy.sh', 'utf8');
  const compose = fs.readFileSync('compose.production.yaml', 'utf8');
  const backup = fs.readFileSync('scripts/backup.sh', 'utf8');

  assert.match(deployScript, /run --rm backup sh \/usr\/local\/bin\/backup\.sh once/);
  assert.match(deployScript, /docker tag "\$current_image" "\$rollback_image"/);
  assert.match(deployScript, /--pull never web worker/);
  assert.match(deployScript, /Waiting for the web service health check/);
  assert.match(compose, /max-size: "10m"/);
  assert.match(compose, /max-file: "3"/);
  assert.match(compose, /BACKUP_RETENTION_DAYS/);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /-mtime "\+\$\{BACKUP_RETENTION_DAYS\}" -delete/);
});
