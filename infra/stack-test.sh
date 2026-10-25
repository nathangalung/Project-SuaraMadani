#!/usr/bin/env bash
# Production compose on this machine
# Usage: stack-test.sh <app-ref> <postgres-ref>
# Caddy on 127.0.0.1:STACK_PORT, default 5199
set -Eeuo pipefail

INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${1:?app image, e.g. sadar-bersuara:local}"
PG="${2:?postgres image, e.g. sadar-bersuara-postgres:local}"
PORT="${STACK_PORT:-5199}"
WORK="$(mktemp -d)"
PROJECT="sb-stack-$$"
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
APP_REF=$APP
POSTGRES_REF=$PG
APEX_HOST=localhost
TUNNEL_TOKEN=unused
FILES_ROOT=$WORK/files
PGDATA_ROOT=$WORK/pgdata
STACK_PORT=$PORT
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
GLITCHTIP_DB_PASSWORD=$(hex)
GLITCHTIP_SECRET_KEY=$(hex)
UMAMI_DB_PASSWORD=$(hex)
UMAMI_APP_SECRET=$(hex)
UMAMI_TWO_FACTOR_KEY=$(openssl rand -hex 32)
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
# Dev accounts, test stack only
compose --profile migrate run --rm -e APEX_HOST=localhost -e NODE_ENV=development migrate bun db/seed/organizations.ts

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
# SSR bundle shares the pool
timing="$(get itb.localhost "/isu" '%header{server-timing}')"
[[ "$timing" =~ desc=\"[1-9][0-9]*\ queries\" ]] && timing="counted"
check "Server-Timing counts queries" "$timing" "counted"
check "apex national page" "$(get localhost "/" '%{http_code}')" "200"
check "public data API" \
  "$(get itb.localhost "/api/v1/isu" '%{http_code} %header{access-control-allow-origin} %header{cloudflare-cdn-cache-control}')" \
  "200 * max-age=60, stale-while-revalidate=30, stale-if-error=86400"
check "no public data API on apex" "$(get localhost "/api/v1/data" '%{http_code}')" "404"
asset="$(cd "$WORK/files/assets" && find . -name 'entry.client-*.js' | head -1)"
check "asset from volume" \
  "$(get itb.localhost "/assets/${asset#./}" '%{http_code} %header{cache-control}')" "200 public, max-age=31536000, immutable"

step "public media rules"
name="$(printf 'stack' | sha256sum | cut -d' ' -f1)"
docker run --rm --network none --user 1000:1000 -v "$WORK/files/public:/p" --entrypoint sh "$APP" -c \
  "mkdir -p /p/itb.localhost/media && printf RIFF >/p/itb.localhost/media/$name.webp"
check "webp served" \
  "$(get itb.localhost "/media/$name.webp" '%{http_code} %header{content-type} %header{content-security-policy}')" \
  "200 image/webp sandbox; default-src 'none'; frame-ancestors 'none'"
check "other types 404" "$(get itb.localhost "/media/$name.mp4" '%{http_code}')" "404"
check "other host 404" "$(get ugm.localhost "/media/$name.webp" '%{http_code}')" "404"
# ASVS V3.4: Caddy-made responses
for path in "/media/$name.mp4" /stats/x /assets/none.js; do
  check "$path headers" \
    "$(get itb.localhost "$path" '%header{x-content-type-options} %header{content-security-policy} %header{strict-transport-security}')" \
    "nosniff default-src 'none'; frame-ancestors 'none' max-age=300"
done

step "body caps and log hygiene"
head -c 2000000 /dev/zero >"$WORK/big"
check "[AC-STACK-01] 1 MB cap outside uploads" \
  "$(get itb.localhost "/isu" '%{http_code}' -X POST --data-binary "@$WORK/big")" "413"
# App answers, not Caddy's 413
brief="$(get itb.localhost "/kelola/tuntutan/TUN-ITB-26-0001/unggah" '%{http_code}' -X POST --data-binary "@$WORK/big")"
check "brief upload passes the cap" "$([[ "$brief" == 413 ]] && echo capped || echo passed)" "passed"
get itb.localhost "/isu?q=rahasiapencarian" '%{http_code}' -H 'Cf-Ray: 8f1e2d3c4b5a6978-CGK' >/dev/null
sleep 1
log="$(compose exec -T caddy cat /var/log/caddy/access.log)"
check "access log has requests" "$log" '"uri":"/isu"'
# Joins app req_id
check "access log keeps cf_ray" "$log" '"cf_ray":"8f1e2d3c4b5a6978-CGK"'
if [[ "$log" == *rahasiapencarian* || "$log" == *Cookie* ]]; then
  check "query and headers stripped" "leaked" "stripped"
else
  check "query and headers stripped" "stripped" "stripped"
fi

step "hardening"
check "[AC-STACK-03] web root read-only" "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$(compose ps -q web)")" "true"
check "web runs as bun" "$(compose exec -T web id -un)" "bun"
check "worker started" "$(compose logs worker)" '"msg":"worker started"'
check "worker-media started" "$(compose logs worker-media)" '"profile":"worker-media"'
check "worker-whatsapp started" "$(compose logs worker-whatsapp)" '"profile":"worker-whatsapp"'
check "web cannot reach media net" \
  "$(compose exec -T web bun -e 'try { await fetch("http://worker-media:1", { signal: AbortSignal.timeout(2000) }); console.log("reached") } catch (e) { console.log("blocked") }')" "blocked"

# CI sets it, needs Chrome
if [[ "${STACK_LIGHTHOUSE:-0}" == "1" ]]; then
  step "lighthouse budgets, PLAN §10.8"
  "$INFRA/lighthouse.sh" "$PORT" "$WORK" / /isu /data /tuntutan /lapor /tentang
  if bun "$INFRA/lighthouse-budget.ts" "$WORK"/lh-*.json; then
    check "lighthouse budgets" "ok" "ok"
  else
    check "lighthouse budgets" "over budget" "ok"
  fi
fi

step "process and file limits, API4"
for pair in web=512 worker-media=512 postgres=1024; do
  svc="${pair%%=*}"
  check "$svc pids and nofile capped" \
    "$(docker inspect -f '{{.HostConfig.PidsLimit}} {{range .HostConfig.Ulimits}}{{.Name}}={{.Hard}}{{end}}' "$(compose ps -q "$svc")")" "${pair#*=} nofile=65536"
done

step "WhatsApp lever, runbook Incident"
bare="$(compose config --services)"
check "worker-whatsapp starts by name only" \
  "$([[ "$bare" == *worker-whatsapp* ]] && echo bare || echo named)" "named"
compose stop worker-whatsapp >/dev/null
check "site up without WhatsApp" "$(get itb.localhost "/healthz" '%{http_code}')" "200"

step "GlitchTip and Umami, PLAN Fase 2"
# First boot runs their migrations
compose up -d --wait --wait-timeout 300 glitchtip umami
check "glitchtip healthy, no Valkey" \
  "[$(compose exec -T glitchtip printenv VALKEY_URL)] $(compose ps --format '{{.Health}}' glitchtip)" "[] healthy"
check "glitchtip own database" \
  "$(compose exec -T -u postgres postgres psql -X -At -c "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'glitchtip'")" "glitchtip"
# Container expands the password
# shellcheck disable=SC2016
check "app role cannot open it" \
  "$(compose exec -T postgres sh -c 'PGPASSWORD="$SB_APP_PASSWORD" psql -X -h 127.0.0.1 -U sb_app -d glitchtip -c "SELECT 1" 2>&1' || true)" "permission denied"
check "postgres logs no DETAIL" \
  "$(compose exec -T -u postgres postgres psql -X -At -c 'SHOW log_error_verbosity')" "terse"
# pg-hba: per role, per network
check "app role refused from stats" \
  "$(docker run --rm --network "${PROJECT}_stats" -e PGPASSWORD="$(sed -n 's/^SB_APP_PASSWORD=//p' "$WORK/app.env")" \
    --entrypoint psql "$PG" -X -h postgres -U sb_app -d sadar_bersuara -c 'SELECT 1' 2>&1 || true)" "pg_hba.conf rejects"
# Project and key, pinned models
key="$(compose exec -T glitchtip python manage.py shell -c '
from apps.organizations_ext.models import Organization
from apps.projects.models import Project, ProjectKey
org = Organization.objects.create(name="Stack")
project = Project.objects.create(name="web", organization=org, platform="node")
key = ProjectKey.objects.filter(project=project).first() or ProjectKey.objects.create(project=project)
print(f"{project.id}:{key.public_key.hex}")' 2>/dev/null | tail -n 1)"
compose exec -T -e ERROR_REPORTING=true -e "GLITCHTIP_DSN=http://${key#*:}@glitchtip:8000/${key%%:*}" web bun -e '
  const { errorReporterFromEnv } = await import("./server/error-report.ts")
  const reporter = errorReporterFromEnv(process.env, "web")
  reporter.report({ msg: "stack test", error: "Error", message: "from stack-test warga@contoh.id" })
  await reporter.flush()' >/dev/null
sleep 3
check "reporter scrubs, GlitchTip stores" \
  "$(compose exec -T -u postgres postgres psql -X -At -d glitchtip -c "SELECT title FROM issue_events_issue")" "Error: from stack-test [email]"
# Real SSR error, built bundle
ERROR_REPORTING=true GLITCHTIP_DSN="http://${key#*:}@glitchtip:8000/${key%%:*}" \
  compose up -d --wait --wait-timeout 120 web >/dev/null
check "cross-origin action refused" \
  "$(get itb.localhost "/lapor/periksa.data" '%{http_code}' -X POST -H 'Origin: https://lain.invalid' --data 'a=1')" "400"
sleep 3
check "SSR error reaches GlitchTip" \
  "$(compose exec -T -u postgres postgres psql -X -At -d glitchtip -c "SELECT title FROM issue_events_issue")" "Error: Bad Request"
check "web trusts Caddy's fixed address" \
  "$(docker inspect -f "{{(index .NetworkSettings.Networks \"${PROJECT}_app\").IPAddress}}" "$(compose ps -q caddy)") $(compose exec -T web printenv TRUSTED_PROXY_IP)" "172.31.11.10 172.31.11.10"
# Distinct spoofed IPs, one bucket
check "[AC-STACK-02] glitchtip cannot forge X-Client-IP" \
  "$(compose exec -T glitchtip python -c '
import urllib.request, urllib.error
codes = []
for i in range(125):
    req = urllib.request.Request("http://web:3000/api/v1/isu", headers={"Host": "itb.localhost", "X-Client-IP": f"10.9.{i // 250}.{i % 250 + 1}"})
    try:
        codes.append(urllib.request.urlopen(req, timeout=5).status)
    except urllib.error.HTTPError as e:
        codes.append(e.code)
print("limited" if 429 in codes else "spoofed")')" "limited"
# By address: host DNS search
web_ip="$(docker inspect -f "{{(index .NetworkSettings.Networks \"${PROJECT}_app\").IPAddress}}" "$(compose ps -q web)")"
check "umami cannot reach web" \
  "$(compose exec -T umami curl -s -m 3 -o /dev/null -w '%{http_code}' "http://$web_ip:3000/healthz" || true)" "000"
check "caddy reaches web there" \
  "$(compose exec -T caddy wget -q -O /dev/null -S "http://$web_ip:3000/healthz" 2>&1 | head -n 1)" "200"
check "worker-media reaches GlitchTip" \
  "$(compose exec -T worker-media bun -e 'const r = await fetch("http://glitchtip:8000/_health/"); console.log(r.status)')" "200"
check "umami tracker same origin" \
  "$(get itb.localhost "/stats/script.js" '%{http_code} %header{content-type}')" "200 application/javascript"
tracker="$(get itb.localhost "/stats/script.js" '%header{x-content-type-options} %header{content-security-policy}')"
[[ "$tracker" == "nosniff "*"frame-ancestors 'none'"* ]] && tracker="headed"
check "umami tracker headers" "$tracker" "headed"
check "umami tracker GET only" \
  "$(get itb.localhost "/stats/script.js" '%{http_code}' -X POST --data x)" "404"
check "umami UI not public" "$(get itb.localhost "/stats/" '%{http_code}')" "404"
check "umami API not public" "$(get itb.localhost "/stats/api/websites" '%{http_code}')" "404"
token="$(compose exec -T umami curl -fsS -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"umami"}' http://127.0.0.1:3000/api/auth/login | jq -r .token)"
site="$(compose exec -T umami curl -fsS -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
  -d '{"name":"Stack","domain":"itb.localhost"}' http://127.0.0.1:3000/api/websites | jq -r .id)"
event="{\"type\":\"event\",\"payload\":{\"website\":\"$site\",\"hostname\":\"itb.localhost\",\"url\":\"/isu\",\"language\":\"id-ID\",\"screen\":\"1280x720\",\"title\":\"Isu\"}}"
check "page view through caddy" \
  "$(get itb.localhost "/stats/api/send" '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0' --data "$event")" "200"
check "page view stored" \
  "$(compose exec -T -u postgres postgres psql -X -At -d umami -c "SELECT url_path FROM website_event")" "/isu"
# Old copies, then the prune
old="00000000-0000-4000-8000-0000000000aa"
compose exec -T -u postgres postgres psql -X -q -v ON_ERROR_STOP=1 -d umami -c "
  INSERT INTO \"session\" SELECT (jsonb_populate_record(NULL::\"session\", to_jsonb(s)
    || jsonb_build_object('session_id', '$old', 'created_at', now() - interval '14 months'))).* FROM \"session\" s LIMIT 1;
  INSERT INTO website_event SELECT (jsonb_populate_record(NULL::website_event, to_jsonb(e)
    || jsonb_build_object('event_id', gen_random_uuid(), 'session_id', '$old', 'url_path', '/lama',
      'created_at', now() - interval '14 months'))).* FROM website_event e LIMIT 1" >/dev/null
compose exec -T -u postgres postgres psql -X -q -v ON_ERROR_STOP=1 -d umami <"$INFRA/umami-prune.sql" >/dev/null
check "umami keeps 13 months" \
  "$(compose exec -T -u postgres postgres psql -X -At -d umami -c "SELECT string_agg(url_path, ',') || ' ' || (SELECT count(*) FROM \"session\" WHERE session_id = '$old') FROM website_event")" "/isu 0"
check "umami root read-only" "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$(compose ps -q umami)")" "true"
# Runbook SSH forward targets these
check "glitchtip UI on ops address" \
  "$(curl -s -m 5 -H 'Host: localhost:8000' http://172.31.17.10:8000/_health/)" "ok"
check "umami UI on ops address" \
  "$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://172.31.17.11:3000/api/heartbeat)" "200"
# V13.2.5: internal networks only
check "umami has no Internet" \
  "$(compose exec -T umami curl -s -m 5 -o /dev/null -w '%{http_code}' https://example.com || true)" "000"
check "glitchtip has no Internet" \
  "$(compose exec -T glitchtip python -c "import urllib.request
try:
    urllib.request.urlopen('https://example.com', timeout=5)
    print('reached')
except Exception:
    print('blocked')" || true)" "blocked"
# Own egress networks route out
for svc in web worker; do
  check "$svc reaches the Internet" \
    "$(compose exec -T "$svc" bun -e "await fetch('https://example.com', { signal: AbortSignal.timeout(8000) }).then(() => console.log('reached'), () => console.log('blocked'))" || true)" "reached"
done
check "migrate has no Internet" \
  "$(compose --profile migrate run --rm --no-deps migrate bun -e "await fetch('https://example.com', { signal: AbortSignal.timeout(5000) }).then(() => console.log('reached'), () => console.log('blocked'))" 2>/dev/null || true)" "blocked"

step "503 while web is down"
compose stop web >/dev/null
check "maintenance page" "$(get itb.localhost "/" '%{http_code} %header{retry-after}')" "503 30"

if ((failures > 0)); then
  echo "stack-test: $failures FAILED"
  exit 1
fi
echo "stack-test: PASS"
