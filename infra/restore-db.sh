#!/usr/bin/env bash
# Usage: restore-db.sh <UTC time|latest>
# Whole cluster PITR, root
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

target="${1:-}"
[[ -n "$target" ]] || die "give a UTC time from .deployed-history or latest"
load_env
pgdata_root="$(env_get PGDATA_ROOT)"
pgdata="${pgdata_root:-/mnt/pgdata}/data/18/docker"

restore_args=(--stanza=main --delta)
if [[ "$target" != "latest" ]]; then
  [[ "$target" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] || die "time must look like 2026-10-15T01:02:03Z"
  # pgBackRest format: space, +00
  pg_time="${target/T/ }"
  restore_args+=(--type=time "--target=${pg_time%Z}+00" --target-action=promote)
fi

mapfile -t services < <(app_services)
log "stopping app and database"
# Its session rows rewind too
compose stop web worker worker-media worker-whatsapp glitchtip umami postgres
# Keep the damaged cluster aside
aside="$pgdata.before-restore.$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "$pgdata" "$aside"
log "old cluster copied to $aside"

compose run --rm --no-deps -u postgres --entrypoint pgbackrest postgres \
  "${restore_args[@]}" restore
compose up -d --wait --wait-timeout 600 postgres
compose up -d --wait --wait-timeout 300 "${services[@]}" glitchtip umami
log "restore to $target done, run row checks, check /admin/whatsapp"
