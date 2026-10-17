# shellcheck shell=bash
# Shared by deploy, backup scripts

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA="$ROOT/infra"
# tmpfs, plaintext never on disk
RUN_DIR="${RUN_DIR:-/run/suara-madani}"
SECRETS="$INFRA/.env.sops"
SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-/mnt/pgdata/keys/age.key}"
export RUN_DIR SOPS_AGE_KEY_FILE

log() {
  printf '{"t":"%s","script":"%s","msg":"%s"}\n' \
    "$(date -u +%FT%TZ)" "$(basename "$0")" "$*" >&2
}

die() {
  log "error: $*"
  exit 1
}

# Decrypt once per boot
load_env() {
  if [[ ! -s "$RUN_DIR/app.env" ]]; then
    [[ -r "$SOPS_AGE_KEY_FILE" ]] || die "age key missing, unlock volumes first"
    install -d -m 0700 "$RUN_DIR"
    (
      umask 077
      sops --decrypt --input-type dotenv --output-type dotenv "$SECRETS" \
        >"$RUN_DIR/app.env.tmp"
    )
    mv "$RUN_DIR/app.env.tmp" "$RUN_DIR/app.env"
  fi
}

# One value, never sourced
env_get() {
  local line
  line="$(grep -m1 "^$1=" "$RUN_DIR/app.env" || true)"
  printf '%s' "${line#*=}"
}

# Fills APEX_HOST into ingress
render_tunnel_config() {
  local apex
  apex="$(env_get APEX_HOST)"
  [[ "$apex" =~ ^[a-z0-9.-]+$ ]] || die "bad APEX_HOST"
  (
    umask 022
    sed "s/APEX_HOST/$apex/g" "$INFRA/cloudflared.yml" \
      >"$RUN_DIR/cloudflared.yml"
  )
}

# App services, WhatsApp lever honoured
app_services() {
  printf '%s\n' web worker worker-media
  # Runbook: WHATSAPP_ENABLED=false
  [[ "$(env_get WHATSAPP_ENABLED)" == "false" ]] || printf '%s\n' worker-whatsapp
}

# Last good deploy, unless deploying
current_tag() {
  [[ -f "$INFRA/.deployed-history" ]] || die "nothing deployed yet"
  tail -n 1 "$INFRA/.deployed-history" | cut -d' ' -f1
}

# Content tag, same in CI
postgres_tag() {
  local sum
  sum="$(cd "$INFRA" && cat postgres.Dockerfile initdb.sql postgresql.conf \
    pg-hba.conf pgbackrest.conf | sha256sum | cut -c1-16)"
  printf 'pg-%s' "$sum"
}

compose() {
  IMAGE_TAG="${IMAGE_TAG:-$(current_tag)}" \
    POSTGRES_TAG="${POSTGRES_TAG:-$(postgres_tag)}" \
    docker compose -f "$INFRA/compose.yaml" --env-file "$RUN_DIR/app.env" "$@"
}

# Superuser socket, then backup role
record_backup() {
  local kind="$1" finished="${2:-}"
  local value="now()"
  if [[ -n "$finished" ]]; then
    [[ "$finished" =~ ^[0-9T:.Z-]+$ ]] || die "bad timestamp"
    value="'$finished'::timestamptz"
  fi
  compose exec -T -u postgres postgres psql -X -q -v ON_ERROR_STOP=1 \
    -d suara_madani \
    -c "SET ROLE sm_backup" \
    -c "INSERT INTO backup_runs (kind, finished_at) VALUES ('$kind', $value)"
}
