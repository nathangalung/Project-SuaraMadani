#!/usr/bin/env bash
# Local restore drill, throwaway containers
# PITR, tenant load, restic copy
# Archiving on, host-setup data dir
# Needs bun and dev clamd
set -Eeuo pipefail

INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$INFRA")"
RUN="sbrt-$$"
PG_IMAGE="sadar-bersuara-postgres:restore-test"
RESTIC_IMAGE="restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510"
WORK="$(mktemp -d)"
PW="restore-test-only"
KEY="$(openssl rand -base64 32)"
PORT="${RESTORE_TEST_PORT:-5198}"
# Sample seed scans, dev compose
CLAMD="${CLAMD_HOST:-127.0.0.1}:${CLAMD_PORT:-53310}"

step() { printf '== %s\n' "$*"; }
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() {
  local code=$?
  # Failure: show server logs
  if ((code != 0)); then
    for c in "$RUN-pg" "$RUN-pg2"; do docker logs --tail 15 "$c" 2>&1 | sed "s/^/$c: /" || true; done
  fi
  docker rm -f "$RUN-pg" "$RUN-pg2" >/dev/null 2>&1 || true
  docker volume rm "$RUN-data2" "$RUN-repo" >/dev/null 2>&1 || true
  # Postgres files: uid 999
  docker run --rm --user 0:0 -v "$WORK:/w" --entrypoint rm "$PG_IMAGE" -rf /w/pgdata >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

command -v bun >/dev/null || fail "bun runs the migrations"
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  fail "port $PORT is in use"
fi
(exec 3<>"/dev/tcp/${CLAMD%:*}/${CLAMD##*:}") 2>/dev/null || fail "no clamd at $CLAMD, run bun run db:up"

step "build postgres image"
docker build -q -f "$INFRA/postgres.Dockerfile" -t "$PG_IMAGE" "$INFRA" >/dev/null

pg_env=(
  -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=sadar_bersuara
  -e SB_DATABASE=sadar_bersuara -e SB_MIGRATOR_PASSWORD="$PW"
  -e SB_APP_PASSWORD="$PW" -e SB_MEDIA_PASSWORD="$PW"
  -e SB_BACKUP_PASSWORD="$PW"
  # REL-05: production has both
  -e GLITCHTIP_DB_PASSWORD="$PW" -e UMAMI_DB_PASSWORD="$PW"
  # Local repo replaces R2
  -e PGBACKREST_REPO1_TYPE=posix -e PGBACKREST_REPO1_PATH=/repo
  -e PGBACKREST_REPO1_CIPHER_PASS="$PW"
)

wait_pg() {
  for _ in $(seq 1 90); do
    if docker exec "$1" pg_isready -h 127.0.0.1 -U postgres -d sadar_bersuara >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  docker logs "$1" | tail -20
  return 1
}

# Ready precedes promotion, still read-only
wait_promoted() {
  for _ in $(seq 1 90); do
    if [[ "$(docker exec -u postgres "$1" psql -X -At -c 'SELECT pg_is_in_recovery()' 2>/dev/null)" == "f" ]]; then
      return 0
    fi
    sleep 1
  done
  docker logs "$1" | tail -20
  return 1
}

# Drill: host reaches the port
printf '%s\n' 'local all postgres peer' 'host all all 127.0.0.1/32 scram-sha-256' 'host all all samenet scram-sha-256' >"$WORK/pg_hba.conf"
chmod 0644 "$WORK/pg_hba.conf"

# init: true, like compose
start_pg() {
  docker run -d --init --name "$1" "${pg_env[@]}" --shm-size 256m "${@:3}" \
    -v "$WORK/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro" \
    -v "$2:/var/lib/postgresql" -v "$RUN-repo:/repo" "$PG_IMAGE" >/dev/null
  wait_pg "$1"
}

sql() {
  docker exec -u postgres "$1" psql -X -At -v ON_ERROR_STOP=1 -d sadar_bersuara -c "$2"
}

pgbr() {
  local name="$1"
  shift
  docker exec -u postgres "$name" pgbackrest --stanza=main "$@"
}

# Repo code, never repo .env
app() {
  local url="127.0.0.1:$PORT/sadar_bersuara"
  (cd "$ROOT" && env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development \
    APEX_HOST=localhost FILES_DIR="$WORK/sample-files" \
    CLAMD_HOST="${CLAMD%:*}" CLAMD_PORT="${CLAMD##*:}" \
    AUDIT_HMAC_KEY="$KEY" LACAK_LINK_KEYS="1:$KEY" BETTER_AUTH_SECRETS="1:$KEY" \
    DATABASE_URL="postgres://sb_app:$PW@$url" \
    DATABASE_MIGRATOR_URL="postgres://sb_migrator:$PW@$url" \
    DATABASE_MEDIA_URL="postgres://sb_media:$PW@$url" \
    bun --no-env-file "$@")
}

# Rows per table, md5 each
TENANT_TABLES="FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped
    AND a.attname IN ('org_id', 'organization_id')
  WHERE c.relkind = 'r' AND c.relname <> 'organizations'"
sums() {
  local query
  if [[ -n "$2" ]]; then
    query="SELECT format('SELECT %L, count(*), md5(coalesce(string_agg(t::text, E''\\n'' ORDER BY t::text), '''')) FROM public.%I t WHERE %I = %L', c.relname, c.relname, a.attname, '$2') $TENANT_TABLES ORDER BY c.relname"
  else
    query="SELECT format('SELECT %L, count(*), md5(coalesce(string_agg(t::text, E''\\n'' ORDER BY t::text), '''')) FROM public.%I t', c.relname, c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
        AND NOT a.attisdropped AND a.attname IN ('org_id', 'organization_id'))
      ORDER BY c.relname"
  fi
  printf '%s \\gexec\n' "$query" |
    docker exec -i -u postgres "$1" psql -X -At -v ON_ERROR_STOP=1 -d sadar_bersuara
}

