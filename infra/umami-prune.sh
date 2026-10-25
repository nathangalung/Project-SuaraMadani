#!/usr/bin/env bash
# Umami data past retention
# Timer monthly, Asia/Jakarta
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_env
compose exec -T -u postgres postgres psql -X -v ON_ERROR_STOP=1 -d umami \
  <"$INFRA/umami-prune.sql"
log "umami rows older than 13 months removed"
