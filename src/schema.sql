CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  totp_secret_encrypted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_challenges (
  id_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mail_accounts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  app_password_encrypted TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT 'imap.mail.me.com',
  port INTEGER NOT NULL DEFAULT 993,
  secure BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_uid BIGINT NOT NULL DEFAULT 0,
  uid_validity TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mail_accounts ADD COLUMN IF NOT EXISTS uid_validity TEXT;

CREATE TABLE IF NOT EXISTS aliases (
  id BIGSERIAL PRIMARY KEY,
  mail_account_id BIGINT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  address TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  token_digest TEXT UNIQUE,
  token_hint TEXT,
  token_expires_at TIMESTAMPTZ,
  totp_secret_encrypted TEXT,
  totp_issuer TEXT NOT NULL DEFAULT '',
  totp_account_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE aliases ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT;
ALTER TABLE aliases ADD COLUMN IF NOT EXISTS totp_issuer TEXT NOT NULL DEFAULT '';
ALTER TABLE aliases ADD COLUMN IF NOT EXISTS totp_account_name TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS verification_messages (
  id BIGSERIAL PRIMARY KEY,
  mail_account_id BIGINT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  alias_id BIGINT REFERENCES aliases(id) ON DELETE CASCADE,
  message_key TEXT NOT NULL,
  sender TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  code_encrypted TEXT,
  code_masked TEXT,
  confidence SMALLINT NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mail_account_id, message_key)
);

CREATE INDEX IF NOT EXISTS verification_messages_alias_recent_idx
  ON verification_messages(alias_id, received_at DESC);
CREATE INDEX IF NOT EXISTS verification_messages_expires_idx
  ON verification_messages(expires_at);

CREATE TABLE IF NOT EXISTS unmatched_messages (
  id BIGSERIAL PRIMARY KEY,
  mail_account_id BIGINT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  message_key TEXT NOT NULL,
  sender TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  recipient_headers TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mail_account_id, message_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  ip_digest TEXT,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
