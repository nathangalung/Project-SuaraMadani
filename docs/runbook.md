# Sadar Bersuara Runbook

Procedures for the person on call. Commands run on the server from `/opt/sadar-bersuara` as the `deploy` user unless a step says root. `compose` below means the helper in `infra/lib.sh`:

```sh
sudo -u deploy bash -c 'source infra/lib.sh && load_env && compose <args>'
```

First setup, reboots, deploys and rollbacks are in `infra/README.md`. Decisions behind each step are in `docs/decisions.md` and `docs/architecture.md`.

## Alerts

| Alert | First Look | Section |
|---|---|---|
| `/healthz` fails twice | `compose ps`, `compose logs --since 15m web` | [Incident](#incident) |
| `/healthz/jobs` 503 | the public body is only `{"ok":false}`; read the checks with the token: `compose exec -T web bun -e 'const r = await fetch("http://127.0.0.1:3000/healthz/jobs", { headers: { authorization: "Bearer " + process.env.HEALTH_TOKEN } }); console.log(await r.text())'` | [Dead Letters](#dead-letters), [Backups](#restore) |
| `seed_accounts` above 0 | `SELECT email FROM users WHERE lower(email) LIKE '%.test'` as `sb_migrator`: dev seed accounts in production; delete them and find how they got there | [Incident](#incident) |
| `backup_pgbackrest-verify_age_s` | `compose exec -T -u postgres postgres pgbackrest --stanza=main verify --output=text --verbose` | [Restore](#restore) |
| `*-dlq` above 0 | `bun db/jobs-cli.ts list` | [Dead Letters](#dead-letters) |
| `maintenance_failed` above 0 | `compose logs worker \| grep maintenance` | [Daily Maintenance](#daily-maintenance) |
| `deadline_reminders_failed` above 0 | `compose logs worker \| grep deadline` | [Daily Maintenance](#daily-maintenance) |
| `email_quota_used` at 70% | the day's `email_log` counts | [Email Provider](#email-provider) |
| `wal_archive_failing` or `backup_*_age_s` | `compose exec -T -u postgres postgres pgbackrest --stanza=main info` | [Restore](#restore) |
| `takedown_late` | `takedowns` rows not `done` | [Manual Purge](#manual-purge) |
| `whatsapp_down` 1, or `whatsapp-send_oldest_ready_s` over 120 | `/admin/whatsapp` status, `compose logs --since 30m worker-whatsapp` | [WhatsApp Sender](#whatsapp-sender) |
| `dashboard_snapshot_stale` right after a deploy | the deploy bumped `SNAPSHOT_VERSION` | [Deploy Notes](#deploy-notes) |
| Disk at 70% or 85% | `df -h /mnt/*`, `du -sh /mnt/files/*` | [Incident](#incident) |

## Logs

Logs are JSON lines with `req_id`; values and personal data are never logged. Slow requests in the last hour:

```sh
compose logs --since 1h --no-log-prefix web | jq -c 'select(.dur_ms? and .dur_ms > 1000) | {t, host, path, status, dur_ms, req_id}'
```

Errors this week: `compose logs --since 168h --no-log-prefix web worker worker-media | jq -c 'select(.level == "error")'`.

Security events, the fields are in architecture.md Security events: `compose logs --since 24h --no-log-prefix web | jq -c 'select(.msg == "security") | {t, event, host, path, user_id, subject_hash, req_id}'`. One request end to end: `jq -c 'select(.req_id == "<id>")'` over web and worker logs, `SELECT action, entity_type, created_at FROM audit_log WHERE request_id = '<id>'` as `sb_migrator` with `app.org_id` set, and the Caddy line with `cf_ray` equal to the id for the client IP.

Off-host copy: `logs-ship.timer` copies the app and Postgres logs since the start of the last successful copy (at least 65 minutes) and the Caddy files rolled in that window plus the current one into restic every hour, and once more before a deploy recreates the containers (tag `logs`, kept 30 days, `/healthz/jobs` `backup_logs_age_s` pages after 3 h). After a suspected host compromise, read the copy from a clean machine: `restic snapshots --tag logs`, then `restic dump <snapshot> /app-<stamp>.log`. Today the server holds a key that can also delete; making the copy tamper-proof needs a bucket key without `deleteFiles` (B2) or Object Lock, with `infra/logs-ship.sh prune` then run from an operator machine (open decision, decisions.md Log shipping).

## Error Tracking and Analytics

GlitchTip (errors) and Umami (cookieless page views) run in the stack with their own databases; neither UI is public (architecture.md, Error Reporting and Analytics).

Open the UIs through the Access SSH tunnel: `ssh -L 8000:172.31.17.10:8000 -L 8001:172.31.17.11:3000 <access-ssh-hostname>`, then GlitchTip at `http://localhost:8000` and Umami at `http://localhost:8001`.

First setup, once per host:

1. Put `GLITCHTIP_DB_PASSWORD`, `GLITCHTIP_SECRET_KEY`, `UMAMI_DB_PASSWORD`, `UMAMI_APP_SECRET` and `UMAMI_TWO_FACTOR_KEY` (each `openssl rand -hex 32`) in `infra/.env.sops`, then deploy. A fresh cluster creates the `glitchtip` and `umami` roles and databases in `initdb.sql`. A cluster initialised before 21 October 2026 needs them once, before the deploy brings the two services up:

   ```sh
   compose up -d postgres
   compose exec -T -u postgres postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -v gpw="$GLITCHTIP_DB_PASSWORD" -v upw="$UMAMI_DB_PASSWORD"' <<'SQL'
   CREATE ROLE glitchtip LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'gpw';
   CREATE DATABASE glitchtip OWNER glitchtip;
   REVOKE ALL ON DATABASE glitchtip FROM PUBLIC;
   CREATE ROLE umami LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD :'upw';
   CREATE DATABASE umami OWNER umami;
   REVOKE ALL ON DATABASE umami FROM PUBLIC;
   SQL
   ```

2. Wait for `compose ps glitchtip umami` to show `healthy` (first boot runs their migrations, about a minute).
3. GlitchTip: open the UI and register the maintainers' shared ops account at once (sign-up closes after the first account; later people are invited from the UI). Create the organization and one project (platform Node.js). Copy its DSN and replace the host part with `glitchtip:8000` (`http://<key>@glitchtip:8000/<project id>`); `web` and the workers send over the Docker network, never through Cloudflare. Set `GLITCHTIP_DSN` and `ERROR_REPORTING=true` in `infra/.env.sops` and redeploy. A malformed DSN stops `web` and the workers at boot, so a failed `up --wait` after this change means a typo. Test it: `compose exec -T web bun -e 'const r = (await import("./server/error-report.ts")).errorReporterFromEnv(process.env, "web"); r.report({ msg: "runbook test", error: "Error", message: "runbook test" }); await r.flush()'`, and the issue "Error: runbook test" appears in GlitchTip.
4. Umami: sign in at once with `admin` / `umami` (Umami's default), change the password, and turn on two-factor authentication (Settings, Profile). Until the password changes, every `deploy.sh` run (deploy or rollback) ends with exit 3 and "umami still accepts admin/umami" after the deploy itself succeeded (`umami_default_active` in `infra/lib.sh`), so the first deploy shows red until this step is done. Add one website with the apex domain, copy its website ID into `UMAMI_WEBSITE_ID` in `infra/.env.sops` and redeploy. Page views start when the frontend inserts the tracker (architecture.md, Analytics Snippet).

Weekly: read new GlitchTip issues; the log query above still works and is the fallback when GlitchTip is down. GlitchTip sends no email (it would share the Brevo cap).

- Turn error reporting off: `ERROR_REPORTING=false` and redeploy; or `compose stop glitchtip` (events are dropped, `error report failed` is logged at most once a minute per process, log lines stay).
- Upgrades: both images are pinned by digest. Read the GlitchTip blog before a new major. `infra/stack-test.sh` creates a GlitchTip project through its internal Django models, so a GlitchTip upgrade must pass the stack test. Never expose Umami's `recorder.js` or any `/stats/*` path besides `script.js` and `api/send`: session replays would record what people type.
- Retention: GlitchTip keeps 30 days (`GLITCHTIP_RETENTION_DAYS`). Umami has no retention setting, so `umami-prune.timer` (1st of the month, 03:30 WIB, as `deploy`) runs `infra/umami-prune.sh`, which deletes page views and their event, session, revenue, heatmap and replay rows older than 13 months. Check it with `systemctl list-timers umami-prune.timer` and `journalctl -u umami-prune.service`; run it by hand with `sudo -u deploy infra/umami-prune.sh`. Size, weekly with the GlitchTip review: `compose exec -T -u postgres postgres psql -X -At -c "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE datname IN ('glitchtip', 'umami')"`; together they have a 5 GB disk budget (PLAN §10.9).
- Restore: whole-cluster PITR rewinds GlitchTip and Umami with the app; `restore-db.sh` stops and starts them. Rotate a database password with `ALTER ROLE glitchtip PASSWORD '...'` as the superuser, the same value in `infra/.env.sops`, then a deploy.

## Dead Letters

`/healthz/jobs` answers 503 while any `*-dlq` queue holds a job. Dead letters are kept 30 days (Question 3, `/privasi`). Payloads hold IDs only.

1. List counts: `compose --profile migrate run --rm migrate bun db/jobs-cli.ts list`.
2. Read the jobs and their last error: `... bun db/jobs-cli.ts show email-send-dlq`.
3. Fix the cause first (provider key, outage, bug). A 401, 402 or 403 from the email provider means the key or the plan, see [Email Provider](#email-provider).
4. Preview, then move the jobs back to their source queue: `... bun db/jobs-cli.ts redrive email-send-dlq --dry-run`, then without `--dry-run`.
5. A job that should never run again: `... bun db/jobs-cli.ts delete <dlq> <job-id>`.

Jobs whose row was deleted (close-account, takedown) are skipped by the worker, not dead-lettered. `whatsapp-send-dlq` holds sealed codes that have already expired; delete them after fixing the sender, never redrive them.

## Daily Maintenance

`maintenance-daily` runs at 04:00 WIB in `worker` (`worker/maintenance.ts`): files never uploaded within 24 h become `missing`, originals of reports rejected over 90 days ago are deleted, infected policy briefs and their files are deleted, `email_log` and `whatsapp_log` rows over 30 days and expired sessions are deleted, IP addresses on sessions over 30 days are cleared, notifications stuck in `sending` for an hour are queued again, and orphan files older than a day are removed, including upload temp files (`.tmp-*`) and resumable upload parts (`.part-*`) in `evidence/<org>/` that were not written for a day. It writes one `maintenance done` log line with the counts. A failed run sets `maintenance_failed`; a run waiting over 6 h shows as `maintenance-daily_oldest_ready_s`. Run it once by hand: `compose exec -T worker bun -e 'await (await import("./worker/maintenance.ts")).createMaintenanceHandler()()'`.

`deadline-reminders` runs at 07:00 WIB in the same container (`worker/deadline-reminders.ts`): each admin of a campus with at least one issue in `/kelola/isu?perlu=lewat-tenggat` gets one digest email that day through `email-send`. A missed 07:00 is skipped, not caught up. Running it again the same day sends nothing new; a run before 07:00 WIB holds the mail until 07:00. Check a day's run: `SELECT org_id, created_at FROM audit_log WHERE action = 'referral.remind' ORDER BY created_at DESC LIMIT 5`, and the rows with `SELECT status, error, count(*) FROM notifications WHERE template = 'referral_deadline' GROUP BY 1, 2` (`skipped` errors: `undeliverable`, `unverified`, `closed`, `not_admin`, `resolved`, `superseded`). Run it once by hand: `compose exec -T worker bun -e 'await (await import("./worker/deadline-reminders.ts")).createDeadlineReminderHandler()({})'`. A waiting run over 6 h shows as `deadline-reminders_oldest_ready_s`; a run that failed after its 2 retries has no DLQ and sets `deadline_reminders_failed` on `/healthz/jobs` for 2 days, next to a `job failed` log line with `queue` `deadline-reminders`. The failed orgs got no digest that day and the next 07:00 run does not catch up, so run it once by hand after the fix (the orgs that already got that day's digest get nothing twice).

`survey-send` runs in the same container (`worker/survey-send.ts`, ADR-22): a "Diklaim selesai" queues one job for 28 days later, which mails each reporter of the issue the "Sudah beres?" link, after 07:00 WIB, through `email-send`. A claim that was confirmed or reopened by then is dropped (`skipped` `closed`), and so is one whose issue was taken down (`taken_down`). An unpublished issue keeps its survey: the job logs `hidden` and re-queues itself for 07:00 WIB each day until the issue is republished (then it sends), closed or taken down. The mail names the date of the claim, not "four weeks ago", because it can go out later than 28 days. **`SURVEY_ENABLED` stays `false` (the compose default) until the frontend ships `/isu/:code/survei`**: the mailed link answers 404 before that. While it is false a due job sends nothing, re-queues itself for 07:00 WIB the next day and logs outcome `{"skipped":"disabled"}`, so no round is lost; set `SURVEY_ENABLED=true` in `infra/.env.sops` and redeploy once the page is live, and the waiting surveys go out the next morning. Any other value than `true` or `false` stops `worker` at boot. Find the waiting surveys: `SELECT start_after, data->>'claimId' FROM pgboss.job WHERE name = 'survey-send' AND state = 'created' ORDER BY start_after`. Rounds and answers: `SELECT c.claimed_at, c.survey_sent_at, c.outcome, c.basis, (SELECT string_agg(coalesce(answer, '-'), ',') FROM fix_surveys s WHERE s.claim_id = c.id) FROM resolution_claims c WHERE issue_id = '<id>' ORDER BY claimed_at` (inside `withTenant` or as `postgres`). A survey answer that confirms or reopens shows in `audit_log` as `issue.confirm_resolved` or `issue.reopen` with actor null and reason `survey`; answers themselves are `claim.survey_answer`. A failed job goes to `survey-send-dlq` and `/healthz/jobs` reports it; redrive it with `db/jobs-cli.ts` (the handler sends nothing twice: `survey_sent_at` and `notifications_event_user_key`). Mail skips: `answered` (already answered), `claim_closed` (the round named on the notification, `notifications.claim_id`, is closed, even when a newer round is open), `unpublished`. Agency replies wait at `/kelola` (status `pending`); count them with `SELECT status, count(*) FROM agency_replies GROUP BY 1`. No admin email is sent for a new reply.

## Email Provider

Brevo Free sends 300 a day; notifications and invitations share a ceiling of 200 and wait for 07:00 WIB, sign-in codes may use the rest (Decision 4). Each address gets at most one code per 60 s and 8 per 24 h. People with a WhatsApp number can pick WhatsApp instead, which does not use this quota.

- Quota at 70% two days in a week: ask the team to raise the plan or switch providers. `EMAIL_PROVIDER` accepts `brevo` and `ses` (production) and `mailpit` (development). The daily caps (`EMAIL_QUOTA` in `shared/notifications.ts`: 300 a day, 200 for notifications and invitations, 100 for codes) stay the same after a switch until they are changed in code, so switching adds redundancy, not volume.
- Switch to SES (needs SES production access, the sending domain verified in the same region, SPF and DKIM): create an IAM user allowed only `ses:SendEmail` (the SES guide's sending-only policy also lists `ses:SendRawEmail`, which this app does not use), set `SES_REGION` (for example `ap-southeast-3`, Jakarta), `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` and `EMAIL_PROVIDER=ses` in `infra/.env.sops`, then redeploy. A missing `SES_*` value stops `web` and `worker` at boot, so a failed `up --wait` means a typo. `EMAIL_FROM` needs an ASCII address. Switching back is `EMAIL_PROVIDER=brevo` and a redeploy.
- 401, 402 or 403 in `email-send-dlq`: rotate `BREVO_API_KEY` (Brevo) or `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY` (SES: `UnrecognizedClientException`, `IncompleteSignature`, `ExpiredTokenException`, `AccessDeniedException`) in `infra/.env.sops`, redeploy, then [redrive](#dead-letters).
- SES 400 in `email-send-dlq` or the `job failed` log: the message names the error type. `SendingPausedException`, `AccountSuspendedException` or `MailFromDomainNotVerifiedException`: fix it in the SES console (or switch back to Brevo), then redrive. `ThrottlingException` (daily quota or rate) is deferred (60 s at a time without `Retry-After`), 24 times, before it retries into the DLQ. Only `MessageRejected` and `BadRequestException` mark the notification `failed` (`http_400`) without a retry.

## Manual Purge

Takedowns purge the tenant host and the media host after deleting files. If `takedown_late` pages or the purge keeps failing: purge the hostname in the Cloudflare dashboard (Caching, Configuration, Custom Purge, Hostname), or Purge Everything for the zone, then redrive `takedown-dlq`. A Komdigi order is SEV1 with a 1×24 h (4 h urgent) clock.

A hostname purge also clears the public data API copies (`/api/v1/*`). After a takedown, check `/api/v1/isu/<code>` as well as the page: it must answer 410 without a `cf-cache-status: HIT`.

## Public Data API

`/api/v1/*` on campus hosts (contract in `docs/architecture.md`, Public Data API). It needs the Cache Rule paths `/api/v1` and `/api/v1/*` (`infra/README.md`). A client over 120 origin requests a minute gets 429 from that `web` process; repeated 429s in the logs (`"path":"/api/v1/...","status":429`) with a cache miss each time mean someone is paging or filtering through everything, which is allowed. If it threatens the database, add a temporary WAF block for that client in Cloudflare. `/api/v1/data` answers 503 `snapshot_pending` until a campus has its first dashboard snapshot (`aggregate-refresh`, every 15 minutes).

## Close an Account

`/kelola/laporan/<kode>/tutup-akun` ("Tutup Akun Pelapor") deletes the account's reports, contacts, evidence, follows, tuntutan and claim ratings and survey rows at that campus, detaches its right-of-reply submissions (the text stays, the sender's email no longer shows), signs the account out everywhere and queues file deletion. It may confirm or reopen an issue in public: an open survey round that waited only on this reporter is decided again from the remaining answers. It serves a minor's account and an adult's deletion request. It refuses staff of any campus and superadmins. Afterwards the data protection officer records the request (who asked, when, which campus) outside the app, because the audit row holds codes only.

## Komdigi Takedown Order

SEV1, 1×24 h, or 4 h when the order is marked urgent.

1. Save the order letter in the ops folder.
2. Open `/kelola/isu/<kode>`, section "Ubah atau Turunkan Isu", panel "Turunkan Isu Sesuai Perintah Hukum". Choose "Turunkan permanen", or "Sembunyikan" when the order allows it, reason "Perintah pemutusan akses …", tick the confirm box and submit.
3. Check that `/kelola/audit` shows `issue.take_down` (or `issue.unpublish`) with `komdigi_order`, and that the takedown row reaches `done` (`/healthz/jobs` `takedown_late` stays 0). If it does not, see [Manual Purge](#manual-purge).
4. Fetch the issue URL and its OG URL and confirm `cf-cache-status` is not `HIT`; the issue answers 410 with a link to `/pedoman#perintah`.
5. Reply to Komdigi with the time of the takedown.

A tuntutan: the backend has `legalTakedownDemand` (architecture.md section 11): the tuntutan goes back to draft with reason `komdigi_order`, audit `demand.hide`, and a takedown row whose purge `takedown_late` watches. Until the panel exists on `/kelola/tuntutan/<kode>` (frontend), hide it through a complaint decision (which now also queues the retried purge), then check steps 3 and 4 for the tuntutan URL and `/tuntutan/<kode>/og.png`.

## Data-Subject Deletion Request (UU PDP)

1. Check that the requester owns the account: the request comes from the account's email, or the person signs in.
2. On any of their reports, open "Tutup akun pelapor" and choose the reason "Pelapor dewasa meminta akun dan laporannya dihapus" (audit `account.close`). Repeat on each campus where the account has reports.
3. For an issue whose text names the requester, use "Ubah Isu", or the legal panel with reason "Permintaan pemilik data pribadi".
4. The DPO deletes the global account: `docker compose ... run --rm migrate bun db/subject.ts delete <email|phone> --confirm`. It refuses while the account is a superadmin, staff anywhere, or still owns reports on a campus (it lists the campuses: repeat step 2 there first). Save the printed receipt (user id, campuses, no address) with the request record.

## Data-Subject Access Request (UU PDP Pasal 7)

UU PDP Pasal 7 (pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-7): "Subjek Data Pribadi berhak mendapatkan akses dan memperoleh salinan Data Pribadi tentang dirinya", as other laws provide.

1. Check ownership as in step 1 above.
2. `docker compose ... run --rm migrate bun db/subject.ts export <email|phone> > subject.json` on the server, in the tmpfs `RUN_DIR`. It reads every campus in one read-only snapshot: the account, sessions (IP and user agent), memberships, invitations, and per campus every row with the person's `user_id` plus the contacts and evidence rows of their reports. Credentials (session tokens, TOTP secrets, backup codes, password hashes) are left out.
3. Review it: rows about other people (names inside report text) stay, because they are the requester's own report; a staff member's internal note is not in it.
4. Send it to the account's own email, encrypted or through a link that expires, then delete `subject.json`. Record the date. Withdrawing the optional agency-forwarding consent alone (UU PDP Pasal 9: "Subjek Data Pribadi berhak menarik kembali persetujuan pemrosesan Data Pribadi tentang dirinya yang telah diberikan kepada Pengendali Data Pribadi." (https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-9)) is `withdrawForwardConsent`, not this procedure.

## Personal Data Breach (UU PDP Pasal 46)

UU PDP Pasal 46 (pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-46): ayat (1) "pemberitahuan secara tertulis paling lambat 3 x 24 (tiga kali dua puluh empat) jam kepada: a. Subjek Data Pribadi; dan b. lembaga."; ayat (2) the notice "minimal memuat: a. Data Pribadi yang terungkap; b. kapan dan bagaimana Data Pribadi terungkap; dan c. upaya penanganan dan pemulihan"; ayat (3) "Dalam hal tertentu" the public is told too. PP 33/2026 Pasal 114 and 115 repeat the duty (PLAN §11 item 3; source unofficial, user to confirm).

1. T0 is when anyone on the team first has reason to believe personal data left our control (a leaked dump, an access the logs cannot explain, a lost laptop with the age key). Open a SEV1 [Incident](#incident); the scribe writes T0 and every step with its time. The deadline is T0 + 72 h.
2. Contain: rotate the exposed secret per [Key Management](architecture.md#key-management), `db/sessions.ts revoke --all` when sessions or `BETTER_AUTH_SECRETS` are involved, intake pause, and copy logs off the host first ([Logs](#logs), the restic `logs` copy).
3. Scope, each as `sb_migrator` with `app.org_id` set per campus:
   - contact reveals and original downloads: `SELECT actor_id, entity_id, created_at, request_id FROM audit_log WHERE action IN ('report.view_contact', 'evidence.download_original') AND created_at > <window start>`;
   - reports touched: the `entity_id`s above, then `SELECT DISTINCT user_id FROM reports WHERE id = ANY(<ids>)`;
   - a whole-table leak: every `users` row, and per campus every reporter;
   - requests: the `req_id`s from the [Logs](#logs) queries, joined to the Caddy line by `cf_ray` for the client IP.
4. Write the notice in Indonesian with the three ayat (2) items: which data (by [Data Classification](architecture.md#data-classification) level, never the data itself), when and how, and what was done and what the person can do. Send it from the ops mailbox to every affected account's email (the app has no breach template), and to Komdigi until the Lembaga PDP exists (PLAN §11 item 3).
5. Public notice (ayat (3)): the DPO decides with the lead, at the latest when the affected people cannot all be reached or the leak is already public; post it on the status page and `/tentang`.
6. Postmortem within 7 days (decisions.md Postmortems), linked from the incident record. The DPO and the legal entity are still open decisions (PLAN §14); until then the lead signs.

## Onboarding

New organisation: create the proxied CNAME `<slug>.<domain>` to the tunnel, add it at `/admin` ("Tambah Organisasi", a superadmin with a fresh TOTP check), then restart `web` (`compose restart web`), because trusted hosts are read at boot. The next deploy smoke-tests every `organizations.host`.

A staff session older than `users.updated_at` is refused (`verifiedSession` in `server/auth.server.ts`), so a backward clock step right after TOTP enrolment shows 403 at `/kelola` until the admin signs in again. `infra/host-setup.sh` installs chrony with `makestep 1 3`, so the clock only steps during the first three updates after boot and slews afterwards; check with `chronyc tracking` if it happens. TOTP codes are accepted only for the current and the previous 30 s step (`claimTotpStep` in `server/auth.server.ts`, ASVS V6.5.5), so an authenticator whose clock runs ahead of the server fails while one up to 30 s behind still works: when every code of one staff member is refused, set the phone's date and time to automatic, then compare the server with `chronyc tracking`.

## Offboarding

When a team member leaves: remove their `members` row at `/kelola/anggota` (signs them out), remove their email from Cloudflare Access policies, GitHub, GHCR, R2 and B2, rotate every secret they held (the [Key Holders](#key-holders) list, rotation per key type in [Key Management](architecture.md#key-management); for `BETTER_AUTH_SECRETS` prepend a new version, deploy, run `sudo -u deploy bash -c 'source infra/lib.sh && load_env && compose --profile migrate run --rm -e BETTER_AUTH_SECRETS="$(env_get BETTER_AUTH_SECRETS)" migrate bun db/reseal-two-factors.ts'` (the `migrate` service does not hold the auth key otherwise) until it prints `"stale":0` and a second run `"resealed":0`, then drop the old version and deploy), update the Key Holders list, and remove their age recipient from `.sops.yaml`, then re-encrypt with `sops updatekeys infra/.env.sops`.

## Key Holders

Kept in the shared password manager next to the secrets, never in this repository; this section names what it must hold. One entry per person who can read `infra/.env.sops` or a master-level secret: name, role, age recipient (public key), and for each master-level secret (age keys, LUKS passphrase, `BETTER_AUTH_SECRETS`, `LACAK_LINK_KEYS`, `AUDIT_HMAC_KEY`, `WHATSAPP_CREDS_KEY`, `PGBACKREST_REPO1_CIPHER_PASS`, `RESTIC_PASSWORD`, the Cloudflare, GitHub and provider accounts) the date access was granted, the date it ended and the date the secret was rotated after it ended. A secret whose holder left without a rotation date is overdue.

## Lost Authenticator

A staff member or superadmin who lost the authenticator app and every backup code (ASVS V6.4.4). Identity is proven at least as strongly as at enrolment, where the person received an invitation to their proven email, signed in by code and enrolled TOTP:

1. Another admin of the same campus (or the superadmin) confirms the request out of band: a video call or meeting where the person shows their face and campus card, and a call to the number on their account. Never act on an email or chat message alone; record who confirmed and how in the incident or handover log.
2. The operator runs `docker compose ... run --rm migrate bun db/totp-reset.ts <email>` (`bun run db:totp-reset` locally). It deletes the `two_factors` row, sets `two_factor_enabled` false, bumps `users.updated_at` (so no older session passes the staff check), deletes the person's sessions and writes `audit_log` `member.totp_reset` in each campus where they are a member (a superadmin without a campus membership gets no `audit_log` row, because rows belong to a campus; note the reset in the handover log instead).
3. The person signs in at `/masuk` with a code to their proven email or WhatsApp, which sends them to enrol at `/masuk/dua-langkah`; enrolment needs that fresh sign-in (300 s). They save the new backup codes.
4. If the email itself is lost or changed, do not reset: remove the membership and send a new invitation to the new address after the step 1 check.

## Restore

- Whole cluster to a point in time: `sudo infra/restore-db.sh 2026-10-15T01:02:03Z` (a UTC time from `infra/.deployed-history`, or `latest`). It stops the app (including `worker-whatsapp`, whose session rows rewind with the cluster), copies the damaged cluster aside, restores with `--delta` and starts the services `app_services` names. Then open `/admin/whatsapp`: if sends fail or the status is not connected, relink the number, because Signal session rows restored to an earlier point usually no longer match the phone.
- Damage inside one tenant: see [Restore One Tenant](#restore-one-tenant). Never run a whole-cluster restore for one tenant.
- Evidence files: `install -d -m 0700 /mnt/files/restore`, then `compose --profile backup run --rm --no-deps --cap-add CHOWN --cap-add FOWNER -v /mnt/files/restore:/restore restic restore latest --target /restore --include /files/evidence/<org-id>`, check the files, then `mv /mnt/files/restore/files/evidence/<org-id> /mnt/files/evidence/` (owner 1000:1000 is kept). The `restic` service is read-only with `cap_drop: ALL`, so the restore needs the writable bind and CHOWN and FOWNER; `infra/restore-test.sh` restores the same way.
- Drill: `infra/restore-test.sh` exercises PITR (including the `glitchtip` and `umami` databases, REL-05), the one-tenant export and load, and restic locally, and prints `restore-test: restore <N>s, tenant load <N>s`; run it each quarter and at handover. Those numbers come from a local posix repository and the sample seed, so they are not the RTO. The quarterly scratch-VM drill against the real R2 repository measures the RTO: time from the decision to restore to `/healthz` green on the restored cluster, split into fetch and restore, migrations and rebuild, and the app checks. Log each drill here as one line: date, repository (R2), database size, restore minutes, rebuild minutes, total, who ran it. No drill against R2 has run yet (no host).

## Restore One Tenant

Export, then a reviewed load. The live cluster is only read until step 4.

1. `sudo infra/restore-tenant.sh <slug> <UTC time>`. It restores the pgBackRest repository to that time into a scratch cluster under `/mnt/pgdata/restore/` (archiving off, so no second timeline reaches the repository, no TCP listener, 256 MB buffers), exports every table with a tenant key (`org_id` or `organization_id`, including `issue_reports`, which reaches `organizations` only through `issues` and `reports`) for that tenant with `infra/tenant-export.sh`, which refuses when a table without a tenant key references tenant rows, removes the scratch cluster, and prints the live `audit_log` actions for the tenant after that time (`after-target.txt`). The export directory holds one `<table>.copy` file per table in PostgreSQL's COPY text format with a header line (not CSV: text format writes a backslash, CR and LF inside a value as `\\`, `\r` and `\n`, so no data line can be the `\.` that ends in-line COPY data in `psql`, whatever a citizen typed), `manifest.tsv` (FK depth, table, tenant key, rows, `keep` or `replace`, columns without generated ones) and `org_id`. It is personal data: it stays on the encrypted volume, mode 0700, and is deleted when the load is done.
2. Decide from `after-target.txt` before loading. Rows of these actions after the time are lost by the load and must be applied again afterwards: `issue.take_down`, `issue.unpublish`, `issue.redact` (legal and redaction duties), `demand.hide`, `demand.delete`, `complaint.decide`, `complaint.appeal_decide` (complaint outcomes), `evidence.decide`, `report.reject`, `account.close`, `account.close_minor` (deletions). If a takedown or a closure is in the list, keep intake paused (`/kelola/pengaturan`) and re-apply it before anything else in step 5.
3. Tables marked `keep` stay live: `audit_log` (append-only by trigger), `org_counters` (public codes already sent must never be issued again), `members` and `invitations` (staff access after the time stands). `organizations` is not exported.
4. `sudo infra/tenant-load.sh /mnt/pgdata/restore/<slug>-<stamp>/export` prints `after-target.txt`, the tenant id and each table with its row count, loads nothing and exits 1. After the step 2 decision, run it again with `--confirm`. It loads as the superuser in one transaction (`psql` inside the `postgres` container; the COPY rows are streamed in with `HEADER MATCH`, so a file whose columns differ from the manifest is refused, and nothing is copied into the container): each `replace` table is staged in a temp table, then foreign keys are emulated from the catalog, parents first. A staged row whose referenced row is gone (a deleted user, a pruned `email_log` row, or a parent row the load already dropped) is dropped when the key is `ON DELETE CASCADE` or `NO ACTION` (for example `reports.user_id`, `follows.user_id`, then their `issue_reports`, `evidence` and `moderation_decisions`) and gets the key set to null when it is `SET NULL` (`notifications.user_id`, `notifications.email_log_id`, `content_complaints.user_id`). Staged `notifications` not in a final status (`pending`, `sending`) become `skipped` with error `restored`, so nothing is sent twice. Then the live rows for the tenant key are deleted in reverse manifest order and the staged rows inserted in manifest order with the manifest column list. `keep` tables are not touched. It refuses, and rolls back, when the tenant is not in the database, a staged row holds another tenant key, a table outside the export references a restored table (export again with the current schema), or a key is `SET DEFAULT` or self-referencing. Each rule and table prints one `tenant-load:` line: keep that output in the incident record with the operator, the target time and the tables, because `audit_log` has no restore action. A `reports drop user_id` line means reports of a deleted account were left out; the issues they were linked to keep the report counts they had at the target time.
5. Re-apply the step 2 actions in the admin pages, `REFRESH MATERIALIZED VIEW national_aggregates`, wait for the next `aggregate-refresh` tick (every 15 minutes; there is no one-shot command, and `/healthz/jobs` `dashboard_snapshot_stale` clears after it), restore the tenant's evidence files from restic (above), lift the intake pause, and delete the restore directory (`rm -rf /mnt/pgdata/restore/<slug>-<stamp>`).

Drilled: `infra/restore-test.sh` migrates a cluster with the production migrations, seeds both campuses with the sample seed, restores it to a time T, exports `itb` from the restored cluster, then changes and deletes `itb` rows after T on the live cluster (an edited issue, a deleted issue, a new notification, a deleted reporter account, a pruned `email_log` row) and runs step 4 without and with `--confirm`. It checks per-table checksums: every `itb` `replace` table equals its state at T with the deleted account and the notification rule applied, every `itb` `keep` table, every `ugm` table and every shared table is byte-identical before and after the load. It needs `bun` and the dev clamd (`bun run db:up`) for the sample seed and binds `127.0.0.1:5198` (`RESTORE_TEST_PORT`). Not drilled: a load against the production host itself.

## Deploy Notes

- `deploy.sh` waits up to 420 s (`--wait-timeout 420`), because `worker-media` waits for `clamav` to be healthy (`start_period` 300 s). `worker`, `worker-media` and `worker-whatsapp` have a heartbeat healthcheck (`WORKER_HEARTBEAT=/tmp/alive`, touched after "worker started" and after each 60 s self-check, unhealthy after 150 s without a touch), so a worker that crash-loops on boot fails `up --wait` and triggers the rollback.
- On a failed deploy, `on_exit` checks out the previous SHA before `deploy.sh rollback <prev>`, so the rollback runs that commit's scripts, compose file, Caddyfile, 503 page, smoke check and Postgres tag, and the working tree ends on the SHA that is running.
- A contract migration (`*_contract`, currently `0013` and `0017`) makes every older SHA unrollable; `deploy.sh` reads `infra/.deployed-history` and `infra/.migrated-history` and prints the oldest allowed SHA.
- `worker-media` deletes leftover `$TMPDIR/sb-media-*` scratch directories at boot (log `scratch swept`).
- Images by digest (21 October 2026, SC-04): `deploy-gate.sh` accepts `deploy <sha> <app-digest> <postgres-digest>` and `rollback <sha>` only, and `infra/.deployed-history` lines end with both digests; `lib.sh` `compose` reads the running digests from the last line, so the backup and tenant scripts need one deploy made with this version before they run. A manual `deploy` from the Deploy workflow builds, stack-tests and passes the digests like a push to `main`. Rolling back to a SHA deployed before this change is refused (no digests recorded); no host existed then.
- `deploy.sh` ends with exit 3 after a good deploy when `smoke.ts edge` finds the Cloudflare TLS or http settings off the [Cloudflare Checklist](../infra/README.md#cloudflare-checklist) (TLS 1.0 or 1.1 accepted, TLS 1.2 or 1.3 refused, `http://` not 301 to https, `/api/v1` over `http://` not blocked, HSTS missing); fix the zone settings, then rerun `bun smoke.ts edge <host>` in the app image.
- The first deploy with the internal networks (21 October 2026, ASVS V13.2.5) recreates every container, because each one's networks change; GlitchTip, Umami and Caddy lose Internet access by design.
- After a deploy that bumps `SNAPSHOT_VERSION` (now 6), `/data` shows "Angka Belum Tersedia" and the success-page median is hidden until the next `aggregate-refresh` tick (at most 15 minutes). Wait for the next tick; there is no one-shot command for it yet.
- Add `/aksesibilitas` and `/tuntutan*` to the Cloudflare Cache Rule path list if the zone predates them (`infra/README.md`).
- The deploy that first ships the `__Host-sb` cookie prefix (21 October 2026) signs every user out once, because Better Auth no longer reads `__Secure-sb.*`. Before it, change the Cloudflare cache bypass rule to `http.cookie contains "__Host-sb.session_token"` (keep the old name in an `or` until a week after the deploy), and tell staff they must sign in and enter TOTP again.
- Launch step, once every tenant host is verified on HTTPS: set `HSTS_POLICY=max-age=31536000; includeSubDomains` in `infra/.env.sops` and deploy (`compose up -d` recreates `web` and `caddy`, whose environment changed), then check `curl -sI https://<host>/ | grep -i strict-transport` on the apex and one campus host. Lowering it later does not shorten what browsers already stored.
- A Postgres image change (`pg-hba.conf` or `postgresql.conf`) restarts Postgres at the deploy. `pg-hba.conf` admits each role only from its own network (architecture.md, Database Roles and RLS); a container that newly needs the database needs a line there first, or it gets "pg_hba.conf rejects connection".

Log shipping (21 October 2026): before the first deploy that carries migration 0033, install the new units on an existing host (`sudo infra/host-setup.sh`, or copy `infra/host/logs-ship.{service,timer}` to `/etc/systemd/system`, `systemctl daemon-reload` and `systemctl enable --now logs-ship.timer`). Otherwise `/healthz/jobs` pages with `backup_logs_age_s` -1 once `HEALTH_BACKUP_CHECKS` is on.

## WhatsApp Sender

`worker-whatsapp` sends sign-in codes from one dedicated number through the unofficial Baileys library. WhatsApp can ban that number at any time; email always keeps working.

- The handset is a credential: it stays locked and with the superadmin on duty, no WhatsApp Web or other device is linked to the number besides `worker-whatsapp`, and every handover checks the phone's linked-devices list and `/admin/whatsapp`. Codes are sent as disappearing messages and the chat is deleted right after each send, so the phone should show no code chats; if it does, read `compose logs worker-whatsapp` for `whatsapp chat delete failed`.

- First deploy: sign in as superadmin, open `/admin/whatsapp` (step-up TOTP), and link the number by QR code or by pairing code from the phone's WhatsApp, Linked devices. Use a number used for nothing else.
- `whatsapp_down` 1 with status "Dilepas dari ponsel" (logged out): relink at `/admin/whatsapp`. Status "Terputus": read `compose logs --since 30m worker-whatsapp`; the worker reconnects with backoff (5 s to 60 s); restart it if it does not. Right after a worker restart or deploy the status reads "Terputus" for the seconds until the socket opens, and the WhatsApp option is unavailable meanwhile (email works). "Kesalahan terakhir" shows the worker's fault code as text (dilepas dari WhatsApp, waktu menautkan habis, or "Terputus (kode N)").
- Rotating `WHATSAPP_CREDS_KEY` in `infra/.env.sops` makes the stored session unreadable: redeploy, then relink. Rotating `WHATSAPP_JOB_KEY` drops codes still in the queue (they expire in 5 minutes anyway).
- The number is banned, or sends fail again and again: switch to the official API. Get an approved copy-code authentication template and a verified Meta Business account, set `WHATSAPP_PROVIDER=meta`, `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_TEMPLATE` (and `META_WA_LANGUAGE`, default `id`) in `infra/.env.sops`, redeploy, and check `/admin/whatsapp` says no number is linked there. Each message then costs money (PLAN §12).
- Never link a real WhatsApp number in a dev environment and choose WhatsApp for a seed account: seed numbers are fictional but could belong to someone.

## Image Security Updates

`infra/Dockerfile` pins the Debian main archive to the base image's snapshot and the security archive to `DEBIAN_SECURITY_SNAPSHOT` (a snapshot.debian.org timestamp, now `20261016T152439Z`), then runs `apt-get upgrade`. When the `image` job or the scheduled scan fails on a Debian package that has a fix, pick the newest `debian-security` timestamp from https://snapshot.debian.org/archive/debian-security/ that carries the fixed version, set it as the ARG default, rebuild, and run `infra/osv-scan.sh image <image>` until it prints `"blocking":0`. Never add an ignore for a Debian finding that has a fix. `infra/postgres.Dockerfile` carries the same `DEBIAN_SECURITY_SNAPSHOT` (keep both equal) and `PGBACKREST_VERSION`: when apt.postgresql.org publishes a newer pgBackRest the Postgres build fails with the `dpkg-query` test, so read the new version with `docker run --rm --entrypoint dpkg-query <old image> -W pgbackrest` on a fresh build without the test, check its release notes, set the ARG and rebuild. Fixes in Debian point releases (not the security archive) need a newer PostGIS base digest, which moves PostgreSQL and PostGIS too; its scan is report-only until the team decides (decisions.md Dependency scanning).

## Failover

Restore onto a standby host (infra/README First Setup, then [Restore](#restore)). Stop the old `cloudflared` first, or rotate the tunnel token and delete the tunnel's connections through the Cloudflare API if the old host is unreachable or compromised; then start `cloudflared` on the new host with the same token. No DNS change.

## DR

Five scenarios, each ending with [Restore](#restore): disk or server loss (new host, First Setup, restore latest); compromise or ransomware (new host, rotate the tunnel token and every secret, restore to before the intrusion, then `bun db/sessions.ts revoke --all` so no session from before survives); logical corruption (PITR or tenant restore); the campus withdraws the server (new host anywhere in Indonesia); Cloudflare account loss (recovery codes in the password manager, two Super Administrators).

## Incident

Severities: SEV1 (personal-data exposure starting the UU PDP 3×24 h clock, see [Personal Data Breach](#personal-data-breach-uu-pdp-pasal-46), a Komdigi takedown order, a failed takedown purge, origin down over 30 minutes, data loss); SEV2 (submission or moderation broken, backups failing over 24 h); SEV3 otherwise. Roles: lead, comms, scribe. Levers: [rollback](../infra/README.md#deploy-and-rollback), [manual purge](#manual-purge), end sessions (`docker compose ... run --rm migrate bun db/sessions.ts revoke <email>` for one person without touching their data, `revoke --all` after a suspected session or secret compromise: everyone signs in again), the per-tenant intake pause at `/kelola/pengaturan` or `INTAKE_PAUSED=true` for every campus, `WHATSAPP_ENABLED=false` in `infra/.env.sops` then a deploy (or `compose stop worker-whatsapp` at once; the graceful stop writes status `stopped` with every provider (baileys, meta), so WhatsApp shows as unavailable at once, email keeps working, `/admin/whatsapp` reads "Layanan dihentikan", and `/healthz/jobs` stays green with `whatsapp_ready` 0 and `whatsapp_down` 0, so every other deep check still pages; only a crash, a hung sender or a banned number turns `whatsapp_down` to 1 (a banned number, `logged_out`, keeps paging across deploys and restarts until it is relinked at `/admin/whatsapp`, so pull the lever to silence it while a new number is prepared); because the monitors stay green, close the incident only after `WHATSAPP_ENABLED` is back to true, the worker runs again and `/admin/whatsapp` reads "Tersambung", and note the lever in the incident record while it is pulled) to turn WhatsApp codes off, Under Attack mode in Cloudflare. A blameless postmortem is due within 7 days for every SEV1 and SEV2 (`docs/decisions.md`, Postmortems).

## On-Call

One named primary per week in the ops Telegram group, best effort. Handover: sign in to HetrixTools, Cloudflare, R2, B2 and GHCR; check that the WhatsApp sender number is still linked and that the phone holding it is handed over; confirm both Cloudflare Super Administrators can sign in; re-enable GitHub scheduled workflows; transfer age keys; rotate secrets per key type; [offboard](#offboarding) departed staff; run one rollback and one [restore drill](#restore).

## Load Test

PLAN §13 Phase 1 exit (decisions.md Throughput): uncached SSR at 30 requests per second for 10 minutes, p95 under 500 ms and no 5xx, while 10 clients from at least 3 source IPs start 50 MB uploads at once; slots past 4 per process answer 503 with `Retry-After` and every upload still completes. Then a 1 h soak.

1. Prepare one awaiting upload per client: a signed-in reporter's session cookie and an `evidence` row in `awaiting_upload` for a 50 MB MP4, written as `[{ "cookie": "...", "evidenceId": "..." }]` to `uploads.json`.
2. On the server, note how often `web` has restarted:

   ```sh
   sudo -u deploy bash -c 'source infra/lib.sh && load_env && docker inspect -f "{{.RestartCount}}" "$(compose ps -q web)"'
   ```

3. Run from three machines, one third of the clients each, against the origin through Access (no CDN):

   ```sh
   docker run --rm --network host -v "$PWD/infra:/s:ro" -v "$PWD/load:/k:ro" \
     grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34 \
     run -e BASE=https://<access-hostname> -e HOST=itb.<domain> -e ORIGIN=https://itb.<domain> \
     -e UPLOADS=/k/uploads.json -e UPLOAD_FILE=/k/video.mp4 -e SOAK=1h /s/load-test.js
   ```

4. Thresholds fail the run on their own, including a 503 without a positive `Retry-After` (the `503 has Retry-After` check counts in `checks{scenario:uploads}`). Each machine sees only its own clients, so add up `upload_busy` from the three summaries: the sum must be above 0, or the slot cap never answered 503 and the run does not show it. Run the step 2 command again: the restart count must be unchanged. Delete the test reports afterwards. A run without `UPLOADS` still prints `checks{scenario:uploads}` as passed (k6 2.3.0 marks a threshold with no samples as passed at 0.00%), so only a run that sets `UPLOADS` counts as upload acceptance.

Local drill (21 October 2026, not the origin): the production compose from `infra/stack-test.sh` plus a port for Postgres on 127.0.0.1:5198, migrations, regions, organizations and the sample seed, then 10 `awaiting_upload` video rows with real session cookies and a 50.7 MB MP4. k6 runs in a container on the stack's `edge` network against Caddy (`BASE=http://172.31.10.10`), where Caddy trusts `CF-Connecting-IP`; each `uploads.json` entry may carry `"ip"`, sent as `CF-Connecting-IP`, to stand in for three source IPs. Sample memory with `docker stats` every 10 s; `docker stats` counts the page cache of files that `web` wrote, so read `anon` in the container's `memory.stat` for process memory.

## SLO

Proposed until the team decides PLAN §14 item 10: public reads 99.5% over 30 days, origin `/healthz` 99.0%, RPO 5 minutes for the database and 6 h for evidence, RTO 24 h, origin SSR latency p95 ≤ 300 ms and p99 ≤ 1 s for GET 2xx (the Server Budget in [architecture.md › Performance Budgets](architecture.md#performance-budgets), read from the request log `dur_ms`: `docker compose logs --no-log-prefix --since 720h web | jq -R 'fromjson? | select(.msg == "request" and .method == "GET" and .status < 300) | .dur_ms'`, sorted, the value at 95% and 99% of the lines). Checked from HetrixTools, the request log and the quarterly drill.

Error budget, also **[proposed]** with the SLO (REL-02): 30 days are 43,200 minutes, so public reads may be down 216 minutes (0.5%) and origin `/healthz` 432 minutes (1.0%) in any 30 days, read from HetrixTools' monthly uptime. What happens when a budget is spent stays the adopt-later policy in [decisions.md › Error budgets](decisions.md) (monthly review, feature merges paused for 2 weeks except security and P0 fixes) until its trigger fires or the team adopts it earlier; until then a spent budget is recorded in the handover log and raised at the next team meeting.
