# Infra

Production runs on one host with Docker Compose behind Cloudflare Tunnel. The design and every number here come from `docs/architecture.md` (Deploy, Rollback, Backup and DR; Starting Values) and PLAN §10.5 to §10.10. This file holds the steps that are not code: first setup, unlock after a reboot, Cloudflare click-ops and the monitors.

## Files

| File | Role |
|---|---|
| `compose.yaml` | Production services, limits, networks. No published ports |
| `Dockerfile` | App image (web, worker, worker-media, worker-whatsapp, migrate), Bun 1.4.3 on Debian trixie, decoders from the Debian snapshot archive the base image names |
| `postgres.Dockerfile`, `initdb.sql`, `postgresql.conf`, `pg-hba.conf`, `pgbackrest.conf` | PostGIS 18-3.6 with pgBackRest 2.59.3 (`repo1-retention-full=3`) |
| `Caddyfile`, `503.html`, `cloudflared.yml` | Edge inside the host |
| `lib.sh` | Shared shell: decrypt secrets to tmpfs, `compose`, `postgres_tag`, `backup_runs` rows |
| `deploy-gate.sh`, `deploy.sh` | Forced SSH command and the health-checked rollout with automatic rollback |
| `smoke.ts` | Post-deploy check per host through the CDN |
| `host-setup.sh`, `host/` | Idempotent host setup and its systemd units |
| `backup-db.sh`, `backup-evidence.sh`, `b2-newest.ts`, `restore-db.sh` | Backups and whole-cluster PITR |
| `restore-test.sh`, `stack-test.sh`, `compose.stack-test.yaml`, `lighthouse-budget.ts`, `load-test.js` | Local drills against throwaway containers; the Lighthouse budget check (`STACK_LIGHTHOUSE=1`); the k6 load test |
| `osv-scan.sh`, `osv-gate.ts` | osv-scanner wrapper: fails on fixable HIGH or CRITICAL |
| `compose.dev.yaml` | Development services only (Postgres, Mailpit, clamd, media test runner) |

## Secrets

All secrets live in `infra/.env.sops` (SOPS with age); keys are listed in `env.example`. Replace the placeholder recipient in `.sops.yaml` with the two maintainers' and the server's age public keys, then `sops infra/.env.sops`. The server's age key sits at `/mnt/pgdata/keys/age.key`, inside LUKS. `lib.sh` decrypts once per boot to `/run/suara-madani/app.env` (tmpfs, mode 0600). Nothing secret is written to the repository, the image or a log. WhatsApp: `WHATSAPP_PROVIDER` (`baileys` in production, or `meta`), `WHATSAPP_JOB_KEY` (given to `web` and `worker-whatsapp`; seals code jobs), `WHATSAPP_CREDS_KEY` (given to `worker-whatsapp` only; seals the Baileys session, and rotating it forces a relink) and, for the official API, `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_TEMPLATE`, `META_WA_LANGUAGE`.

GitHub secrets:

| Environment | Secret | Holds |
|---|---|---|
| `production` (required reviewers) | `DEPLOY_SSH_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET` | Access SSH hostname, deploy key, host key line, Access service token |
| `backup` | `R2_ENDPOINT`, `R2_READ_KEY_ID`, `R2_READ_KEY`, `R2_DB_BUCKET`, `B2_WRITE_KEY_ID`, `B2_WRITE_KEY`, `B2_BUCKET` | Read-only R2 token and the B2 write key the server never holds |

Repository settings: CodeQL default setup on, Dependabot alerts on and security PRs off, Renovate app installed, the `contract-migration` label created.

## First Setup