step "first cluster, production migrations, two campuses"
docker volume create "$RUN-repo" >/dev/null
docker run --rm -v "$RUN-repo:/repo" --entrypoint chown "$PG_IMAGE" postgres:postgres /repo
# Data dir like host-setup
docker run --rm --user 0:0 -v "$WORK:/w" --entrypoint install "$PG_IMAGE" -d -m 0700 -o 999 -g 999 /w/pgdata
start_pg "$RUN-pg" "$WORK/pgdata" -p "127.0.0.1:$PORT:5432"
# Archive works from the start
pgbr "$RUN-pg" stanza-create
app db/migrate.ts
app db/seed/regions.ts
app db/seed/organizations.ts
app db/seed/sample.ts >/dev/null
A="$(sql "$RUN-pg" "SELECT id FROM organizations WHERE slug = 'itb'")"
B="$(sql "$RUN-pg" "SELECT id FROM organizations WHERE slug = 'ugm'")"
# Reporter in A, not staff
U="$(sql "$RUN-pg" "SELECT u.id FROM users u
  WHERE EXISTS (SELECT 1 FROM reports r WHERE r.user_id = u.id AND r.org_id = '$A')
    AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.user_id = u.id AND r.org_id <> '$A')
    AND NOT EXISTS (SELECT 1 FROM members m WHERE m.user_id = u.id AND m.role <> 'reporter')
  ORDER BY (SELECT count(*) FROM follows f WHERE f.user_id = u.id) DESC, u.id LIMIT 1")"
I1="$(sql "$RUN-pg" "SELECT id FROM issues WHERE org_id = '$A' ORDER BY id LIMIT 1")"
I2="$(sql "$RUN-pg" "SELECT id FROM issues WHERE org_id = '$A' ORDER BY id DESC LIMIT 1")"
[[ -n "$A" && -n "$B" && -n "$U" && -n "$I1" && "$I1" != "$I2" ]] || fail "sample seed shape"
# Claims are legacy rows now
C="$(sql "$RUN-pg" "INSERT INTO resolution_claims (org_id, issue_id) VALUES ('$A', '$I1') RETURNING id" | head -1)"
[[ -n "$C" ]] || fail "legacy claim row"
E="$(sql "$RUN-pg" "INSERT INTO email_log (kind, address_hash, status) VALUES ('notification', 'drill', 'sent') RETURNING id" | head -1)"
# Pending at T, then sent
sql "$RUN-pg" "
  UPDATE issues SET summary = summary || E', \"kutip\"\nbaris baru' WHERE id = '$I1';
  INSERT INTO notifications (org_id, user_id, event_id, template, issue_id, status, email_log_id) VALUES
    ('$A', '$U', gen_random_uuid(), 'issue_published', '$I1', 'pending', '$E'),
    ('$A', NULL, gen_random_uuid(), 'issue_published', '$I1', 'sent', NULL)" >/dev/null
# Deleted account: claim rows
sql "$RUN-pg" "
  INSERT INTO ratings (org_id, claim_id, user_id, score, is_reporter, account_days, client_hash)
    VALUES ('$A', '$C', '$U', 4, false, 40, 'drill');
  INSERT INTO fix_surveys (org_id, claim_id, user_id) VALUES ('$A', '$C', '$U');
  INSERT INTO agency_replies (org_id, issue_id, user_id, submission_id, agency, sender_role, body)
    VALUES ('$A', '$I1', '$U', gen_random_uuid(), 'Dinas', 'Humas', E'Isi hak jawab drill.\n\\\\.\nbaris\n\\\\.\r\nakhir')" >/dev/null
