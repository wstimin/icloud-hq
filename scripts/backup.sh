#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"

backup_once() {
  mkdir -p "$BACKUP_DIR"
  target="${BACKUP_DIR}/codevault-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  pg_dump -h "${PGHOST:-db}" -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$target"
  find "$BACKUP_DIR" -type f -name 'codevault-*.sql.gz' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
  printf 'Database backup created: %s\n' "$target"
}

if [ "${1:-}" = "once" ]; then
  backup_once
  exit 0
fi

while true; do
  backup_once
  sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
done
