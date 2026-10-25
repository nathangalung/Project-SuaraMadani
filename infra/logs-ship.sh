#!/usr/bin/env bash
# Usage: logs-ship.sh [auto|ship|prune]
# Hourly timer, ASVS V16.4.3
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

task="${1:-auto}"
# Deploy passes a short wait
retry_lock="${RESTIC_RETRY_LOCK:-30m}"
load_env

# One stdin snapshot per source
to_restic() {
  compose --profile backup run --rm -T --no-deps restic backup --retry-lock "$retry_lock" \
    --host sadar-bersuara --tag logs --stdin --stdin-filename "$1"
}

# Minutes since the last success
last_ship_age() {
  compose exec -T -u postgres postgres psql -X -qAt -d sadar_bersuara \
    -c "SELECT coalesce(ceil(extract(epoch FROM now() - max(finished_at)) / 60), 0)::int FROM backup_runs WHERE kind = 'logs'"
}

# Window from the last start
window_until_now() {
  local age="$1" start="$2"
  ship_window "$((10#$age + ($(date -u +%s) - start + 59) / 60))"
}

ship() {
  local stamp start started age minutes
  stamp="$(date -u +%Y%m%dT%H%M)"
  # Next window starts here
  start="$(date -u +%s)"
  started="$(date -u -d "@$start" +%FT%TZ)"
  # Postgres down: one hour
  age="$(last_ship_age)" || age=0
  [[ "$age" =~ ^[0-9]+$ ]] || die "bad log age $age"
  compose --profile backup run --rm -T --no-deps restic cat config \
    >/dev/null 2>&1 || compose --profile backup run --rm -T --no-deps restic init
  local services=()
  mapfile -t services < <(app_services)
  # Overlap: restic dedups repeats
  minutes="$(window_until_now "$age" "$start")"
  compose logs --no-color --no-log-prefix --timestamps --since "${minutes}m" \
    "${services[@]}" postgres | to_restic "app-$stamp.log"
  # Lock waits widen the window
  minutes="$(window_until_now "$age" "$start")"
  compose exec -T caddy sh -s -- /var/log/caddy "$minutes" \
    <"$INFRA/caddy-logs.sh" | to_restic "caddy-$stamp.log"
  record_backup logs "$started"
}

# Caddy IPs: 30 days
prune() {
  compose --profile backup run --rm -T --no-deps restic forget --retry-lock "$retry_lock" \
    --host sadar-bersuara --tag logs --keep-within 30d --prune
}

case "$task" in
  ship) ship ;;
  prune) prune ;;
  auto)
    ship
    # Once a day, 03 WIB
    [[ "$(TZ=Asia/Jakarta date +%H)" == "03" ]] && prune
    ;;
  *) die "unknown task $task" ;;
esac
log "logs $task done"
