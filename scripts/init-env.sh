#!/bin/sh
set -eu

if [ -f .env ]; then
  echo ".env already exists; refusing to overwrite it."
  exit 1
fi

printf "Public domain (for example code.example.com): "
read DOMAIN
printf "Let's Encrypt email: "
read ACME_EMAIL
printf "Initial administrator email: "
read ADMIN_EMAIL
printf "Initial administrator password (at least 8 characters): "
stty -echo
read ADMIN_PASSWORD
stty echo
printf "\n"

if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
  echo "Administrator password is too short."
  exit 1
fi
if ! printf '%s' "$ADMIN_PASSWORD" | grep -Eq '^[A-Za-z0-9._~-]+$'; then
  echo "For the initial password, use only letters, numbers, dot, underscore, tilde, and hyphen."
  echo "You can change it to a different strong password in the administrator panel after deployment."
  exit 1
fi

MASTER_KEY_HEX="$(openssl rand -hex 32)"
TOKEN_PEPPER_HEX="$(openssl rand -hex 32)"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"

cat > .env <<EOF
DOMAIN=${DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
MASTER_KEY_HEX=${MASTER_KEY_HEX}
TOKEN_PEPPER_HEX=${TOKEN_PEPPER_HEX}
POSTGRES_DB=codevault
POSTGRES_USER=codevault
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
SESSION_HOURS=12
CODE_TTL_MINUTES=10
IMAP_POLL_SECONDS=15
MAX_MESSAGE_BYTES=1048576
QUERY_LIMIT_PER_10_MINUTES=30
LOGIN_LIMIT_PER_15_MINUTES=10
TRUST_PROXY=1
ADMIN_ALLOWED_IPS=
EOF

chmod 600 .env
echo ".env created. Run: docker compose up -d --build"
