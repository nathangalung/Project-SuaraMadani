#!/usr/bin/env bash
# Usage: restore-tenant.sh <slug> <UTC time>
# One tenant at T, root
# COPY files only, live untouched
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

slug="${1:-}"
target="${2:-}"
[[ "$slug" =~ ^[a-z0-9-]+$ ]] || die "give the tenant slug"
[[ "$target" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] || die "time must look like 2026-10-15T01:02:03Z"
load_env
pgdata_root="$(env_get PGDATA_ROOT)"
pgdata_root="${pgdata_root:-/mnt/pgdata}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$pgdata_root/restore/$slug-$stamp"
scratch="$work/cluster"
name="sb-restore-$slug-$$"
envfile="$RUN_DIR/restore-$$.env"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -f "$envfile"
  [[ -d "$scratch" ]] && rm -rf --one-file-system "$scratch"
}
trap cleanup EXIT

# Repo settings, same as live
config="$(compose config --format json)"
image="$(jq -r '.services.postgres.image' <<<"$config")"
(
  umask 077
  jq -r '.services.postgres.environment | to_entries[]
    | select(.key | startswith("PGBACKREST_")) | "\(.key)=\(.value)"' \
    <<<"$config" >"$envfile"
)
install -d -m 0700 "$work"
install -d -m 0700 -o 999 -g 999 "$scratch"

log "restoring a scratch cluster to $target"
docker run --rm --env-file "$envfile" -u postgres \
  -v "$scratch:/var/lib/postgresql" --entrypoint sh "$image" -c \
  "install -d -m 0700 /var/lib/postgresql/18/docker && pgbackrest --stanza=main --type=time --target='${target/T/ }+00' --target-action=promote restore"

# Archiving off: no second timeline
# Small buffers beside live
# init reaps async archive-get
docker run -d --init --name "$name" --env-file "$envfile" -u postgres \
  --shm-size 256m -v "$scratch:/var/lib/postgresql" "$image" \
  postgres -c config_file=/etc/postgresql/postgresql.conf \
  -c archive_mode=off -c listen_addresses='' -c shared_buffers=256MB >/dev/null
for _ in $(seq 1 720); do
  state="$(docker exec -u postgres "$name" psql -X -At -d sadar_bersuara \
    -c "SELECT pg_is_in_recovery()" 2>/dev/null || true)"
  [[ "$state" == "f" ]] && break
  sleep 5
done
[[ "${state:-}" == "f" ]] || die "scratch cluster did not finish recovery"

"$INFRA/tenant-export.sh" "$name" "$slug" "$work/export"
org="$(cat "$work/export/org_id")"

# Post-T events to re-apply
compose exec -T -u postgres postgres psql -X -q -v ON_ERROR_STOP=1 \
  -d sadar_bersuara -c "SELECT action, count(*) AS events, min(created_at) AS first, max(created_at) AS last
    FROM audit_log WHERE org_id = '$org' AND created_at > '${target/T/ }+00'
    GROUP BY action ORDER BY action" | tee "$work/after-target.txt"
log "export in $work, then infra/tenant-load.sh $work/export (runbook step 2 first)"
