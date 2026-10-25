#!/usr/bin/env bash
# Idempotent host setup, root
# Usage: host-setup.sh [--dry-run] <ssh-hostname>
# Create LUKS volumes first
set -Eeuo pipefail

INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="$INFRA/host"
DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY=1
  shift
fi
SSH_HOSTNAME="${1:-}"

# Compose limits plus 1.5 GiB
MIN_RAM_KB=13631488
MIN_CPUS=4
MOUNTS=(/mnt/pgdata /mnt/files /mnt/docker)
APP_UID=1000
# postgres user in the image
PG_UID=999
DEPLOY_USER=deploy
SOPS_VERSION=3.13.3
SOPS_SHA256=e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b
AGE_VERSION=1.3.2
AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10
CLOUDFLARED_VERSION=2026.9.3
CLOUDFLARED_SHA256=bc073ef293d504cf5ac533bd0aa1c824ef6b4f358765ccaa6628a8a95cacb4b7

say() { printf '== %s\n' "$*"; }
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  # Dry run reports every problem
  ((DRY)) && return 0
  exit 1
}
run() {
  if ((DRY)); then
    printf 'would run: %s\n' "$*"
  else
    "$@"
  fi
}
# Writes stdin to root file
put() {
  local target="$1" mode="$2"
  if ((DRY)); then
    printf 'would write: %s\n' "$target"
    cat >/dev/null
  else
    install -D -m "$mode" /dev/stdin "$target"
  fi
}

download() {
  local url="$1" sum="$2" out="$3"
  if [[ -f "$out" ]] && echo "$sum  $out" | sha256sum -c --quiet 2>/dev/null; then
    return 0
  fi
  run curl -fsSL --proto '=https' -o "$out" "$url"
  ((DRY)) || echo "$sum  $out" | sha256sum -c --quiet || fail "checksum mismatch for $url"
}

check_resources() {
  say "resources"
  local ram cpus
  ram="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  cpus="$(nproc)"
  ((ram >= MIN_RAM_KB)) || fail "RAM ${ram} kB, need ${MIN_RAM_KB} kB (compose limits)"
  ((cpus >= MIN_CPUS)) || fail "$cpus CPUs, need $MIN_CPUS"
}

# Every mount on dm-crypt
check_encrypted_mounts() {
  say "LUKS mounts"
  local mount source
  for mount in "${MOUNTS[@]}"; do
    source="$(findmnt -no SOURCE --target "$mount" 2>/dev/null || true)"
    if [[ -z "$source" ]]; then
      fail "$mount is not mounted, unlock LUKS first"
      continue
    fi
    findmnt -no TARGET "$mount" >/dev/null || fail "$mount is not its own mount"
    lsblk -s -no TYPE "$source" | grep -qx crypt || fail "$mount ($source) is not on LUKS"
  done
}

prepare_dirs() {
  say "data directories"
  run install -d -m 0700 -o "$PG_UID" -g "$PG_UID" /mnt/pgdata/data
  run install -d -m 0700 -o "$DEPLOY_USER" /mnt/pgdata/keys
  run install -d -m 0711 /mnt/docker/docker /mnt/docker/containerd
  run install -d -m 0750 -o "$DEPLOY_USER" /var/lib/sadar-bersuara
  # Decrypted env lives in tmpfs
  echo "d /run/sadar-bersuara 0700 $DEPLOY_USER $DEPLOY_USER -" |
    put /etc/tmpfiles.d/sadar-bersuara.conf 0644
  run systemd-tmpfiles --create /etc/tmpfiles.d/sadar-bersuara.conf
  local dir
  for dir in evidence derived scratch; do
    run install -d -m 0750 -o "$APP_UID" -g "$APP_UID" "/mnt/files/$dir"
  done
  # Caddy reads these, public anyway
  for dir in public assets; do
    run install -d -m 0755 -o "$APP_UID" -g "$APP_UID" "/mnt/files/$dir"
  done
}

