# Sadar Bersuara Runbook

Procedures for the person on call. Commands run on the server from `/opt/suara-madani` as the `deploy` user unless a step says root. `compose` below means the helper in `infra/lib.sh`:

```sh
sudo -u deploy bash -c 'source infra/lib.sh && load_env && compose <args>'
```

First setup, reboots, deploys and rollbacks are in `infra/README.md`. Decisions behind each step are in `docs/decisions.md` and `docs/architecture.md`.

## Alerts

| Alert | First Look | Section |
|---|---|---|
| `/healthz` fails twice | `compose ps`, `compose logs --since 15m web` | [Incident](#incident) |
| `/healthz/jobs` 503 | the JSON body names the failing check | [Dead Letters](#dead-letters), [Backups](#restore) |
| `*-dlq` above 0 | `bun db/jobs-cli.ts list` | [Dead Letters](#dead-letters) |
| `maintenance_failed` above 0 | `compose logs worker \| grep maintenance` | [Daily Maintenance](#daily-maintenance) |
| `email_quota_used` at 70% | the day's `email_log` counts | [Email Provider](#email-provider) |
| `wal_archive_failing` or `backup_*_age_s` | `compose exec -T -u postgres postgres pgbackrest --stanza=main info` | [Restore](#restore) |
| `takedown_late` | `takedowns` rows not `done` | [Manual Purge](#manual-purge) |
| `whatsapp_down` 1, or `whatsapp-send_oldest_ready_s` over 120 | `/admin/whatsapp` status, `compose logs --since 30m worker-whatsapp` | [WhatsApp Sender](#whatsapp-sender) |
| `dashboard_snapshot_stale` right after a deploy | the deploy bumped `SNAPSHOT_VERSION` | [Deploy Notes](#deploy-notes) |
| Disk at 70% or 85% | `df -h /mnt/*`, `du -sh /mnt/files/*` | [Incident](#incident) |

## Logs

Logs are JSON lines with `req_id`; values and personal data are never logged. Slow requests in the last hour:

```sh
compose logs --since 1h --no-log-prefix web | jq -c 'select(.dur_ms? and .dur_ms > 1000) | {t, route, status, dur_ms, req_id}'
```

Errors this week: `compose logs --since 168h --no-log-prefix web worker worker-media | jq -c 'select(.level == "error")'`.

## Dead Letters

`/healthz/jobs` answers 503 while any `*-dlq` queue holds a job. Dead letters are kept 30 days (Question 3, `/privasi`). Payloads hold IDs only.

1. List counts: `compose --profile migrate run --rm migrate bun db/jobs-cli.ts list`.
2. Read the jobs and their last error: `... bun db/jobs-cli.ts show email-send-dlq`.
3. Fix the cause first (provider key, outage, bug). A 401, 402 or 403 from the email provider means the key or the plan, see [Email Provider](#email-provider).
4. Preview, then move the jobs back to their source queue: `... bun db/jobs-cli.ts redrive email-send-dlq --dry-run`, then without `--dry-run`.
5. A job that should never run again: `... bun db/jobs-cli.ts delete <dlq> <job-id>`.

Jobs whose row was deleted (close-account, takedown) are skipped by the worker, not dead-lettered. `whatsapp-send-dlq` holds sealed codes that have already expired; delete them after fixing the sender, never redrive them.

## Daily Maintenance

`maintenance-daily` runs at 04:00 WIB in `worker` (`worker/maintenance.ts`): files never uploaded within 24 h become `missing`, originals of reports rejected over 90 days ago are deleted, infected policy briefs and their files are deleted, `email_log` and `whatsapp_log` rows over 30 days and expired sessions are deleted, IP addresses on sessions over 30 days are cleared, notifications stuck in `sending` for an hour are queued again, and orphan files older than a day are removed. It writes one `maintenance done` log line with the counts. A failed run sets `maintenance_failed`; a run waiting over 6 h shows as `maintenance-daily_oldest_ready_s`. Run it once by hand: `compose exec -T worker bun -e 'await (await import("./worker/maintenance.ts")).createMaintenanceHandler()()'`.

## Email Provider

Brevo Free sends 300 a day; notifications and invitations share a ceiling of 200 and wait for 07:00 WIB, sign-in codes may use the rest (Decision 4). Each address gets at most one code per 60 s and 8 per 24 h. People with a WhatsApp number can pick WhatsApp instead, which does not use this quota.

- Quota at 70% two days in a week: ask the team to raise the plan or switch providers. `EMAIL_PROVIDER` accepts `brevo` (production) and `mailpit` (development) today; an SES adapter is not built.
- 401, 402 or 403 in `email-send-dlq`: rotate `BREVO_API_KEY` in `infra/.env.sops`, redeploy, then [redrive](#dead-letters).

## Manual Purge

Takedowns purge the tenant host and the media host after deleting files. If `takedown_late` pages or the purge keeps failing: purge the hostname in the Cloudflare dashboard (Caching, Configuration, Custom Purge, Hostname), or Purge Everything for the zone, then redrive `takedown-dlq`. A Komdigi order is SEV1 with a 1×24 h (4 h urgent) clock.

## Close an Account

`/kelola/laporan/<kode>/tutup-akun` ("Tutup Akun Pelapor") deletes the account's reports, contacts, evidence and follows at that campus, signs the account out everywhere and queues file deletion. It serves a minor's account and an adult's deletion request. It refuses staff of any campus and superadmins. Afterwards the data protection officer records the request (who asked, when, which campus) outside the app, because the audit row holds codes only.

## Komdigi Takedown Order

SEV1, 1×24 h, or 4 h when the order is marked urgent.

1. Save the order letter in the ops folder.
2. Open `/kelola/isu/<kode>`, section "Ubah atau Turunkan Isu", panel "Turunkan Isu Sesuai Perintah Hukum". Choose "Turunkan permanen", or "Sembunyikan" when the order allows it, reason "Perintah pemutusan akses …", tick the confirm box and submit.
3. Check that `/kelola/audit` shows `issue.take_down` (or `issue.unpublish`) with `komdigi_order`, and that the takedown row reaches `done` (`/healthz/jobs` `takedown_late` stays 0). If it does not, see [Manual Purge](#manual-purge).
4. Fetch the issue URL and its OG URL and confirm `cf-cache-status` is not `HIT`; the issue answers 410 with a link to `/pedoman#perintah`.
5. Reply to Komdigi with the time of the takedown.

A tuntutan has no legal panel: an admin closes it, or hides it through a complaint decision, and fixes the text in the editor.

## Data-Subject Deletion Request (UU PDP)

1. Check that the requester owns the account: the request comes from the account's email, or the person signs in.
2. On any of their reports, open "Tutup akun pelapor" and choose the reason "Pelapor dewasa meminta akun dan laporannya dihapus" (audit `account.close`). Repeat on each campus where the account has reports.
3. For an issue whose text names the requester, use "Ubah Isu", or the legal panel with reason "Permintaan pemilik data pribadi".
4. The DPO deletes the global account and records the request.

## Onboarding

New organisation: create the proxied CNAME `<slug>.<domain>` to the tunnel, add it at `/admin` ("Tambah Organisasi", a superadmin with a fresh TOTP check), then restart `web` (`compose restart web`), because trusted hosts are read at boot. The next deploy smoke-tests every `organizations.host`.

A staff session older than `users.updated_at` is refused (`verifiedSession` in `server/auth.server.ts`), so a backward clock step right after TOTP enrolment shows 403 at `/kelola` until the admin signs in again. Keep NTP slewing on production hosts (no step corrections).

## Offboarding

When a team member leaves: remove their `members` row at `/kelola/anggota` (signs them out), remove their email from Cloudflare Access policies, GitHub, GHCR, R2 and B2, rotate every secret they held (list in the password manager), and remove their age recipient from `.sops.yaml`, then re-encrypt with `sops updatekeys infra/.env.sops`.

## Restore

- Whole cluster to a point in time: `sudo infra/restore-db.sh 2026-10-15T01:02:03Z` (a UTC time from `infra/.deployed-history`, or `latest`). It stops the app (including `worker-whatsapp`, whose session rows rewind with the cluster), copies the damaged cluster aside, restores with `--delta` and starts the services `app_services` names. Then open `/admin/whatsapp`: if sends fail or the status is not connected, relink the number, because Signal session rows restored to an earlier point usually no longer match the phone.
- Damage inside one tenant: restore with `pgbackrest --type=time` into a scratch data directory on a side container (not the live one), copy the tenant's rows out with `COPY ... WHERE org_id = ...`, and load them into production in one transaction under `withTenant`. Never run a whole-cluster restore for one tenant.
- Evidence files: `install -d -m 0700 /mnt/files/restore`, then `compose --profile backup run --rm --no-deps --cap-add CHOWN --cap-add FOWNER -v /mnt/files/restore:/restore restic restore latest --target /restore --include /files/evidence/<org-id>`, check the files, then `mv /mnt/files/restore/files/evidence/<org-id> /mnt/files/evidence/` (owner 1000:1000 is kept). The `restic` service is read-only with `cap_drop: ALL`, so the restore needs the writable bind and CHOWN and FOWNER; `infra/restore-test.sh` restores the same way.
- Drill: `infra/restore-test.sh` exercises PITR and restic locally; run it each quarter and at handover.

## Deploy Notes

- `deploy.sh` waits up to 420 s (`--wait-timeout 420`), because `worker-media` waits for `clamav` to be healthy (`start_period` 300 s). `worker`, `worker-media` and `worker-whatsapp` have a heartbeat healthcheck (`WORKER_HEARTBEAT=/tmp/alive`, touched after "worker started" and after each 60 s self-check, unhealthy after 150 s without a touch), so a worker that crash-loops on boot fails `up --wait` and triggers the rollback.
- On a failed deploy, `on_exit` checks out the previous SHA before `deploy.sh rollback <prev>`, so the rollback runs that commit's scripts, compose file, Caddyfile, 503 page, smoke check and Postgres tag, and the working tree ends on the SHA that is running.
- A contract migration (`*_contract`, currently `0013` and `0017`) makes every older SHA unrollable; `deploy.sh` reads `infra/.deployed-history` and `infra/.migrated-history` and prints the oldest allowed SHA.
- `worker-media` deletes leftover `$TMPDIR/sm-media-*` scratch directories at boot (log `scratch swept`).
- After a deploy that bumps `SNAPSHOT_VERSION` (now 6), `/data` shows "Angka Belum Tersedia" and the success-page median is hidden until the next `aggregate-refresh` tick (at most 15 minutes). Wait for the next tick; there is no one-shot command for it yet.
- Add `/aksesibilitas` and `/tuntutan*` to the Cloudflare Cache Rule path list if the zone predates them (`infra/README.md`).

## WhatsApp Sender

`worker-whatsapp` sends sign-in codes from one dedicated number through the unofficial Baileys library. WhatsApp can ban that number at any time; email always keeps working.

- The handset is a credential: it stays locked and with the superadmin on duty, no WhatsApp Web or other device is linked to the number besides `worker-whatsapp`, and every handover checks the phone's linked-devices list and `/admin/whatsapp`. Codes are sent as disappearing messages and the chat is deleted right after each send, so the phone should show no code chats; if it does, read `compose logs worker-whatsapp` for `whatsapp chat delete failed`.

- First deploy: sign in as superadmin, open `/admin/whatsapp` (step-up TOTP), and link the number by QR code or by pairing code from the phone's WhatsApp, Linked devices. Use a number used for nothing else.
- `whatsapp_down` 1 with status "Dilepas dari ponsel" (logged out): relink at `/admin/whatsapp`. Status "Terputus": read `compose logs --since 30m worker-whatsapp`; the worker reconnects with backoff (5 s to 60 s); restart it if it does not. Right after a worker restart or deploy the status reads "Terputus" for the seconds until the socket opens, and the WhatsApp option is unavailable meanwhile (email works). "Kesalahan terakhir" shows the worker's fault code as text (dilepas dari WhatsApp, waktu menautkan habis, or "Terputus (kode N)").
- Rotating `WHATSAPP_CREDS_KEY` in `infra/.env.sops` makes the stored session unreadable: redeploy, then relink. Rotating `WHATSAPP_JOB_KEY` drops codes still in the queue (they expire in 5 minutes anyway).
- The number is banned, or sends fail again and again: switch to the official API. Get an approved copy-code authentication template and a verified Meta Business account, set `WHATSAPP_PROVIDER=meta`, `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_TEMPLATE` (and `META_WA_LANGUAGE`, default `id`) in `infra/.env.sops`, redeploy, and check `/admin/whatsapp` says no number is linked there. Each message then costs money (PLAN §12).
- Never link a real WhatsApp number in a dev environment and choose WhatsApp for a seed account: seed numbers are fictional but could belong to someone.

## Image Security Updates

`infra/Dockerfile` pins the Debian main archive to the base image's snapshot and the security archive to `DEBIAN_SECURITY_SNAPSHOT` (a snapshot.debian.org timestamp, now `20261016T152439Z`), then runs `apt-get upgrade`. When the `image` job or the scheduled scan fails on a Debian package that has a fix, pick the newest `debian-security` timestamp from https://snapshot.debian.org/archive/debian-security/ that carries the fixed version, set it as the ARG default, rebuild, and run `infra/osv-scan.sh image <image>` until it prints `"blocking":0`. Never add an ignore for a Debian finding that has a fix.

## Failover

Restore onto a standby host (infra/README First Setup, then [Restore](#restore)). Stop the old `cloudflared` first, or rotate the tunnel token and delete the tunnel's connections through the Cloudflare API if the old host is unreachable or compromised; then start `cloudflared` on the new host with the same token. No DNS change.

## DR

Five scenarios, each ending with [Restore](#restore): disk or server loss (new host, First Setup, restore latest); compromise or ransomware (new host, rotate the tunnel token and every secret, restore to before the intrusion); logical corruption (PITR or tenant restore); the campus withdraws the server (new host anywhere in Indonesia); Cloudflare account loss (recovery codes in the password manager, two Super Administrators).

## Incident

Severities: SEV1 (personal-data exposure starting the UU PDP 3×24 h clock, a Komdigi takedown order, a failed takedown purge, origin down over 30 minutes, data loss); SEV2 (submission or moderation broken, backups failing over 24 h); SEV3 otherwise. Roles: lead, comms, scribe. Levers: [rollback](../infra/README.md#deploy-and-rollback), [manual purge](#manual-purge), the per-tenant intake pause at `/kelola/pengaturan` or `INTAKE_PAUSED=true` for every campus, `WHATSAPP_ENABLED=false` in `infra/.env.sops` then a deploy (or `compose stop worker-whatsapp` at once; the graceful stop writes status `stopped` with every provider (baileys, meta), so WhatsApp shows as unavailable at once, email keeps working, `/admin/whatsapp` reads "Layanan dihentikan", and `/healthz/jobs` stays green with `whatsapp_ready` 0 and `whatsapp_down` 0, so every other deep check still pages; only a crash, a hung sender or a banned number turns `whatsapp_down` to 1 (a banned number, `logged_out`, keeps paging across deploys and restarts until it is relinked at `/admin/whatsapp`, so pull the lever to silence it while a new number is prepared); because the monitors stay green, close the incident only after `WHATSAPP_ENABLED` is back to true, the worker runs again and `/admin/whatsapp` reads "Tersambung", and note the lever in the incident record while it is pulled) to turn WhatsApp codes off, Under Attack mode in Cloudflare. A blameless postmortem is due within 7 days for every SEV1 and SEV2 (`docs/decisions.md`, Postmortems).

## On-Call

One named primary per week in the ops Telegram group, best effort. Handover: sign in to HetrixTools, Cloudflare, R2, B2 and GHCR; check that the WhatsApp sender number is still linked and that the phone holding it is handed over; confirm both Cloudflare Super Administrators can sign in; re-enable GitHub scheduled workflows; transfer age keys; rotate secrets per key type; [offboard](#offboarding) departed staff; run one rollback and one [restore drill](#restore).

## Load Test

PLAN §13 Phase 1 exit (decisions.md Throughput): uncached SSR at 30 requests per second for 10 minutes, p95 under 500 ms and no 5xx, while 10 clients from at least 3 source IPs start 50 MB uploads at once; slots past 4 per process answer 503 with `Retry-After` and every upload still completes. Then a 1 h soak.

1. Prepare one awaiting upload per client: a signed-in reporter's session cookie and an `evidence` row in `awaiting_upload` for a 50 MB MP4, written as `[{ "cookie": "...", "evidenceId": "..." }]` to `uploads.json`.
2. Run from three machines, one third of the clients each, against the origin through Access (no CDN):

   ```sh
   docker run --rm --network host -v "$PWD/infra:/s:ro" -v "$PWD/load:/k:ro" \
     grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34 \
     run -e BASE=https://<access-hostname> -e HOST=itb.<domain> -e ORIGIN=https://itb.<domain> \
     -e UPLOADS=/k/uploads.json -e UPLOAD_FILE=/k/video.mp4 -e SOAK=1h /s/load-test.js
   ```

3. Thresholds fail the run on their own. Delete the test reports afterwards.

## SLO

Proposed until the team decides PLAN §14 item 10: public reads 99.5% over 30 days, origin `/healthz` 99.0%, RPO 5 minutes for the database and 6 h for evidence, RTO 24 h. Checked from HetrixTools and the quarterly drill.
