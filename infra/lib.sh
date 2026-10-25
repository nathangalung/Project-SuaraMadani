# shellcheck shell=bash
# Shared by deploy, backup scripts

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA="$ROOT/infra"
# tmpfs, plaintext never on disk
RUN_DIR="${RUN_DIR:-/run/sadar-bersuara}"
SECRETS="$INFRA/.env.sops"
# Lines end with both digests
DEPLOYED_HISTORY="${DEPLOYED_HISTORY:-$INFRA/.deployed-history}"
DIGEST_RE='^sha256:[0-9a-f]{64}$'
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

# Random passes: pgBackRest never stretches
check_backup_passes() {
  local name value
  for name in PGBACKREST_REPO1_CIPHER_PASS RESTIC_PASSWORD; do
    value="$(env_get "$name")"
    ((${#value} >= 40)) || die "$name needs 40+ random characters"
  done
}

# ASVS V12.3.1: no plaintext keys
check_tls_endpoints() {
  [[ "$(env_get MEDIA_R2_ENDPOINT)" == https://* ]] ||
    die "MEDIA_R2_ENDPOINT must start with https://"
  [[ "$(env_get RESTIC_REPOSITORY)" == s3:https://* ]] ||
    die "RESTIC_REPOSITORY must start with s3:https://"
}

# OWASP A07: vendor default login
umami_default_active() {
  local code
  code="$(compose exec -T umami curl -s -o /dev/null -m 5 -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"umami"}' \
    http://127.0.0.1:3000/api/auth/login || true)"
  [[ "$code" == 200 ]]
}

# App services, WhatsApp lever honoured
app_services() {
  printf '%s\n' web worker worker-media
  # Runbook: WHATSAPP_ENABLED=false
  [[ "$(env_get WHATSAPP_ENABLED)" == "false" ]] || printf '%s\n' worker-whatsapp
}

# SC-04: image@digest from history
# Usage: deployed_ref app|postgres [sha]
deployed_ref() {
  local which="$1" sha="${2:-}" line digest name
  [[ -f "$DEPLOYED_HISTORY" ]] || die "nothing deployed yet"
  if [[ -n "$sha" ]]; then
    line="$(awk -v s="$sha" '$1 == s { last = $0 } END { print last }' "$DEPLOYED_HISTORY")"
  else
    line="$(tail -n 1 "$DEPLOYED_HISTORY")"
  fi
  case "$which" in
    app) digest="$(cut -d' ' -f6 <<<"$line")" name=APP_IMAGE ;;
    postgres) digest="$(cut -d' ' -f7 <<<"$line")" name=POSTGRES_IMAGE ;;
    *) die "deployed_ref app|postgres" ;;
  esac
  [[ "$digest" =~ $DIGEST_RE ]] || die "no $which digest recorded for ${sha:-the last deploy}"
  printf '%s@%s\n' "$(env_get "$name")" "$digest"
}

# Content tag, same in CI
postgres_tag() {
  local sum
  sum="$(cd "$INFRA" && cat postgres.Dockerfile initdb.sql postgresql.conf \
    pg-hba.conf pgbackrest.conf | sha256sum | cut -c1-16)"
  printf 'pg-%s' "$sum"
}

compose() {
  local files=(-f "$INFRA/compose.yaml")
  # deploy-test.sh only, never production
  [[ -z "${COMPOSE_OVERRIDE:-}" ]] || files+=(-f "$COMPOSE_OVERRIDE")
  APP_REF="${APP_REF:-$(deployed_ref app)}" \
    POSTGRES_REF="${POSTGRES_REF:-$(deployed_ref postgres)}" \
    docker compose "${files[@]}" --env-file "$RUN_DIR/app.env" "$@"
}

# Usage: smoke_run <image> [edge] <host>...
smoke_run() {
  local image="$1" extra=()
  shift
  # deploy-test.sh: stand-in CDN network
  [[ -z "${SMOKE_DOCKER_ARGS:-}" ]] || read -ra extra <<<"$SMOKE_DOCKER_ARGS"
  docker run --rm "${extra[@]}" -v "$INFRA/smoke.ts:/app/smoke.ts:ro" "$image" \
    bun smoke.ts "$@"
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
    -d sadar_bersuara \
    -c "SET ROLE sb_backup" \
    -c "INSERT INTO backup_runs (kind, finished_at) VALUES ('$kind', $value)"
}

# Since last copy, capped
ship_window() {
  local age="${1:-}" minutes
  [[ "$age" =~ ^[0-9]+$ ]] || die "bad log age $age"
  minutes=$((10#$age + 5))
  if ((minutes < 65)); then minutes=65; fi
  if ((minutes > 43200)); then minutes=43200; fi
  printf '%s' "$minutes"
}
