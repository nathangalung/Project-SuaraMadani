#!/usr/bin/env bash
# Usage: backup-db.sh [auto|full|diff]
# Daily timer, full on Sunday
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

type="${1:-auto}"
if [[ "$type" == "auto" ]]; then
  # Sunday in Asia/Jakarta
  if [[ "$(TZ=Asia/Jakarta date +%u)" == "7" ]]; then type="full"; else type="diff"; fi
fi
[[ "$type" == "full" || "$type" == "diff" ]] || die "type must be full or diff"

load_env
pgbr() {
  compose exec -T -u postgres postgres pgbackrest --stanza=main "$@"
}

# Idempotent, first run creates
pgbr stanza-create
log "pgbackrest $type backup"
pgbr --type="$type" backup
pgbr check
record_backup pgbackrest
# CBC has no MAC: verify
log "pgbackrest verify"
pgbr verify
record_backup pgbackrest-verify

# B2 copy age, list-only key
if [[ -n "$(env_get B2_LIST_KEY_ID)" ]]; then
  image="$(deployed_ref app)"
  newest="$(docker run --rm \
    -e B2_LIST_KEY_ID="$(env_get B2_LIST_KEY_ID)" \
    -e B2_LIST_KEY="$(env_get B2_LIST_KEY)" \
    -e B2_BUCKET="$(env_get B2_BUCKET)" \
    -v "$INFRA/b2-newest.ts:/app/b2-newest.ts:ro" \
    "$image" bun b2-newest.ts)"
  record_backup b2-copy "$newest"
  log "b2 copy newest object $newest"
fi
log "database backup done"
