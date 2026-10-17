#!/usr/bin/env bash
# Usage: deploy.sh [rollback] <sha>
# Called through deploy-gate.sh only
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

HISTORY="$INFRA/.deployed-history"
# Applied migrations, even failed deploys
MIGRATED="$INFRA/.migrated-history"
LOCK="/run/lock/suara-madani-deploy.lock"
STATE_DIR="${STATE_DIR:-/var/lib/suara-madani}"
SHA_RE='^[0-9a-f]{40}$'

usage() {
  echo "usage: deploy.sh <sha> | deploy.sh rollback <sha>" >&2
  exit 2
}

mode="deploy"
if [[ "${1:-}" == "rollback" ]]; then
  mode="rollback"
  shift
fi
sha="${1:-}"
[[ "$sha" =~ $SHA_RE ]] || usage

exec 9>"$LOCK"
flock -n 9 || die "another deploy is running"

load_env
render_tunnel_config
mapfile -t SERVICES < <(app_services)
app_image="$(env_get APP_IMAGE)"
files_root="$(env_get FILES_ROOT)"
files_root="${files_root:-/mnt/files}"
[[ -n "$app_image" ]] || die "APP_IMAGE missing"
image="$app_image:$sha"
export IMAGE_TAG="$sha"

# Newest tag, newest contract index
migration_info() {
  docker run --rm --network none "$1" bun -e '
    const j = await Bun.file("db/migrations/meta/_journal.json").json()
    const last = j.entries.at(-1)
    const contract = j.entries.filter((e) => e.tag.endsWith("_contract"))
    console.log(last.tag, contract.length ? contract.at(-1).idx : -1)'
}

pgboss_of() {
  docker image inspect --format '{{index .Config.Labels "org.suaramadani.pg-boss"}}' "$1" 2>/dev/null || true
}

running_image() {
  docker inspect --format '{{.Config.Image}}' "$(compose ps -q web)" 2>/dev/null || true
}

# Refuse targets before a contract
check_rollback_target() {
  local target_idx="$1" applied=-1 idx
  [[ -f "$HISTORY" ]] || die "no deploy history"
  while read -r _ _ _ idx _; do
    ((idx > applied)) && applied="$idx"
  done < <(cat "$HISTORY" "$MIGRATED" 2>/dev/null)
  if ((target_idx < applied)); then
    local oldest
    oldest="$(awk -v c="$applied" '$3 ~ /^[0-9]+_/ && substr($3, 1, 4) + 0 >= c { print $1; exit }' "$HISTORY")"
    die "target predates contract migration $applied, oldest allowed: ${oldest:-none}"
  fi
}

copy_assets() {
  # Refresh mtimes, prune after 7d
  docker run --rm --network none --read-only --user 1000:1000 \
    -v "$files_root/assets:/out" "$image" \
    sh -c 'cp -R build/client/assets/. /out/ && find /out -type f -mtime +7 -delete'
}

# Recreate Caddy on config change
restart_changed_config() {
  local sum
  sum="$(cat "$INFRA/Caddyfile" "$INFRA/503.html" | sha256sum | cut -d' ' -f1)"
  install -d -m 0750 "$STATE_DIR"
  if [[ "$(cat "$STATE_DIR/caddy.sum" 2>/dev/null || true)" != "$sum" ]]; then
    compose up -d --force-recreate --no-deps caddy
    echo "$sum" >"$STATE_DIR/caddy.sum"
  fi
}

healthz_sha() {
  compose exec -T web bun -e '
    const r = await fetch("http://127.0.0.1:3000/healthz")
    console.log((await r.json()).sha)'
}

tenant_hosts() {
  local apex
  apex="$(env_get APEX_HOST)"
  echo "$apex"
  compose exec -T -u postgres postgres psql -X -At -d suara_madani \
    -c "SELECT host FROM organizations ORDER BY host"
}

smoke() {
  local hosts
  mapfile -t hosts < <(tenant_hosts)
  docker run --rm -v "$INFRA/smoke.ts:/app/smoke.ts:ro" "$image" \
    bun smoke.ts "${hosts[@]}"
}

previous_sha() {
  [[ -f "$HISTORY" ]] || return 0
  awk -v s="$sha" '$1 != s { last = $1 } END { print last }' "$HISTORY"
}

# EXIT trap catches die too
finished=0
on_exit() {
  local rc=$? prev
  ((finished)) && return 0
  prev="$(previous_sha)"
  log "$mode of $sha failed, exit $rc"
  if [[ "$mode" == "deploy" && -n "$prev" ]]; then
    # Guard refuses pre-contract targets
    log "redeploying previous $prev"
    flock -u 9
    # Its compose, configs, Postgres tag
    git -C "$ROOT" checkout --quiet --detach "$prev" || exit 1
    exec "$INFRA/deploy.sh" rollback "$prev"
  fi
  exit 1
}

start="$(date -u +%FT%TZ)"
log "$mode $sha start $start"
compose pull --quiet "${SERVICES[@]}"
read -r newest_tag contract_idx < <(migration_info "$image")

if [[ "$mode" == "rollback" ]]; then
  check_rollback_target "$((10#${newest_tag%%_*}))"
fi

trap on_exit EXIT

if [[ "$mode" == "deploy" ]]; then
  current="$(running_image)"
  if [[ -n "$current" && "$(pgboss_of "$current")" != "$(pgboss_of "$image")" ]]; then
    log "pg-boss changed, stopping workers"
    compose stop worker worker-media worker-whatsapp
  fi
  compose --profile migrate run --rm migrate
  echo "$sha $start $newest_tag $contract_idx migrated" >>"$MIGRATED"
fi

copy_assets
# WhatsApp lever stays off
if [[ " ${SERVICES[*]} " != *" worker-whatsapp "* ]]; then
  compose stop worker-whatsapp
fi
# worker-media waits for clamd
compose up -d
# Covers clamav start_period 300s
compose up -d --wait --wait-timeout 420 "${SERVICES[@]}"
restart_changed_config

live="$(healthz_sha)"
[[ "$live" == "$sha" ]] || die "healthz reports $live, expected $sha"
smoke

finished=1
echo "$sha $start $newest_tag $contract_idx $mode" >>"$HISTORY"
# Local images kept 7 days
docker image prune -af --filter "until=168h" >/dev/null
log "$mode $sha done"
