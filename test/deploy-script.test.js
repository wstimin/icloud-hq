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
