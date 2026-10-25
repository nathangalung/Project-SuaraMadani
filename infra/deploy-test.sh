#!/usr/bin/env bash
# Rollback drill, real deploy-gate.sh
# Usage: deploy-test.sh <app-ref> <postgres-ref>
# Registry 127.0.0.1:5198, Caddy 127.0.0.1:5199
set -Eeuo pipefail

INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$INFRA")"
APP="${1:?app image, e.g. sadar-bersuara:local}"
PG="${2:?postgres image, e.g. sadar-bersuara-postgres:local}"
PORT=5199
REG="127.0.0.1:5198"
# registry 3.0.0, January 2026 build
REGISTRY_IMAGE="registry:3.0.0@sha256:6c5666b861f3505b116bb9aa9b25175e71210414bd010d92035ff64018f9457e"
CADDY_IMAGE="$(sed -n 's/^ *image: \(caddy:.*\)$/\1/p' "$INFRA/compose.yaml")"
WORK="$(mktemp -d)"
PROJECT="sb-deploy-$$"
# Turnstile test keys: localhost only
APEX="localhost"
LOCK="/run/lock/sadar-bersuara-deploy.lock"
REAL_DOCKER="$(command -v docker)"
# Release B's healthz lies
BAD="$(printf '0%.0s' {1..40})"
# Release C's Caddy caches sessions
LEAK='header_down Cache-Control "public, max-age=60"'
HOST="$WORK/host"
RUN="$WORK/run"
OVERRIDE="$WORK/compose.override.yaml"
made_lock=0
[[ -e "$LOCK" ]] || made_lock=1
failures=0

step() { printf '== %s\n' "$*"; }
check() {
  local name="$1" got="$2" want="$3"
  if [[ "$got" == *"$want"* ]]; then
    printf 'ok   %s\n' "$name"
  else
    printf 'FAIL %s: got [%s] want [%s]\n' "$name" "$got" "$want"
    failures=$((failures + 1))
  fi
}

# Scratch repos, never this one
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git_new() {
  git -c user.name=deploy-test -c user.email=deploy-test@sb.test \
    -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"
}

compose() {
  APP_REF="${APP_REF:-unused}" POSTGRES_REF="${POSTGRES_REF:-unused}" \
    docker compose -p "$PROJECT" -f "$HOST/infra/compose.yaml" -f "$OVERRIDE" \
    --env-file "$RUN/app.env" "$@"
}

cleanup() {
  if [[ -f "$OVERRIDE" ]]; then
    compose --profile migrate --profile whatsapp --profile backup --profile off \
      down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  # -v: registry's anonymous volume
  docker rm -f -v "$PROJECT-registry" "$PROJECT-a" "$PROJECT-b" "$PROJECT-c" >/dev/null 2>&1 || true
  # Test images, then pulled digests
  for ref in "${IMAGES[@]}"; do docker rmi -f "$ref" >/dev/null 2>&1 || true; done
  for ref in $(docker image ls --digests --format '{{.Repository}}@{{.Digest}}' "$REG/*" 2>/dev/null); do
    docker rmi "$ref" >/dev/null 2>&1 || true
  done
  # Postgres files: uid 999
  docker run --rm --user 0:0 -v "$WORK:/w" --entrypoint rm "$APP" -rf /w/pgdata /w/files >/dev/null 2>&1 || true
  ((made_lock)) && rm -f "$LOCK"
  rm -rf "$WORK"
}
IMAGES=()
trap cleanup EXIT

for port in 5198 "$PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "deploy-test: port $port is in use" >&2
    exit 1
  fi
done

step "registry, as GHCR for deploy.sh"
docker run -d --name "$PROJECT-registry" -p "$REG:5000" "$REGISTRY_IMAGE" >/dev/null
for _ in $(seq 1 30); do
  curl -fs -o /dev/null "http://$REG/v2/" && break
  sleep 1
done

step "host checkout, origin with three commits"
mkdir -p "$WORK/origin" "$RUN" "$WORK/state" "$WORK/bin" "$WORK/edge"
(cd "$REPO" && git ls-files -co --exclude-standard -z -- infra) |
  while IFS= read -r -d '' file; do
    [[ -f "$REPO/$file" ]] && install -D -m "$(stat -c %a "$REPO/$file")" "$REPO/$file" "$WORK/origin/$file"
  done
git_new -C "$WORK/origin" init -q -b main
git_new -C "$WORK/origin" add -A
git_new -C "$WORK/origin" commit -q -m "release A"
A="$(git -C "$WORK/origin" rev-parse HEAD)"
git_new -C "$WORK/origin" commit -q --allow-empty -m "release B"
B="$(git -C "$WORK/origin" rev-parse HEAD)"
sed -i "s|^\t\treverse_proxy web:3000 {\$|&\n\t\t\t$LEAK|" "$WORK/origin/infra/Caddyfile"
grep -qF "$LEAK" "$WORK/origin/infra/Caddyfile"
git_new -C "$WORK/origin" commit -q -am "release C"
C="$(git -C "$WORK/origin" rev-parse HEAD)"
git_new clone -q "$WORK/origin" "$HOST"
git -C "$HOST" checkout -q --detach "$A"

