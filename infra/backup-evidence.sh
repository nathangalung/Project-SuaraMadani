#!/usr/bin/env bash
# Usage: backup-evidence.sh [auto|backup|prune|check]
# Timer every 6 h, Asia/Jakarta
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

task="${1:-auto}"
load_env
restic() {
  compose --profile backup run --rm --no-deps restic "$@"
}

backup() {
  # Creates the repository once
  restic cat config >/dev/null 2>&1 || restic init
  restic backup --host suara-madani --tag evidence \
    --exclude /files/scratch --exclude /files/assets /files
  record_backup restic
}

prune() {
  restic forget --host suara-madani --tag evidence \
    --keep-daily 14 --keep-weekly 8 --keep-monthly 3 --prune
}

check() {
  restic check --read-data-subset=5%
}

case "$task" in
  backup) backup ;;
  prune) prune ;;
  check) check ;;
  auto)
    backup
    hour="$(TZ=Asia/Jakarta date +%H)"
    # First run of the day
    if ((10#$hour < 6)); then
      [[ "$(TZ=Asia/Jakarta date +%u)" == "7" ]] && prune
      [[ "$(TZ=Asia/Jakarta date +%d)" == "01" ]] && check
    fi
    ;;
  *) die "unknown task $task" ;;
esac
log "evidence $task done"
