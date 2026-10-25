#!/usr/bin/env bash
# Usage: osv-scan.sh lockfile|image <target>
# Blocks only fixable high findings
set -Eeuo pipefail

INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
kind="${1:-}"
target="${2:-}"
# OSV_REPORT keeps it for upload
if [[ -n "${OSV_REPORT:-}" ]]; then
  report="$OSV_REPORT"
else
  report="$(mktemp)"
  trap 'rm -f "$report"' EXIT
fi

case "$kind" in
  lockfile) args=(scan source --lockfile "$target") ;;
  image) args=(scan image "$target") ;;
  *)
    echo "usage: osv-scan.sh lockfile|image <target>" >&2
    exit 2
    ;;
esac

rc=0
osv-scanner "${args[@]}" --config "$INFRA/../osv-scanner.toml" \
  --format json --output-file "$report" || rc=$?
# Exit above 1: scanner error
((rc <= 1)) || exit "$rc"
bun "$INFRA/osv-gate.ts" "$report" "$kind $target"
# OSV skips short git commits
if [[ "$kind" == lockfile ]]; then
  bun "$INFRA/osv-commits.ts" "$target"
fi