step "images A, B and C, pushed by digest"
# Label and GIT_SHA per release
release() {
  local tag="$1" revision="$2" reports="$3"
  docker create --name "$PROJECT-$tag" "$APP" >/dev/null
  docker commit --change "LABEL org.opencontainers.image.revision=$revision" \
    --change "ENV GIT_SHA=$reports" "$PROJECT-$tag" "$REG/sb-deploy-app:$tag" >/dev/null
  docker rm "$PROJECT-$tag" >/dev/null
  IMAGES+=("$REG/sb-deploy-app:$tag")
  docker push -q "$REG/sb-deploy-app:$tag" >/dev/null
}
release a "$A" "$A"
release b "$B" "$BAD"
release c "$C" "$C"
docker tag "$PG" "$REG/sb-deploy-postgres:pg"
IMAGES+=("$REG/sb-deploy-postgres:pg")
docker push -q "$REG/sb-deploy-postgres:pg" >/dev/null
digest() {
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$1" |
    sed -n "s|^${1%:*}@||p" | head -1
}
APP_A="$(digest "$REG/sb-deploy-app:a")"
APP_B="$(digest "$REG/sb-deploy-app:b")"
APP_C="$(digest "$REG/sb-deploy-app:c")"
PG_D="$(digest "$REG/sb-deploy-postgres:pg")"

hex() { openssl rand -hex 24; }
cat >"$RUN/app.env" <<EOF
APP_IMAGE=$REG/sb-deploy-app
POSTGRES_IMAGE=$REG/sb-deploy-postgres
APEX_HOST=$APEX
WHATSAPP_ENABLED=false
TUNNEL_TOKEN=unused
FILES_ROOT=$WORK/files
PGDATA_ROOT=$WORK/pgdata
POSTGRES_PASSWORD=$(hex)
SB_MIGRATOR_PASSWORD=$(hex)
SB_APP_PASSWORD=$(hex)
SB_MEDIA_PASSWORD=$(hex)
SB_BACKUP_PASSWORD=$(hex)
BETTER_AUTH_SECRETS=1:$(openssl rand -base64 32)
LACAK_LINK_KEYS=1:$(openssl rand -base64 32)
AUDIT_HMAC_KEY=$(openssl rand -base64 32)
WHATSAPP_JOB_KEY=$(openssl rand -base64 32)
WHATSAPP_CREDS_KEY=$(openssl rand -base64 32)
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
EMAIL_FROM=Sadar Bersuara <no-reply@$APEX>
BREVO_API_KEY=unused
CLOUDFLARE_ZONE_ID=unused
CLOUDFLARE_API_TOKEN=unused
HEALTH_BACKUP_CHECKS=false
MEDIA_R2_ENDPOINT=https://r2.invalid
MEDIA_R2_BUCKET=unused
MEDIA_R2_ACCESS_KEY_ID=unused
MEDIA_R2_SECRET_ACCESS_KEY=unused
MEDIA_PUBLIC_ORIGIN=https://media.$APEX
PGBACKREST_REPO1_S3_ENDPOINT=unused
PGBACKREST_REPO1_S3_BUCKET=unused
PGBACKREST_REPO1_S3_KEY=unused
PGBACKREST_REPO1_S3_KEY_SECRET=unused
PGBACKREST_REPO1_CIPHER_PASS=$(openssl rand -hex 32)
RESTIC_REPOSITORY=s3:https://r2.invalid/logs
RESTIC_PASSWORD=$(openssl rand -hex 32)
RESTIC_S3_KEY=unused
RESTIC_S3_KEY_SECRET=unused
GLITCHTIP_DB_PASSWORD=$(hex)
GLITCHTIP_SECRET_KEY=$(hex)
UMAMI_DB_PASSWORD=$(hex)
UMAMI_APP_SECRET=$(hex)
UMAMI_TWO_FACTOR_KEY=$(openssl rand -hex 32)
EOF

