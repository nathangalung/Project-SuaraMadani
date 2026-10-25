#!/usr/bin/env bash
# authorized_keys forced command, SHA only
# command="/opt/sadar-bersuara/infra/deploy-gate.sh",restrict
set -Eeuo pipefail

ROOT="${DEPLOY_ROOT:-/opt/sadar-bersuara}"
read -r action sha app pg extra <<<"${SSH_ORIGINAL_COMMAND:-}"
DIGEST_RE='^sha256:[0-9a-f]{64}$'

bad() {
  echo "usage: deploy <sha> <app-digest> <pg-digest> | rollback <sha>" >&2
  exit 2
}

[[ -z "${extra:-}" && "${sha:-}" =~ ^[0-9a-f]{40}$ ]] || bad
case "$action" in
  # SC-04: digests from build job
  deploy) [[ "${app:-}" =~ $DIGEST_RE && "${pg:-}" =~ $DIGEST_RE ]] || bad ;;
  rollback) [[ -z "${app:-}" && -z "${pg:-}" ]] || bad ;;
  *) bad ;;
esac

# Scripts, compose match image
git -C "$ROOT" fetch --quiet origin main
git -C "$ROOT" cat-file -e "$sha^{commit}"
git -C "$ROOT" merge-base --is-ancestor "$sha" origin/main
git -C "$ROOT" checkout --quiet --detach "$sha"

if [[ "$action" == deploy ]]; then
  exec "$ROOT/infra/deploy.sh" "$sha" "$app" "$pg"
fi
exec "$ROOT/infra/deploy.sh" rollback "$sha"
