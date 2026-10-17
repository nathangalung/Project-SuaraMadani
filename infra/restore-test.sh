#!/usr/bin/env bash
# Local restore drill, throwaway containers
# PITR, posix repo, restic copy
# Archiving on, host-setup data dir
set -Eeuo pipefail

INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="smrt-$$"
PG_IMAGE="suara-madani-postgres:restore-test"
RESTIC_IMAGE="restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510"
WORK="$(mktemp -d)"
PW="restore-test-only"

step() { printf '== %s\n' "$*"; }

cleanup() {
  docker rm -f "$RUN-pg" "$RUN-pg2" >/dev/null 2>&1 || true
  docker volume rm "$RUN-data2" "$RUN-repo" >/dev/null 2>&1 || true
  # Postgres files: uid 999
  docker run --rm --user 0:0 -v "$WORK:/w" --entrypoint rm "$PG_IMAGE" -rf /w/pgdata >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step "build postgres image"
docker build -q -f "$INFRA/postgres.Dockerfile" -t "$PG_IMAGE" "$INFRA" >/dev/null

pg_env=(
  -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=suara_madani
  -e SM_DATABASE=suara_madani -e SM_MIGRATOR_PASSWORD="$PW"
  -e SM_APP_PASSWORD="$PW" -e SM_MEDIA_PASSWORD="$PW"
  -e SM_BACKUP_PASSWORD="$PW"
  # Local repo replaces R2
  -e PGBACKREST_REPO1_TYPE=posix -e PGBACKREST_REPO1_PATH=/repo
  -e PGBACKREST_REPO1_CIPHER_PASS="$PW"
)

start_pg() {
  docker run -d --name "$1" "${pg_env[@]}" --shm-size 256m \
    -v "$2:/var/lib/postgresql" -v "$RUN-repo:/repo" "$PG_IMAGE" >/dev/null
  for _ in $(seq 1 90); do
    if docker exec "$1" pg_isready -h 127.0.0.1 -U postgres -d suara_madani >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  docker logs "$1" | tail -20
  return 1
}

sql() {
  docker exec -u postgres "$1" psql -X -At -v ON_ERROR_STOP=1 -d suara_madani -c "$2"
}

pgbr() {
  local name="$1"
  shift
  docker exec -u postgres "$name" pgbackrest --stanza=main "$@"
}

step "first cluster, stanza and full backup"
docker volume create "$RUN-repo" >/dev/null
docker run --rm -v "$RUN-repo:/repo" --entrypoint chown "$PG_IMAGE" postgres:postgres /repo
# Data dir like host-setup
docker run --rm --user 0:0 -v "$WORK:/w" --entrypoint install "$PG_IMAGE" -d -m 0700 -o 999 -g 999 /w/pgdata
start_pg "$RUN-pg" "$WORK/pgdata"
sql "$RUN-pg" "CREATE TABLE drill (note text, at timestamptz DEFAULT clock_timestamp())"
sql "$RUN-pg" "INSERT INTO drill (note) VALUES ('before-backup')"
pgbr "$RUN-pg" stanza-create
pgbr "$RUN-pg" check
pgbr "$RUN-pg" --type=full backup

step "writes after the backup, then junk"
sql "$RUN-pg" "INSERT INTO drill (note) VALUES ('after-backup')"
sleep 1
# pgBackRest wants space and +00
target="$(sql "$RUN-pg" "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') || '+00'")"
sleep 1
sql "$RUN-pg" "INSERT INTO drill (note) VALUES ('junk-after-target')"
sql "$RUN-pg" "SELECT pg_switch_wal()" >/dev/null
pgbr "$RUN-pg" check
docker stop "$RUN-pg" >/dev/null

step "restore to $target on an empty volume"
docker run --rm "${pg_env[@]}" -u postgres \
  -v "$RUN-data2:/var/lib/postgresql" -v "$RUN-repo:/repo" \
  --entrypoint sh "$PG_IMAGE" -c \
  "mkdir -p /var/lib/postgresql/18/docker && chmod 700 /var/lib/postgresql/18/docker && pgbackrest --stanza=main --type=time --target='$target' --target-action=promote restore"
start_pg "$RUN-pg2" "$RUN-data2"

notes="$(sql "$RUN-pg2" "SELECT string_agg(note, ',' ORDER BY at) FROM drill")"
step "restored rows: $notes"
[[ "$notes" == "before-backup,after-backup" ]] || {
  echo "FAIL: expected before-backup,after-backup" >&2
  exit 1
}
roles="$(sql "$RUN-pg2" "SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolname LIKE 'sm\_%'")"
step "roles: $roles"

step "restic evidence round trip"
mkdir -p "$WORK/files/evidence/org" "$WORK/repo" "$WORK/out"
for i in 1 2 3; do head -c 200000 /dev/urandom >"$WORK/files/evidence/org/file-$i"; done
restic_run() {
  docker run --rm -e RESTIC_PASSWORD="$PW" -e RESTIC_REPOSITORY=/repo \
    -v "$WORK/repo:/repo" -v "$WORK/files:/files:ro" -v "$WORK/out:/out" \
    --user "$(id -u):$(id -g)" -e RESTIC_CACHE_DIR=/tmp/cache \
    "$RESTIC_IMAGE" "$@"
}
# Runbook caps, compose limits
restic_restore() {
  docker run --rm --read-only --tmpfs /tmp:size=256m --cap-drop ALL \
    --cap-add DAC_READ_SEARCH --cap-add CHOWN --cap-add FOWNER \
    --security-opt no-new-privileges:true \
    -e RESTIC_PASSWORD="$PW" -e RESTIC_REPOSITORY=/repo \
    -e RESTIC_CACHE_DIR=/tmp/cache \
    -v "$WORK/repo:/repo" -v "$WORK/out:/restore" \
    "$RESTIC_IMAGE" restore latest --target /restore
}
restic_run init >/dev/null
restic_run backup --host suara-madani --tag evidence /files >/dev/null
# Root lacks DAC_OVERRIDE there
chmod -R a+rwX "$WORK/repo" "$WORK/out"
restic_restore >/dev/null
(cd "$WORK/files" && find . -type f -exec sha256sum {} + | sort) >"$WORK/a.sum"
(cd "$WORK/out/files" && find . -type f -exec sha256sum {} + | sort) >"$WORK/b.sum"
diff "$WORK/a.sum" "$WORK/b.sum"
restic_run check --read-data-subset=100% >/dev/null
step "restic: $(wc -l <"$WORK/a.sum") files match"

echo "restore-test: PASS"