# Stack-test's override, plus edge
write_override() {
  cat >"$OVERRIDE" <<EOF
# Written by deploy-test.sh
services:
  caddy:
    ports:
      - "127.0.0.1:$PORT:80"
    networks:
      published: {}
  postgres:
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf", "-c", "archive_mode=off"]
  cloudflared:
    profiles: [off]
  clamav:
    profiles: [off]
  glitchtip:
    profiles: [off]
  umami:
    profiles: [off]
  # Local repo replaces R2
  restic:
    environment:
      RESTIC_REPOSITORY: /repo
    volumes:
      - restic-repo:/repo
  # Stand-in CDN, tunnel's place
  edge:
    image: $CADDY_IMAGE
    volumes:
      - $WORK/edge:/etc/caddy:ro
    networks: [edge]
    depends_on:
      caddy:
        condition: service_started

volumes:
  restic-repo:

networks:
  published:
    ipam:
      config:
        - subnet: 172.31.21.0/28
EOF
}
write_override

step "first setup: directories, database, campuses"
docker run --rm --network none --user 0:0 -v "$WORK:/w" --entrypoint sh "$APP" -c '
  install -d -m 0700 -o 999 -g 999 /w/pgdata/data
  install -d -m 0750 -o 1000 -g 1000 /w/files/evidence /w/files/derived /w/files/scratch
  install -d -m 0755 -o 1000 -g 1000 /w/files/public /w/files/assets'
export APP_REF="$REG/sb-deploy-app@$APP_A" POSTGRES_REF="$REG/sb-deploy-postgres@$PG_D"
compose up -d --wait postgres
compose --profile migrate run --rm migrate
# Dev accounts, test stack only
compose --profile migrate run --rm -e APEX_HOST="$APEX" -e NODE_ENV=development migrate bun db/seed/organizations.ts
mapfile -t HOSTS < <(printf '%s\n' "$APEX"
  compose exec -T -u postgres postgres psql -X -At -d sadar_bersuara -c "SELECT host FROM organizations ORDER BY host")
unset APP_REF POSTGRES_REF

step "stand-in CDN for smoke.ts: ${HOSTS[*]}"
(
  cd "$WORK/edge"
  sans="$(printf 'DNS:%s,' "${HOSTS[@]}")"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 \
    -subj /CN=deploy-test-ca -keyout ca.key -out ca.pem 2>/dev/null
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -subj "/CN=$APEX" -keyout edge.key -out edge.csr 2>/dev/null
  printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\n' "${sans%,}" >edge.ext
  openssl x509 -req -in edge.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 \
    -extfile edge.ext -out edge.pem 2>/dev/null
  chmod 0644 edge.key
  printf '%s %s\n' 127.0.0.1 "${HOSTS[*]}" ::1 "${HOSTS[*]}" >hosts
  https="$(printf 'https://%s, ' "${HOSTS[@]}")"
  plain="$(printf 'http://%s, ' "${HOSTS[@]}")"
  # Checklist answers, cache HIT
  cat >Caddyfile <<EOF
{
	admin off
	auto_https off
	persist_config off
}

${https%, } {
	tls /etc/caddy/edge.pem /etc/caddy/edge.key
	@session header Cookie *
	header @session cf-cache-status BYPASS
	@anonymous not header Cookie *
	header @anonymous cf-cache-status HIT
	reverse_proxy caddy:80 {
		header_up CF-Connecting-IP {remote_host}
	}
}

${plain%, } {
	handle /api/v1* {
		respond 403
	}
	handle {
		redir https://{host}{uri} permanent
	}
}
EOF
)

# Keeps host images, logs prune
cat >"$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-} ${2:-}" == "image prune" ]]; then
  printf '%s\n' "$*" >>"$PRUNE_LOG"
  exit 0
fi
exec "$REAL_DOCKER" "$@"
EOF
chmod +x "$WORK/bin/docker"

# The deploy key's forced command
# Smoke resolves hosts to edge
gate() {
  SSH_ORIGINAL_COMMAND="$*" DEPLOY_ROOT="$HOST" PATH="$WORK/bin:$PATH" \
    REAL_DOCKER="$REAL_DOCKER" PRUNE_LOG="$WORK/pruned" \
    RUN_DIR="$RUN" STATE_DIR="$WORK/state" COMPOSE_PROJECT_NAME="$PROJECT" \
    COMPOSE_OVERRIDE="$OVERRIDE" \
    SMOKE_DOCKER_ARGS="--network container:$PROJECT-edge-1 -v $WORK/edge/hosts:/etc/hosts:ro -v $WORK/edge/ca.pem:/ca.pem:ro -e NODE_EXTRA_CA_CERTS=/ca.pem" \
    "$HOST/infra/deploy-gate.sh"
}

# get host path format
get() {
  curl -s -m 10 -o /dev/null --connect-to "$1:80:127.0.0.1:$PORT" -w "$3" "http://$1$2"
}
healthz() {
  curl -s -m 10 --connect-to "$1:80:127.0.0.1:$PORT" "http://$1/healthz" | jq -r .sha
}
running() {
  docker inspect -f '{{.Config.Image}}' "$(compose ps -q "$1")"
}
HISTORY="$HOST/infra/.deployed-history"
campus="${HOSTS[1]:-$APEX}"