configure_docker() {
  say "docker on the encrypted volume"
  put /etc/docker/daemon.json 0644 <"$HOST_DIR/daemon.json"
  put /etc/systemd/system/docker.service.d/mounts.conf 0644 <"$HOST_DIR/docker-mounts.conf"
  put /etc/systemd/system/containerd.service.d/mounts.conf 0644 <"$HOST_DIR/docker-mounts.conf"
  put /etc/systemd/system/var-lib-containerd.mount 0644 <"$HOST_DIR/var-lib-containerd.mount"
  run systemctl daemon-reload
  # Restart only when moving roots
  if ! findmnt /var/lib/containerd >/dev/null ||
    [[ "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)" != /mnt/docker/* ]]; then
    run systemctl stop docker.socket docker containerd
    run systemctl enable --now var-lib-containerd.mount
    run systemctl start containerd docker
  fi
  if ((!DRY)); then
    local root
    root="$(docker info --format '{{.DockerRootDir}}')"
    [[ "$root" == /mnt/docker/* ]] || fail "docker data-root is $root, outside LUKS"
    findmnt -no SOURCE /var/lib/containerd | grep -q '/mnt/docker\|mapper' ||
      fail "/var/lib/containerd is not on LUKS"
  fi
}

# Off, or encrypted per boot
configure_swap() {
  say "swap"
  local plain
  plain="$(swapon --noheadings --show=NAME 2>/dev/null | while read -r dev; do
    lsblk -s -no TYPE "$dev" 2>/dev/null | grep -qx crypt || echo "$dev"
  done)"
  if [[ -n "$plain" ]]; then
    run swapoff -a
    run sed -i -E 's|^([^#].*[[:space:]]swap[[:space:]].*)$|# \1|' /etc/fstab
  fi
  ((DRY)) && return 0
  plain="$(swapon --noheadings --show=NAME | while read -r dev; do
    lsblk -s -no TYPE "$dev" | grep -qx crypt || echo "$dev"
  done)"
  [[ -z "$plain" ]] || fail "plaintext swap still active: $plain"
}

configure_network() {
  say "firewall and sysctl"
  run apt-get install -y --no-install-recommends ufw unattended-upgrades curl jq
  run ufw default deny incoming
  run ufw default allow outgoing
  run ufw --force enable
  # QUIC buffers for cloudflared
  put /etc/sysctl.d/90-sadar-bersuara.conf 0644 <<'EOF'
net.core.rmem_max = 7500000
net.core.wmem_max = 7500000
EOF
  run sysctl --system
  put /etc/apt/apt.conf.d/52sadar-bersuara 0644 <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
EOF
  # Steps at boot, then slews
  run apt-get install -y --no-install-recommends chrony
  put /etc/chrony/conf.d/90-sadar-bersuara.conf 0644 <<'EOF'
makestep 1 3
EOF
  run systemctl enable chrony
  run systemctl restart chrony
}

install_tools() {
  say "sops, age, cloudflared"
  local tmp
  tmp="$(mktemp -d)"
  download "https://github.com/getsops/sops/releases/download/v$SOPS_VERSION/sops-v$SOPS_VERSION.linux.amd64" \
    "$SOPS_SHA256" "$tmp/sops"
  run install -m 0755 "$tmp/sops" /usr/local/bin/sops
  download "https://github.com/FiloSottile/age/releases/download/v$AGE_VERSION/age-v$AGE_VERSION-linux-amd64.tar.gz" \
    "$AGE_SHA256" "$tmp/age.tar.gz"
  run tar -xzf "$tmp/age.tar.gz" -C "$tmp"
  run install -m 0755 "$tmp/age/age" "$tmp/age/age-keygen" /usr/local/bin/
  download "https://github.com/cloudflare/cloudflared/releases/download/$CLOUDFLARED_VERSION/cloudflared-linux-amd64.deb" \
    "$CLOUDFLARED_SHA256" "$tmp/cloudflared.deb"
  run apt-get install -y "$tmp/cloudflared.deb"
  rm -rf "$tmp"
}

configure_ssh_tunnel() {
  say "SSH-only tunnel"
  [[ "$SSH_HOSTNAME" =~ ^[a-z0-9.-]+$ ]] || fail "give the Access SSH hostname"
  sed "s/SSH_HOSTNAME/$SSH_HOSTNAME/" "$HOST_DIR/cloudflared-ssh.yml" | put /etc/cloudflared/ssh.yml 0644
  if ((!DRY)) && [[ ! -s /etc/cloudflared/ssh-tunnel.env ]]; then
    fail "write TUNNEL_TOKEN=... to /etc/cloudflared/ssh-tunnel.env (mode 0600)"
  fi
  put /etc/systemd/system/cloudflared-ssh.service 0644 <"$HOST_DIR/cloudflared-ssh.service"
  run systemctl daemon-reload
  run systemctl enable --now cloudflared-ssh.service
}

# Runs deploy, backups, owns keys
create_deploy_user() {
  say "deploy user"
  id "$DEPLOY_USER" >/dev/null 2>&1 || run useradd --system --create-home --groups docker "$DEPLOY_USER"
}

install_timers() {
  say "backup and retention timers"
  local unit
  for unit in backup-db.service backup-db.timer backup-evidence.service backup-evidence.timer \
    umami-prune.service umami-prune.timer logs-ship.service logs-ship.timer; do
    put "/etc/systemd/system/$unit" 0644 <"$HOST_DIR/$unit"
  done
  run systemctl daemon-reload
  run systemctl enable --now backup-db.timer backup-evidence.timer umami-prune.timer logs-ship.timer
}

[[ $EUID -eq 0 || $DRY -eq 1 ]] || fail "run as root"
command -v docker >/dev/null || fail "install Docker Engine 29 from download.docker.com first"
check_resources
check_encrypted_mounts
configure_network
install_tools
create_deploy_user
prepare_dirs
configure_docker
configure_swap
configure_ssh_tunnel
install_timers
say "host ready"
