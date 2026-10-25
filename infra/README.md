# Infra

Production runs on one host with Docker Compose behind Cloudflare Tunnel. The design and every number here come from `docs/architecture.md` (Deploy, Rollback, Backup and DR; Starting Values) and PLAN §10.5 to §10.10. This file holds the steps that are not code: first setup, unlock after a reboot, Cloudflare click-ops and the monitors.

## Files

| File | Role |
|---|---|
| `compose.yaml` | Production services, limits, networks. No published ports; the GlitchTip and Umami UIs sit on the `ops` network for an SSH forward ([runbook](../docs/runbook.md#error-tracking-and-analytics)) |
| `Dockerfile` | App image (web, worker, worker-media, worker-whatsapp, migrate), Bun 1.4.3 on Debian trixie, decoders from the Debian snapshot archive the base image names |
| `postgres.Dockerfile`, `initdb.sql`, `postgresql.conf`, `pg-hba.conf`, `pgbackrest.conf` | PostGIS 18-3.6 with pgBackRest 2.59.3 (`repo1-retention-full=3`) |
| `Caddyfile`, `503.html`, `cloudflared.yml` | Edge inside the host |
| `lib.sh` | Shared shell: decrypt secrets to tmpfs, `compose`, `postgres_tag`, `backup_runs` rows |
| `deploy-gate.sh`, `deploy.sh` | Forced SSH command and the health-checked rollout with automatic rollback |
| `smoke.ts` | Post-deploy check per host through the CDN |
| `host-setup.sh`, `host/` | Idempotent host setup and its systemd units |
| `backup-db.sh`, `backup-evidence.sh`, `b2-newest.ts`, `restore-db.sh` | Backups and whole-cluster PITR |
| `logs-ship.sh`, `caddy-logs.sh` | Hourly timer and before each deploy: app, Postgres and Caddy logs since the start of the last successful copy (Caddy's gzipped rolls included) copied into restic (tag `logs`, 30 days), ASVS V16.4.3 |
| `umami-prune.sh`, `umami-prune.sql` | Monthly timer: Umami analytics rows older than 13 months deleted (Umami has no retention setting) |
| `restore-tenant.sh`, `tenant-export.sh`, `tenant-load.sh` | One tenant at a point in time: exported in COPY text format from a scratch cluster, then loaded into the live cluster in one transaction with `--confirm` (runbook, Restore One Tenant) |
| `restore-test.sh`, `stack-test.sh`, `deploy-test.sh`, `compose.stack-test.yaml`, `lighthouse.sh`, `lighthouse-budget.ts`, `load-test.js` | Drills against throwaway containers, the first three also in CI (`image` job); the Lighthouse runs with CPU slowdown calibrated to the host and the budget check (`STACK_LIGHTHOUSE=1`); the k6 load test |
| `osv-scan.sh`, `osv-gate.ts` | osv-scanner wrapper: fails on fixable HIGH or CRITICAL |
| `coverage-gate.ts`, `acceptance-gate.ts` | CI test gates ([ADR-24](../docs/decisions.md#adr-24-coverage-and-acceptance-gates)): `bun run coverage` runs the suite once with lcov and fails when a backend source file is missing from the report, aggregate lines or functions are below 99% or a file is below 90% lines (`FLOOR_EXCEPTIONS`, at most 5, each with a reason); `bun run acceptance` fails when fewer than 99% of the scenarios in `docs/acceptance.md` have a test carrying `[<ID>]` in its title that is not skipped, todo, fixme or `x`-prefixed and that Bun registers on load (at the top of the file or directly in a `describe` callback, not in a loop, `catch`, `if` block, helper or after an early `return`; an `.each` only over a non-empty array literal), or a tagged `check` in a shell test that `ci.yml` runs (`SHELL_TESTS`, today `stack-test.sh` and `deploy-test.sh`), when a test names an ID the file does not define, when a `PLAN.md §<section>, line <n>` citation names a missing section or a blank or out-of-section line, when a test file's brackets do not balance, or when a heading names an ID in any other form; scenarios under Pre-Launch Checks (at most 3, a fourth fails: AC-LOAD-01, AC-EDGE-01 and AC-RESTORE-01, which wait for the origin server, the Cloudflare zone and a B2 account) need a non-empty `Checked by:` line (review checks it gives the exact command) and are reported as `outside`, not counted, with the share including them printed as `withOutside` (`--trace` lists each tagged test) |
| `compose.dev.yaml` | Development services only (Postgres, Mailpit, clamd, media test runner) |

## Secrets

All secrets live in `infra/.env.sops` (SOPS with age); keys are listed in `env.example`. Replace the placeholder recipient in `.sops.yaml` with the two maintainers' and the server's age public keys, then `sops infra/.env.sops`. The server's age key sits at `/mnt/pgdata/keys/age.key`, inside LUKS. `lib.sh` decrypts once per boot to `/run/sadar-bersuara/app.env` (tmpfs, mode 0600). Nothing secret is written to the repository, the image or a log. WhatsApp: `WHATSAPP_PROVIDER` (`baileys` in production, or `meta`), `WHATSAPP_JOB_KEY` (given to `web` and `worker-whatsapp`; seals code jobs), `WHATSAPP_CREDS_KEY` (given to `worker-whatsapp` only; seals the Baileys session, and rotating it forces a relink) and, for the official API, `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_TEMPLATE`, `META_WA_LANGUAGE`. GlitchTip and Umami (Phase 2): `GLITCHTIP_DB_PASSWORD`, `GLITCHTIP_SECRET_KEY`, `UMAMI_DB_PASSWORD`, `UMAMI_APP_SECRET`, `UMAMI_TWO_FACTOR_KEY`, then `GLITCHTIP_DSN` with `ERROR_REPORTING=true` and the public `UMAMI_WEBSITE_ID` after the [first setup](../docs/runbook.md#error-tracking-and-analytics). `SURVEY_ENABLED` (not secret, default `false`) stays `false` until the frontend ships `/isu/:code/survei` ([runbook](../docs/runbook.md#daily-maintenance)).

GitHub secrets:

| Environment | Secret | Holds |
|---|---|---|
| `production` (required reviewers) | `DEPLOY_SSH_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET` | Access SSH hostname, deploy key, host key line, Access service token |
| `backup` | `R2_ENDPOINT`, `R2_READ_KEY_ID`, `R2_READ_KEY`, `R2_DB_BUCKET`, `B2_WRITE_KEY_ID`, `B2_WRITE_KEY`, `B2_BUCKET` | Read-only R2 token and the B2 write key the server never holds |

Repository variables: `DEPLOY_ENABLED` and `BACKUP_COPY_ENABLED`, both `true` once the host exists. Until then the deploy job and the B2 copy are skipped, not failed. Set them in steps 8 and 10.

Repository settings: CodeQL default setup on, Dependabot alerts on and security PRs off, Renovate app installed, the `contract-migration` label created.

## First Setup

Every value in `infra/.env.sops` (keys listed in `infra/env.example`) is generated with the command its comment names (`openssl rand`), never typed by a person: `PGBACKREST_REPO1_CIPHER_PASS` and `RESTIC_PASSWORD` with `openssl rand -base64 48`, because pgBackRest does not stretch its pass into a key, and `deploy.sh` refuses either under 40 characters (`check_backup_passes` in `infra/lib.sh`). Record who holds what in the runbook [Key Holders](../docs/runbook.md#key-holders) list.

1. Install an apt and systemd distribution (the images use Debian 13) and Docker Engine 29 from download.docker.com.
2. Create one LUKS2 container with LVM and three LVs, mounted at `/mnt/pgdata`, `/mnt/files` and `/mnt/docker` (`cryptsetup luksFormat --type luks2`, `pvcreate`, `vgcreate`, three `lvcreate`, `mkfs.ext4`). Store the recovery passphrase in the password manager. Do not enable TPM2 auto-unlock.
3. Clone the repository to `/opt/sadar-bersuara`, owned by `deploy`.
4. Write the SSH-only tunnel token to `/etc/cloudflared/ssh-tunnel.env` (`TUNNEL_TOKEN=...`, mode 0600).
5. Run `sudo infra/host-setup.sh <access-ssh-hostname>`. It refuses a host below the RAM floor (13.0 GiB with GlitchTip and Umami, `MIN_RAM_KB`), a mount that is not on dm-crypt, Docker outside LUKS, or plaintext swap. `--dry-run` prints every step without changing anything.
6. Copy the server age key to `/mnt/pgdata/keys/age.key` (owner `deploy`, mode 0400).
7. Add the deploy key to `~deploy/.ssh/authorized_keys` as `command="/opt/sadar-bersuara/infra/deploy-gate.sh",restrict ssh-ed25519 ...`.
8. Set the repository variable `DEPLOY_ENABLED=true`. First deploy: run the Deploy workflow manually with action `deploy` and the SHA. Then `docker compose ... run --rm migrate bun db/seed/regions.ts` once. Never run `db/seed/organizations.ts` here: it creates dev accounts with proven fictional numbers and a superadmin, so it refuses `NODE_ENV=production` (ASVS V6.3.2), and `/healthz/jobs` fails `seed_accounts` while any account with a `.test` address exists. Bootstrap the first campus instead: (a) `docker compose ... run --rm -e APEX_HOST=<apex> migrate bun db/first-campus.ts create <slug> <CAMPUS-CODE> "<name>" "<campus name>" <first-admin-email> [contact-email]` inserts only the `organizations` row with host `<slug>.<APEX_HOST>`; (b) restart `web` so Better Auth picks up the host; (c) the operator opens `https://<slug>.<apex>/masuk`, completes Daftar with a real email and WhatsApp number, then runs `docker compose ... run --rm migrate bun db/superadmin.ts grant <that email>` and enrols TOTP at `/masuk/dua-langkah`; (d) `docker compose ... run --rm migrate bun db/first-campus.ts invite <slug> <first-admin-email> <superadmin email>` adds the pending admin invitation (inviter: the superadmin, `audit_log` `member.invite`); (e) on `/admin` the superadmin resends that campus's first invitation, which delivers the email. Later campuses come from `/admin`. `regions.ts` loads the full Kepmendagri code list from `db/seed/wilayah.tsv` (38 provinces, 514 kabupaten/kota, 7,285 kecamatan, 83,762 desa/kelurahan; about 2 s) and is safe to re-run: it upserts names only.
9. Link the WhatsApp sender: sign in as superadmin on a campus host, open `/admin/whatsapp` and link a dedicated number by QR code or pairing code (`docs/runbook.md`, WhatsApp Sender). Until then WhatsApp shows as unavailable and email codes work.
10. Right after the first deploy, run `sudo -u deploy infra/backup-db.sh full` and `sudo -u deploy infra/backup-evidence.sh backup`. The first creates the pgBackRest stanza: until it exists every WAL `archive-push` fails, WAL piles up in `pg_wal` and `/healthz/jobs` answers 503. It then takes the first full backup and records it, and the second records the first restic snapshot, so the backup age checks start green. Set the repository variable `BACKUP_COPY_ENABLED=true`; the B2 copy row appears after the first `backup-copy.yml` run.
11. Postgres timing and disk (PERF-20): run `docker compose ... exec -T postgres pg_test_timing`. PostgreSQL's guide: "Good results will show most (>90%) individual timing calls take less than one microsecond. Average per loop overhead will be even lower, below 100 nanoseconds." If the host is far worse, set `track_io_timing = off` in `infra/postgresql.conf`. Record the disk type (`lsblk -d -o NAME,ROTA,MODEL`; `ROTA 0` is SSD or NVMe) in the handover log: it decides whether `random_page_cost` drops from 4 to 1.1 (open, decisions.md Query optimization).

## After a Reboot

LUKS protects a powered-off server, so a reboot needs a person:

1. `ssh` through Access (the SSH tunnel runs before unlock).
2. `sudo cryptsetup open <device> data` with the passphrase, then `sudo vgchange -ay` and `sudo mount -a`.
3. `sudo systemctl start containerd docker`. The mount guards keep Docker stopped until the volumes are there.
4. `cd /opt/sadar-bersuara && sudo -u deploy bash -c 'source infra/lib.sh && load_env && render_tunnel_config && compose up -d --wait && compose up -d --wait $(app_services)'`. `worker-whatsapp` sits in the `whatsapp` compose profile, so a bare `up` never starts it; `app_services` names it unless `WHATSAPP_ENABLED=false`.
5. Check `https://<apex>/healthz` and `/healthz/jobs`.

## Deploy and Rollback

- Push to `main`: `ci.yml` gates, then `deploy.yml` builds and pushes `ghcr.io/<org>/sadar-bersuara:<sha>` once, takes the pushed digests of both images (`build-push-action` output, or `docker buildx imagetools inspect` for an existing Postgres content tag), scans them, runs `infra/stack-test.sh` on exactly those digests (so the deployed images are the tested ones, SC-05), and runs `deploy <sha> <app-digest> <postgres-digest>` over Access SSH. `deploy-gate.sh` refuses a deploy without both `sha256:` digests. `deploy.sh` pulls `name@digest` only (compose reads `APP_REF` and `POSTGRES_REF`; a tag in GHCR can be overwritten by anyone with `packages: write`, a digest cannot, SC-04), checks that the image's `org.opencontainers.image.revision` label is the SHA, migrates, starts the stack with `--wait`, checks that `/healthz` reports the new SHA, runs `smoke.ts` per host and appends the SHA and both digests to `infra/.deployed-history`. Any failure redeploys the previous SHA by its recorded digests and still exits 1, so the Deploy workflow is red although the previous release is live again. After that, `smoke.ts edge` and the Umami default check only warn (exit 3).
- Rollback: run the Deploy workflow with action `rollback` and an earlier SHA. `deploy.sh` takes that SHA's digests from `infra/.deployed-history` and refuses a SHA without them (deploys recorded before 21 October 2026 carry none; no host existed then). No migration runs, and `deploy.sh` refuses a SHA older than the newest applied `_contract` migration. Applied migrations are recorded in `infra/.migrated-history` as soon as `migrate` succeeds, so the automatic rollback after a failed deploy is refused too when that deploy already applied a contract migration; the deploy then fails loudly and needs a person.
- The Postgres image tag is a hash of its five files (`postgres_tag` in `lib.sh`), so CI builds it only when one of them changes; the host pins its digest like the app's, and Postgres restarts only when the digest changes.

## Backups

| What | How | When |
|---|---|---|
| Database | `backup-db.sh`: pgBackRest full (Sunday) or diff, then `check`, to R2 with `aes-256-cbc` | 02:00 WIB daily |
| WAL | `archive_command`, `archive_timeout` 300 s | Continuous |
| Evidence | `backup-evidence.sh`: restic to a second R2 bucket; forget and prune on Sunday, `check --read-data-subset=5%` on the 1st | Every 6 h |
| Second copy | `.github/workflows/backup-copy.yml`: `rclone sync` of the pgBackRest repository to B2 | Monday 04:30 WIB |

Each run inserts a `backup_runs` row, and `backup-db.sh` records the newest B2 upload time through a list-only key, so `/healthz/jobs` turns red when any copy is stale. On B2, add a lifecycle rule with `daysFromHidingToDeleting: 30` to the copy bucket.

Restore: `infra/restore-db.sh <UTC time|latest>` restores the whole cluster in place after copying the damaged one aside. `infra/restore-test.sh` runs the same pgBackRest PITR on a cluster with the production migrations and both sample campuses, a one-tenant export from the restored cluster and its load into the changed live cluster (per-table checksums for both campuses and the shared tables), and a restic round trip against throwaway containers, and prints `restore-test: PASS`. It needs `bun` and the dev clamd (`bun run db:up`) for the sample seed and binds `127.0.0.1:5198` (`RESTORE_TEST_PORT`); CI runs it in the `image` job after `bun install`, ffmpeg, poppler-utils and qpdf from apt and the dev clamd. The weekly B2 copy is not part of the drill until a B2 account exists. `infra/stack-test.sh <app-image> <postgres-image>` brings up the production compose on `127.0.0.1:5199` and checks pages, assets, media rules, body caps, log hygiene and hardening. `infra/deploy-test.sh <app-image> <postgres-image>` runs the real `deploy-gate.sh` and `deploy.sh` (AC-DEPLOY-03): it pushes releases A, B and C to a throwaway `registry:3.0.0` on `127.0.0.1:5198` and deploys them in that order. B is a copy of the app image that differs from A only in the revision label and in the SHA `/healthz` reports. C reports its own SHA, but its commit adds `header_down Cache-Control "public, max-age=60"` to the Caddyfile, so it passes `/healthz` and fails `smoke.ts` on the session cache-control. Each failure rolls back to A, and each deploy still exits 1, the two triggers of AC-DEPLOY-03. After B the drill checks from outside that B failed on its `/healthz` SHA, that web and both workers run A's digest again, that `/healthz` through Caddy on `127.0.0.1:5199` reports A, that `infra/.deployed-history` ends with A's `rollback` line and never names B, and that both pages answer. After C it checks that C failed its smoke test, that web and both workers run A's digest again, that Caddy answers a session cookie with `no-store` again, that `/healthz` reports A, that the history gained exactly one line, A's second `rollback`, and that it never names C. Only test environment differs from a host: `DEPLOY_ROOT`, `RUN_DIR`, `STATE_DIR`, `COMPOSE_PROJECT_NAME`, `COMPOSE_OVERRIDE` (one extra compose file: Caddy published, clamd, cloudflared, GlitchTip and Umami off, restic on a local repository, and a Caddy stand-in for the CDN in cloudflared's place that answers `smoke.ts` with `HIT`, TLS 1.2 and 1.3, the 301 and the WAF 403) and `SMOKE_DOCKER_ARGS` (the smoke container joins that stand-in); unset, `lib.sh` passes docker exactly what it did before (`infra/lib.test.ts`). A `docker` shim on its `PATH` records `docker image prune` instead of pruning the machine's images. It needs the production lock path `/run/lock` writable.

## Cloudflare Checklist

Review at every handover and after every incident.

- SSL/TLS mode Full (strict); Minimum TLS Version 1.2; TLS 1.3 on; Universal SSL on (ASVS V12.1.1; Cloudflare's default minimum is TLS 1.0); cipher suites left at Cloudflare's Legacy default, which the Free plan cannot restrict (ASVS V12.1.2, accepted risk of 22 October 2026 in docs/decisions.md row "TLS"; restricting them needs Advanced Certificate Manager); Always Use HTTPS off, replaced by a Single Redirect rule `(not ssl and not starts_with(http.request.uri.path, "/api/"))` to https (301) and a WAF custom rule `(not ssl and starts_with(http.request.uri.path, "/api/"))` set to Block, so API clients on `http://` fail instead of being redirected (ASVS V4.1.2). After every deploy `deploy.sh` runs `smoke.ts edge` on each host: TLS 1.0 and 1.1 handshakes must fail, TLS 1.2 and 1.3 succeed, `http://<host>/` must answer 301 to `https://<host>/`, `http://<host>/api/v1` the WAF 403, and the https page must carry `Strict-Transport-Security`; a miss leaves the release running and exits 3, like the Umami default check (ASVS V12.2.1).
- HSTS: `HSTS_POLICY=max-age=300` in `app.env` until every campus host is verified, then `max-age=31536000; includeSubDomains` and a deploy (web and Caddy read the same variable; `compose up -d` in `deploy.sh` recreates both because their environment changed).
- Tunnel ingress: the apex and `*.<apex>` to `http://caddy:80`; one proxied CNAME per campus host, no wildcard DNS.
- Cache Rule "Eligible for cache" with mode "Use cache-control header if present, bypass cache if not", for exactly these paths: `/`, `/tentang`, `/privasi`, `/pedoman`, `/aksesibilitas`, `/isu`, `/isu/*` (issue page and `og.png`), `/tuntutan`, `/tuntutan/*` (tuntutan page, `og.png` and the `dokumen` PDFs), `/data`, `/api/v1`, `/api/v1/*` (public data API, Phase 2), `/wilayah/*.json`, `/logo/*`, `/assets/*`, `/media/*`.
- Cache bypass when `http.cookie contains "__Host-sb.session_token"`.
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

`/healthz/jobs` returns 503 when a queue's oldest ready job is late, a dead-letter queue is not empty, WAL archiving fails or is older than 15 minutes, a backup kind is stale (pgBackRest and its verify 26 h, restic 8 h, B2 copy 8 days), a dashboard snapshot or the national view is older than 1 h, a takedown is not done after 10 minutes, the last `maintenance-daily` run failed, the WhatsApp sender is linked but down (`whatsapp_down`), the day's email sends reach 70% of the provider quota (210 of 300), or any account has a `.test` address (`seed_accounts`). The monitors need only the status code: the body is `{"ok":...}` unless the request carries `Authorization: Bearer <HEALTH_TOKEN>` (set `HEALTH_TOKEN` in `infra/.env.sops`, `openssl rand -hex 32`; empty means the checks are never shown over HTTP), and the runbook Alerts row reads them inside the `web` container. Log in to HetrixTools at least every 90 days, or the free account is marked inactive.

Weekly error review: `docker compose logs --no-log-prefix --since 168h web worker worker-media worker-whatsapp | jq -cR 'fromjson? | select(.level == "error" or .error != null or ((.msg // "") | test("failed")))'`. `--no-log-prefix` keeps each line plain JSON, `fromjson?` skips lines that are not JSON (a crash trace), and the filter matches what the code writes: Better Auth lines carry `level`, worker and app failures carry `error` or a `msg` ending in "failed" (`job failed`, `self-check failed`, `whatsapp request failed`).