step "release A through deploy-gate.sh"
a_rc=0
gate deploy "$A" "$APP_A" "$PG_D" >"$WORK/a.log" 2>&1 || a_rc=$?
check "release A passes its checks" "exit $a_rc" "exit 0"
check "release A recorded" "$(cat "$HISTORY" 2>/dev/null)" "$A "
check "history pins A by digest" "$(awk -v s="$A" '$1 == s { print $5, $6, $7 }' "$HISTORY" 2>/dev/null)" "deploy $APP_A $PG_D"
check "healthz through caddy reports A" "$(healthz "$campus")" "$A"
check "prune keeps 7 days" "$(cat "$WORK/pruned" 2>/dev/null)" "image prune -af --filter until=168h"
if [[ "$a_rc" != 0 ]]; then
  tail -n 40 "$WORK/a.log"
fi

step "release B, healthz reports another SHA"
b_rc=0
gate deploy "$B" "$APP_B" "$PG_D" >"$WORK/b.log" 2>&1 || b_rc=$?
blog="$(cat "$WORK/b.log")"
check "[AC-DEPLOY-03] B fails on its healthz SHA" "$blog" "healthz reports $BAD, expected $B"
check "[AC-DEPLOY-03] deploy.sh redeploys A" "$blog" "redeploying previous $A"
check "[AC-DEPLOY-03] deploy.sh restores A" "$blog" "rollback $A done"
check "[AC-DEPLOY-03] failed release still exits 1" "exit=$b_rc;" "exit=1;"
check "[AC-DEPLOY-03] web runs A again" "$(running web)" "$REG/sb-deploy-app@$APP_A"
check "[AC-DEPLOY-03] workers run A again" "$(running worker) $(running worker-media)" "$REG/sb-deploy-app@$APP_A $REG/sb-deploy-app@$APP_A"
check "[AC-DEPLOY-03] healthz through caddy reports A" "$(healthz "$campus")" "$A"
check "[AC-DEPLOY-03] history records the rollback" "$(tail -n 1 "$HISTORY" | awk '{ print $1, $5, $6, $7 }')" "$A rollback $APP_A $PG_D"
check "[AC-DEPLOY-03] B never recorded" "$(awk -v s="$B" '$1 == s { n++ } END { print n ? "recorded" : "absent" }' "$HISTORY")" "absent"
check "[AC-DEPLOY-03] campus page answers" "$(get "$campus" / '%{http_code}')" "200"
check "[AC-DEPLOY-03] apex page answers" "$(get "$APEX" / '%{http_code}')" "200"

step "release C, smoke finds cached sessions"
# One line per deploy
lines_before="$(wc -l <"$HISTORY")"
c_rc=0
gate deploy "$C" "$APP_C" "$PG_D" >"$WORK/c.log" 2>&1 || c_rc=$?
clog="$(cat "$WORK/c.log")"
check "[AC-DEPLOY-03] C fails its smoke test" "$clog" "$campus: session cache-control public, max-age=60"
check "[AC-DEPLOY-03] deploy.sh redeploys A after C" "$clog" "redeploying previous $A"
check "[AC-DEPLOY-03] deploy.sh restores A after C" "$clog" "rollback $A done"
check "[AC-DEPLOY-03] failed C still exits 1" "exit=$c_rc;" "exit=1;"
check "[AC-DEPLOY-03] web and workers run A after C" "$(running web) $(running worker) $(running worker-media)" "$REG/sb-deploy-app@$APP_A $REG/sb-deploy-app@$APP_A $REG/sb-deploy-app@$APP_A"
check "[AC-DEPLOY-03] Caddy keeps sessions private again" "$(curl -s -m 10 -o /dev/null --connect-to "$campus:80:127.0.0.1:$PORT" -H "Cookie: __Host-sb.session_token=deploy-test" -w '%header{cache-control}' "http://$campus/")" "no-store"
check "[AC-DEPLOY-03] healthz after C reports A" "$(healthz "$campus")" "$A"
check "[AC-DEPLOY-03] history records the second rollback" "added=$(($(wc -l <"$HISTORY") - lines_before)); $(tail -n 1 "$HISTORY" | awk '{ print $1, $5, $6, $7 }')" "added=1; $A rollback $APP_A $PG_D"
check "[AC-DEPLOY-03] C never recorded" "$(awk -v s="$C" '$1 == s { n++ } END { print n ? "recorded" : "absent" }' "$HISTORY")" "absent"
if ((failures > 0)); then
  tail -n 40 "$WORK/b.log"
  tail -n 40 "$WORK/c.log"
  echo "deploy-test: $failures FAILED"
  exit 1
fi
echo "deploy-test: PASS"
