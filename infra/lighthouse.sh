#!/usr/bin/env bash
# Lighthouse runs, CPU calibrated
# Usage: lighthouse.sh <port> <out-dir> <path>...
# Writes lh-N-R.json, 3 runs each
set -Eeuo pipefail

INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:?port, e.g. 5198}"
OUT="${2:?output directory}"
shift 2
(($# > 0)) || { echo "lighthouse.sh: no paths" >&2; exit 2; }

run() {
  local path="$1" file="$2"
  shift 2
  # Target device, 4G, RTT 100ms
  # WSL Chrome profile lands here
  (cd "$OUT" && bunx --bun lighthouse@13.5.0 "http://itb.localhost$path" --quiet \
    --output=json --output-path="$file" \
    --throttling.rttMs=100 --throttling.throughputKbps=9000 "$@" \
    --chrome-flags="--headless=new --no-sandbox --host-resolver-rules=\"MAP *.localhost:80 127.0.0.1:$PORT\"")
}

# Slowdown matches the host
run "$1" "$OUT/calibrate.json"
read -r multiplier index < <(bun "$INFRA/lighthouse-budget.ts" --multiplier "$OUT/calibrate.json")
[[ -n "${multiplier:-}" ]] || { echo "lighthouse.sh: calibration failed" >&2; exit 1; }
echo "lighthouse: benchmarkIndex $index, CPU slowdown ${multiplier}x"

# Budget reads the median
runs="${LH_RUNS:-3}"
n=0
for path in "$@"; do
  n=$((n + 1))
  for r in $(seq 1 "$runs"); do
    run "$path" "$OUT/lh-$n-$r.json" --throttling.cpuSlowdownMultiplier="$multiplier"
  done
done
