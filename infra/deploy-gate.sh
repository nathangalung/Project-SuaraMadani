#!/usr/bin/env bash
# authorized_keys forced command, SHA only
# command="/opt/suara-madani/infra/deploy-gate.sh",restrict
set -Eeuo pipefail

ROOT="${DEPLOY_ROOT:-/opt/suara-madani}"
read -r action sha extra <<<"${SSH_ORIGINAL_COMMAND:-}"

[[ -z "${extra:-}" && "${sha:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "usage: deploy <sha> | rollback <sha>" >&2
  exit 2
}

# Scripts, compose match image
git -C "$ROOT" fetch --quiet origin main
git -C "$ROOT" cat-file -e "$sha^{commit}"
git -C "$ROOT" merge-base --is-ancestor "$sha" origin/main
git -C "$ROOT" checkout --quiet --detach "$sha"

case "$action" in
  deploy) exec "$ROOT/infra/deploy.sh" "$sha" ;;
  rollback) exec "$ROOT/infra/deploy.sh" rollback "$sha" ;;
  *)
    echo "unknown action" >&2
    exit 2
    ;;
esac