step "sample: $(sql "$RUN-pg" "SELECT count(*) FROM reports") reports, $(sql "$RUN-pg" "SELECT count(*) FROM issues") issues"

step "full backup"
sql "$RUN-pg" "CREATE TABLE drill (note text, at timestamptz DEFAULT clock_timestamp())"
sql "$RUN-pg" "INSERT INTO drill (note) VALUES ('before-backup')"
pgbr "$RUN-pg" check
pgbr "$RUN-pg" --type=full backup

step "writes after the backup, then junk"
sql "$RUN-pg" "INSERT INTO drill (note) VALUES ('after-backup')"
sleep 1
# pgBackRest wants space and +00
target="$(sql "$RUN-pg" "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') || '+00'")"
sleep 1
sql "$RUN-pg" "INSERT INTO drill (note) VALUES ('junk-after-target')"
# Account deletion, as FKs allow
CLOSE="
  DELETE FROM issue_reports WHERE report_id IN (SELECT id FROM reports WHERE user_id = '$U');
  DELETE FROM reports WHERE user_id = '$U';
  DELETE FROM users WHERE id = '$U';
  DELETE FROM email_log WHERE id = '$E'"
sql "$RUN-pg" "
  UPDATE issues SET title = 'changed-after-target' WHERE id = '$I1';
  DELETE FROM issue_reports WHERE issue_id = '$I2';
  DELETE FROM issues WHERE id = '$I2';
  INSERT INTO notifications (org_id, event_id, template, issue_id, error)
    VALUES ('$A', gen_random_uuid(), 'issue_published', '$I1', 'after-target');
  $CLOSE" >/dev/null
sql "$RUN-pg" "SELECT pg_switch_wal()" >/dev/null
pgbr "$RUN-pg" check
docker stop "$RUN-pg" >/dev/null

step "restore to $target on an empty volume"
started=$SECONDS
docker run --rm "${pg_env[@]}" -u postgres \
  -v "$RUN-data2:/var/lib/postgresql" -v "$RUN-repo:/repo" \
  --entrypoint sh "$PG_IMAGE" -c \
  "mkdir -p /var/lib/postgresql/18/docker && chmod 700 /var/lib/postgresql/18/docker && pgbackrest --stanza=main --type=time --target='$target' --target-action=promote restore"
start_pg "$RUN-pg2" "$RUN-data2"
wait_promoted "$RUN-pg2" || fail "restored cluster never left recovery"
restore_s=$((SECONDS - started))

notes="$(sql "$RUN-pg2" "SELECT string_agg(note, ',' ORDER BY at) FROM drill")"
step "restored rows: $notes"
[[ "$notes" == "before-backup,after-backup" ]] || fail "expected before-backup,after-backup"
roles="$(sql "$RUN-pg2" "SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolname LIKE 'sb\_%'")"
step "roles: $roles"
[[ "$roles" == "sb_aggregates,sb_app,sb_backup,sb_media,sb_migrator" ]] || fail "roles missing after the restore: $roles"
dbs="$(sql "$RUN-pg2" "SELECT string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE datname IN ('glitchtip', 'umami')")"
[[ "$dbs" == "glitchtip,umami" ]] || fail "glitchtip and umami databases missing after the restore: $dbs"

step "campus itb exported at the target"
"$INFRA/tenant-export.sh" "$RUN-pg2" itb "$WORK/run/export"
manifest="$WORK/run/export/manifest.tsv"
want="$(sql "$RUN-pg2" "SELECT count(*) $TENANT_TABLES")"
[[ "$(($(wc -l <"$manifest") - 1))" == "$want" ]] || fail "manifest lacks tenant tables, want $want"
[[ "$(awk -F'\t' '$2 == "issue_reports" { print $5 }' "$manifest")" == "replace" ]] || fail "issue_reports not exported"
[[ "$(awk -F'\t' '$5 == "keep" { print $2 }' "$manifest" | sort | tr '\n' ' ')" == "audit_log invitations members org_counters " ]] || fail "keep tables"
head -1 "$WORK/run/export/issues.copy" | grep -q search && fail "generated column exported"
grep -q "$B" "$WORK/run/export/issues.copy" && fail "another tenant's issue exported"

