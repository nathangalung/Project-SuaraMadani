#!/usr/bin/env bash
# Production compose on this machine
# Usage: stack-test.sh <app-image> <postgres-image>
# Caddy on 127.0.0.1:STACK_PORT, default 5199
set -Eeuo pipefail

INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${1:?app image, e.g. suara-madani:local}"
PG="${2:?postgres image, e.g. suara-madani-postgres:local}"
PORT="${STACK_PORT:-5199}"
WORK="$(mktemp -d)"
PROJECT="sm-stack-$$"
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

hex() { openssl rand -hex 24; }
cat >"$WORK/app.env" <<EOF
APP_IMAGE=${APP%:*}
IMAGE_TAG=${APP##*:}
POSTGRES_IMAGE=${PG%:*}
POSTGRES_TAG=${PG##*:}
APEX_HOST=localhost
TUNNEL_TOKEN=unused
FILES_ROOT=$WORK/files
PGDATA_ROOT=$WORK/pgdata
STACK_PORT=$PORT
POSTGRES_PASSWORD=$(hex)
SM_MIGRATOR_PASSWORD=$(hex)
SM_APP_PASSWORD=$(hex)
SM_MEDIA_PASSWORD=$(hex)
SM_BACKUP_PASSWORD=$(hex)
BETTER_AUTH_SECRETS=1:$(openssl rand -base64 32)
LACAK_LINK_KEYS=1:$(openssl rand -base64 32)
AUDIT_HMAC_KEY=$(openssl rand -base64 32)
WHATSAPP_JOB_KEY=$(openssl rand -base64 32)
WHATSAPP_CREDS_KEY=$(openssl rand -base64 32)
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
EMAIL_FROM=Sadar Bersuara <no-reply@localhost>
BREVO_API_KEY=unused
CLOUDFLARE_ZONE_ID=unused
CLOUDFLARE_API_TOKEN=unused
HEALTH_BACKUP_CHECKS=false
MEDIA_R2_ENDPOINT=https://r2.invalid
MEDIA_R2_BUCKET=unused
MEDIA_R2_ACCESS_KEY_ID=unused
MEDIA_R2_SECRET_ACCESS_KEY=unused
MEDIA_PUBLIC_ORIGIN=https://media.localhost
PGBACKREST_REPO1_S3_ENDPOINT=unused
PGBACKREST_REPO1_S3_BUCKET=unused
PGBACKREST_REPO1_S3_KEY=unused
PGBACKREST_REPO1_S3_KEY_SECRET=unused
PGBACKREST_REPO1_CIPHER_PASS=unused
RESTIC_REPOSITORY=unused
RESTIC_PASSWORD=unused
RESTIC_S3_KEY=unused
RESTIC_S3_KEY_SECRET=unused
EOF

compose() {
  docker compose -p "$PROJECT" -f "$INFRA/compose.yaml" \
    -f "$INFRA/compose.stack-test.yaml" --env-file "$WORK/app.env" "$@"
}

cleanup() {
  compose --profile migrate --profile whatsapp down -v --remove-orphans >/dev/null 2>&1 || true
  # Postgres files: uid 999
  docker run --rm --user 0:0 -v "$WORK:/w" --entrypoint rm "$APP" -rf /w/pgdata /w/files >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# get host path format [curl-args]
get() {
  curl -s -o /dev/null --connect-to "$1:80:127.0.0.1:$PORT" "${@:4}" -w "$3" "http://$1$2"
}

step "directories as host-setup makes them"
# host-setup owners, modes, root
docker run --rm --network none --user 0:0 -v "$WORK:/w" --entrypoint sh "$APP" -c '
  install -d -m 0700 -o 999 -g 999 /w/pgdata/data
  install -d -m 0750 -o 1000 -g 1000 /w/files/evidence /w/files/derived /w/files/scratch
  install -d -m 0755 -o 1000 -g 1000 /w/files/public /w/files/assets'

step "database, migrate, seed"
compose up -d --wait postgres
compose --profile migrate run --rm migrate
compose --profile migrate run --rm -e APEX_HOST=localhost migrate bun db/seed/regions.ts
compose --profile migrate run --rm -e APEX_HOST=localhost migrate bun db/seed/organizations.ts

step "assets as deploy.sh copies them"
docker run --rm --network none --read-only --user 1000:1000 \
  -v "$WORK/files/assets:/out" "$APP" sh -c 'cp -R build/client/assets/. /out/'

step "app containers"
compose up -d --wait --wait-timeout 180 web worker worker-media worker-whatsapp caddy

check "healthz through caddy" "$(get itb.localhost "/healthz" '%{http_code}')" "200"
for path in / /isu /data /tentang; do
  check "itb $path" "$(get itb.localhost "$path" '%{http_code}')" "200"
done
check "unknown path 404" "$(get itb.localhost "/tidak-ada" '%{http_code}')" "404"
check "apex national page" "$(get localhost "/" '%{http_code}')" "200"
asset="$(cd "$WORK/files/assets" && find . -name 'entry.client-*.js' | head -1)"
check "asset from volume" \
  "$(get itb.localhost "/assets/${asset#./}" '%{http_code} %header{cache-control}')" "200 public, max-age=31536000, immutable"

step "public media rules"
name="$(printf 'stack' | sha256sum | cut -d' ' -f1)"
docker run --rm --network none --user 1000:1000 -v "$WORK/files/public:/p" --entrypoint sh "$APP" -c \
  "mkdir -p /p/itb.localhost/media && printf RIFF >/p/itb.localhost/media/$name.webp"
check "webp served" \
  "$(get itb.localhost "/media/$name.webp" '%{http_code} %header{content-type} %header{content-security-policy}')" \
  "200 image/webp sandbox; default-src 'none'"
check "other types 404" "$(get itb.localhost "/media/$name.mp4" '%{http_code}')" "404"
check "other host 404" "$(get ugm.localhost "/media/$name.webp" '%{http_code}')" "404"

step "body caps and log hygiene"
head -c 2000000 /dev/zero >"$WORK/big"
check "1 MB cap outside uploads" \
  "$(get itb.localhost "/isu" '%{http_code}' -X POST --data-binary "@$WORK/big")" "413"
# App answers, not Caddy's 413
brief="$(get itb.localhost "/kelola/tuntutan/TUN-ITB-26-0001/unggah" '%{http_code}' -X POST --data-binary "@$WORK/big")"
check "brief upload passes the cap" "$([[ "$brief" == 413 ]] && echo capped || echo passed)" "passed"
get itb.localhost "/isu?q=rahasiapencarian" '%{http_code}' >/dev/null
sleep 1
log="$(compose exec -T caddy cat /var/log/caddy/access.log)"
check "access log has requests" "$log" '"uri":"/isu"'
if [[ "$log" == *rahasiapencarian* || "$log" == *Cookie* ]]; then
  check "query and headers stripped" "leaked" "stripped"
else
  check "query and headers stripped" "stripped" "stripped"
fi

step "hardening"
check "web root read-only" "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$(compose ps -q web)")" "true"
check "web runs as bun" "$(compose exec -T web id -un)" "bun"
check "worker started" "$(compose logs worker)" '"msg":"worker started"'
check "worker-media started" "$(compose logs worker-media)" '"profile":"worker-media"'
check "worker-whatsapp started" "$(compose logs worker-whatsapp)" '"profile":"worker-whatsapp"'
check "web cannot reach media net" \
  "$(compose exec -T web bun -e 'try { await fetch("http://worker-media:1", { signal: AbortSignal.timeout(2000) }); console.log("reached") } catch (e) { console.log("blocked") }')" "blocked"

# CI sets it, needs Chrome
if [[ "${STACK_LIGHTHOUSE:-0}" == "1" ]]; then
  step "lighthouse budgets, PLAN §10.8"
  n=0
  for path in / /isu /data /tuntutan /lapor /tentang; do
    n=$((n + 1))
    # Target device, 4G, RTT 100ms
    # WSL Chrome profile lands here
    (cd "$WORK" && npx -y lighthouse@13.5.0 "http://itb.localhost$path" --quiet \
      --output=json --output-path="$WORK/lh-$n.json" \
      --throttling.rttMs=100 --throttling.throughputKbps=9000 \
      --chrome-flags="--headless=new --no-sandbox --host-resolver-rules=\"MAP *.localhost:80 127.0.0.1:$PORT\"")
  done
  if bun "$INFRA/lighthouse-budget.ts" "$WORK"/lh-*.json; then
    check "lighthouse budgets" "ok" "ok"
  else
    check "lighthouse budgets" "over budget" "ok"
  fi
fi

step "WhatsApp lever, runbook Incident"
bare="$(compose config --services)"
check "worker-whatsapp starts by name only" \
  "$([[ "$bare" == *worker-whatsapp* ]] && echo bare || echo named)" "named"
compose stop worker-whatsapp >/dev/null
check "site up without WhatsApp" "$(get itb.localhost "/healthz" '%{http_code}')" "200"

step "503 while web is down"
compose stop web >/dev/null
check "maintenance page" "$(get itb.localhost "/" '%{http_code} %header{retry-after}')" "503 30"

if ((failures > 0)); then
  echo "stack-test: $failures FAILED"
  exit 1
fi
echo "stack-test: PASS"