1. Install an apt and systemd distribution (the images use Debian 13) and Docker Engine 29 from download.docker.com.
2. Create one LUKS2 container with LVM and three LVs, mounted at `/mnt/pgdata`, `/mnt/files` and `/mnt/docker` (`cryptsetup luksFormat --type luks2`, `pvcreate`, `vgcreate`, three `lvcreate`, `mkfs.ext4`). Store the recovery passphrase in the password manager. Do not enable TPM2 auto-unlock.
3. Clone the repository to `/opt/suara-madani`, owned by `deploy`.
4. Write the SSH-only tunnel token to `/etc/cloudflared/ssh-tunnel.env` (`TUNNEL_TOKEN=...`, mode 0600).
5. Run `sudo infra/host-setup.sh <access-ssh-hostname>`. It refuses a host below the RAM floor (12.0 GiB, `MIN_RAM_KB`), a mount that is not on dm-crypt, Docker outside LUKS, or plaintext swap. `--dry-run` prints every step without changing anything.
6. Copy the server age key to `/mnt/pgdata/keys/age.key` (owner `deploy`, mode 0400).
7. Add the deploy key to `~deploy/.ssh/authorized_keys` as `command="/opt/suara-madani/infra/deploy-gate.sh",restrict ssh-ed25519 ...`.
8. First deploy: run the Deploy workflow manually with action `deploy` and the SHA. Then `docker compose ... run --rm migrate bun db/seed/regions.ts` and `bun db/seed/organizations.ts` once. `regions.ts` loads the full Kepmendagri code list from `db/seed/wilayah.tsv` (38 provinces, 514 kabupaten/kota, 7,285 kecamatan, 83,762 desa/kelurahan; about 2 s) and is safe to re-run: it upserts names only.
9. Link the WhatsApp sender: sign in as superadmin on a campus host, open `/admin/whatsapp` and link a dedicated number by QR code or pairing code (`docs/runbook.md`, WhatsApp Sender). Until then WhatsApp shows as unavailable and email codes work.
10. Right after the first deploy, run `sudo -u deploy infra/backup-db.sh full` and `sudo -u deploy infra/backup-evidence.sh backup`. The first creates the pgBackRest stanza: until it exists every WAL `archive-push` fails, WAL piles up in `pg_wal` and `/healthz/jobs` answers 503. It then takes the first full backup and records it, and the second records the first restic snapshot, so the backup age checks start green. The B2 copy row appears after the first `backup-copy.yml` run.

## After a Reboot

LUKS protects a powered-off server, so a reboot needs a person:

1. `ssh` through Access (the SSH tunnel runs before unlock).
2. `sudo cryptsetup open <device> data` with the passphrase, then `sudo vgchange -ay` and `sudo mount -a`.
3. `sudo systemctl start containerd docker`. The mount guards keep Docker stopped until the volumes are there.
4. `cd /opt/suara-madani && sudo -u deploy bash -c 'source infra/lib.sh && load_env && render_tunnel_config && compose up -d --wait && compose up -d --wait $(app_services)'`. `worker-whatsapp` sits in the `whatsapp` compose profile, so a bare `up` never starts it; `app_services` names it unless `WHATSAPP_ENABLED=false`.
5. Check `https://<apex>/healthz` and `/healthz/jobs`.

## Deploy and Rollback

- Push to `main`: `ci.yml` gates, then `deploy.yml` builds `ghcr.io/<org>/suara-madani:<sha>` once, scans it, and runs `deploy <sha>` over Access SSH. `deploy.sh` migrates, starts the stack with `--wait`, checks that `/healthz` reports the new SHA, runs `smoke.ts` per host and appends to `infra/.deployed-history`. Any failure redeploys the previous SHA.
- Rollback: run the Deploy workflow with action `rollback` and an earlier SHA. No migration runs, and `deploy.sh` refuses a SHA older than the newest applied `_contract` migration. Applied migrations are recorded in `infra/.migrated-history` as soon as `migrate` succeeds, so the automatic rollback after a failed deploy is refused too when that deploy already applied a contract migration; the deploy then fails loudly and needs a person.
- The Postgres image tag is a hash of its five files (`postgres_tag` in `lib.sh`), so Postgres restarts only when one of them changes.

## Backups

| What | How | When |
|---|---|---|
| Database | `backup-db.sh`: pgBackRest full (Sunday) or diff, then `check`, to R2 with `aes-256-cbc` | 02:00 WIB daily |
| WAL | `archive_command`, `archive_timeout` 300 s | Continuous |
| Evidence | `backup-evidence.sh`: restic to a second R2 bucket; forget and prune on Sunday, `check --read-data-subset=5%` on the 1st | Every 6 h |
| Second copy | `.github/workflows/backup-copy.yml`: `rclone sync` of the pgBackRest repository to B2 | Monday 04:30 WIB |