step "expected state: target plus deletions"
sql "$RUN-pg2" "$CLOSE;
  UPDATE notifications SET status = 'skipped', error = 'restored'
    WHERE org_id = '$A' AND status NOT IN ('sent', 'failed', 'skipped')" >/dev/null
sums "$RUN-pg2" "$A" >"$WORK/a.want"

step "live cluster before the load"
docker start "$RUN-pg" >/dev/null
wait_pg "$RUN-pg"
sums "$RUN-pg" "$A" >"$WORK/a.before"
sums "$RUN-pg" "$B" >"$WORK/b.before"
sums "$RUN-pg" "" >"$WORK/global.before"
sql "$RUN-pg" "SELECT action, count(*) FROM audit_log WHERE org_id = '$A' AND created_at > '$target'
  GROUP BY action ORDER BY action" >"$WORK/run/after-target.txt"
if "$INFRA/tenant-load.sh" "$WORK/run/export" --container "$RUN-pg" >"$WORK/refused.txt" 2>&1; then
  fail "load ran without --confirm"
fi
grep -q "nothing loaded" "$WORK/refused.txt" || fail "refusal: $(tail -1 "$WORK/refused.txt")"
sums "$RUN-pg" "$A" | cmp -s - "$WORK/a.before" || fail "refused load changed rows"

step "load campus itb"
started=$SECONDS
"$INFRA/tenant-load.sh" "$WORK/run/export" --container "$RUN-pg" --confirm 2>&1 | tee "$WORK/load.txt"
load_s=$((SECONDS - started))
for rule in "reports drop user_id" "follows drop user_id" "notifications null user_id" \
  "notifications null email_log_id" "issue_reports drop org_id,report_id" \
  "moderation_decisions drop org_id,report_id" "notifications restored 1" \
  "ratings drop user_id 1" "fix_surveys drop user_id 1" "agency_replies null user_id 1"; do
  grep -q "tenant-load: $rule" "$WORK/load.txt" || fail "rule not exercised: $rule"
done
sums "$RUN-pg" "$B" | diff "$WORK/b.before" - || fail "campus ugm changed"
sums "$RUN-pg" "" | diff "$WORK/global.before" - || fail "shared tables changed"
sums "$RUN-pg" "$A" >"$WORK/a.after"
undone=0
while IFS=$'\t' read -r _ table _ _ load _; do
  [[ "$table" == table ]] && continue
  if [[ "$load" == keep ]]; then
    want="$(grep "^$table|" "$WORK/a.before")"
  else
    want="$(grep "^$table|" "$WORK/a.want")"
    [[ "$want" == "$(grep "^$table|" "$WORK/a.before")" ]] || undone=$((undone + 1))
  fi
  [[ -n "$want" && "$(grep "^$table|" "$WORK/a.after")" == "$want" ]] || fail "itb $table: $(grep "^$table|" "$WORK/a.after") want $want"
done <"$manifest"
# Comparison must not be vacuous
((undone >= 4)) || fail "only $undone itb tables differed before the load"
title="$(sql "$RUN-pg" "SELECT title FROM issues WHERE id = '$I1'")"
[[ "$title" != changed-after-target ]] || fail "title after the target kept"
[[ "$(sql "$RUN-pg" "SELECT count(*) FROM issues WHERE id = '$I2'")" == 1 ]] || fail "deleted issue not back"
[[ "$(sql "$RUN-pg" "SELECT count(*) FROM notifications WHERE error = 'after-target'")" == 0 ]] || fail "row after the target kept"
[[ "$(sql "$RUN-pg" "SELECT status || ' ' || error || ' ' || (user_id IS NULL) || ' ' || (email_log_id IS NULL)
  FROM notifications WHERE org_id = '$A' AND template = 'issue_published' AND error = 'restored' AND issue_id = '$I1'")" == "skipped restored true true" ]] ||
  fail "pending notification not skipped"
step "itb equals the target ($undone tables undone), ugm and shared tables unchanged"

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
restic_run backup --host sadar-bersuara --tag evidence /files >/dev/null
# Root lacks DAC_OVERRIDE there
chmod -R a+rwX "$WORK/repo" "$WORK/out"
restic_restore >/dev/null
(cd "$WORK/files" && find . -type f -exec sha256sum {} + | sort) >"$WORK/a.sum"
(cd "$WORK/out/files" && find . -type f -exec sha256sum {} + | sort) >"$WORK/b.sum"
diff "$WORK/a.sum" "$WORK/b.sum"
restic_run check --read-data-subset=100% >/dev/null
step "restic: $(wc -l <"$WORK/a.sum") files match"

# RTO drill input, runbook Restore
echo "restore-test: restore ${restore_s}s, tenant load ${load_s}s"
echo "restore-test: PASS"