Each run inserts a `backup_runs` row, and `backup-db.sh` records the newest B2 upload time through a list-only key, so `/healthz/jobs` turns red when any copy is stale. On B2, add a lifecycle rule with `daysFromHidingToDeleting: 30` to the copy bucket.

Restore: `infra/restore-db.sh <UTC time|latest>` restores the whole cluster in place after copying the damaged one aside. `infra/restore-test.sh` runs the same pgBackRest PITR and a restic round trip against throwaway containers and prints `restore-test: PASS`. `infra/stack-test.sh <app-image> <postgres-image>` brings up the production compose on `127.0.0.1:5199` and checks pages, assets, media rules, body caps, log hygiene and hardening.

## Cloudflare Checklist

Review at every handover and after every incident.

- SSL/TLS Full; Universal SSL on; HSTS `max-age=300` until every campus host is verified.
- Tunnel ingress: the apex and `*.<apex>` to `http://caddy:80`; one proxied CNAME per campus host, no wildcard DNS.
- Cache Rule "Eligible for cache" with mode "Use cache-control header if present, bypass cache if not", for exactly these paths: `/`, `/tentang`, `/privasi`, `/pedoman`, `/aksesibilitas`, `/isu`, `/isu/*` (issue page and `og.png`), `/tuntutan`, `/tuntutan/*` (tuntutan page, `og.png` and the `dokumen` PDFs), `/data`, `/wilayah/*.json`, `/logo/*`, `/assets/*`, `/media/*`.
- Cache bypass when `http.cookie contains "__Secure-sm.session_token"`.
- Off: Rocket Loader, Email Address Obfuscation, Automatic HTTPS Rewrites, Web Analytics injection, Bot Fight Mode, Always Online.
- Rate rule: `starts_with(http.request.uri.path, "/api/auth/") or starts_with(http.request.uri.path, "/api/upload")`, 60 requests per 10 s per IP.
- Pre-written WAF rules, disabled until an incident: block a path, challenge a country, block uploads.
- Access: an application for the SSH hostname, a policy for maintainers, a service token for the Deploy workflow (record its expiry in the register).
- At least two Super Administrators with 2FA.

## Monitors

| Monitor | Target | Alert |
|---|---|---|
| HetrixTools uptime, 1 min | `https://<apex>/`, `https://<campus>/` through the CDN | Page |
| HetrixTools uptime, 1 min | `/healthz` (twice failing) and `/healthz/jobs` (503) | Page |
| HetrixTools server agent | Disk 70% and 85% | Page |
| HetrixTools server agent | RAM above 90% for 10 min, CPU above 90% for 15 min | Email |
| UptimeRobot, 5 min | Same URLs | Backup |

`/healthz/jobs` returns 503 when a queue's oldest ready job is late, a dead-letter queue is not empty, WAL archiving fails or is older than 15 minutes, a backup kind is stale (pgBackRest 26 h, restic 8 h, B2 copy 8 days), a dashboard snapshot or the national view is older than 1 h, a takedown is not done after 10 minutes, the last `maintenance-daily` run failed, the WhatsApp sender is linked but down (`whatsapp_down`), or the day's email sends reach 70% of the provider quota (210 of 300). Log in to HetrixTools at least every 90 days, or the free account is marked inactive.

Weekly error review: `docker compose logs --no-log-prefix --since 168h web worker worker-media worker-whatsapp | jq -cR 'fromjson? | select(.level == "error" or .error != null or ((.msg // "") | test("failed")))'`. `--no-log-prefix` keeps each line plain JSON, `fromjson?` skips lines that are not JSON (a crash trace), and the filter matches what the code writes: Better Auth lines carry `level`, worker and app failures carry `error` or a `msg` ending in "failed" (`job failed`, `self-check failed`, `whatsapp request failed`).
