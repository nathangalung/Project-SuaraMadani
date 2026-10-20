# Sadar Bersuara

Sadar Bersuara is an independent public-issue reporting and monitoring platform run by Indonesian student organisations, civil to civil; it is not a university or government service. A reporter files a private report; an admin of the student organisation verifies it (or rejects it with a reason) before anything is public, and merges related reports into a public **issue**; an admin then forwards the issue to the responsible agency through that agency's official channel and tracks the ticket, the deadline and the response in the open. Admins also write **tuntutan** (demands), national or regional, each in one category and broken into subtuntutan with a response and a fulfilment status, dated sourced updates and optional policy briefs; signed-in citizens rate how important a tuntutan is (1 to 5, anonymously or under their name), and campus home pages show tuntutan right under the hero. One deployment serves many organisations: each has its own subdomain, theme and admin queue, and the bare domain shows combined national numbers.

The product is in Indonesian (formal "Anda"); code, comments and these docs are in English. Phase 1 of the roadmap is mostly built; the items still open are marked [sebagian] and [belum] in [PLAN.md](PLAN.md) §13 and listed in [docs/architecture.md](docs/architecture.md) (Implementation Status).

| Document | What It Holds |
|---|---|
| [PLAN.md](PLAN.md) | Product plan and roadmap (Indonesian): concept, flows, legal, roadmap with status marks |
| [docs/architecture.md](docs/architecture.md) | How the system is built: modules, RLS, request lifecycle, data flows, jobs, email, caching, security, deploy, every tuning value, folder tree |
| [docs/decisions.md](docs/decisions.md) | One row per engineering decision, with triggers to revisit and sources |
| [DESIGN.md](DESIGN.md) | Design contract: tokens, components, motion, page flow, copy rules |
| [docs/mockup-port-map.md](docs/mockup-port-map.md) | Where every file of the original mockup went |
| [infra/README.md](infra/README.md) | Production host setup, unlock after reboot, Cloudflare checklist, monitors |

## Stack

Bun 1.4.3, React 19 with React Router 8 (framework mode, server rendered), Hono, Tailwind CSS 4, Paraglide JS, PostgreSQL 18 with PostGIS and row-level security per campus, Drizzle ORM, Better Auth (sign-up with name, email and WhatsApp number; sign-in codes by email or WhatsApp through our own plugin; TOTP for admins), pg-boss queues in the same database, sharp, `heif-dec`, `pdftoppm`, ffmpeg and ClamAV for evidence files, and Baileys (an unofficial WhatsApp Web library) in a separate `worker-whatsapp` process, with a Meta Cloud API adapter as the official fallback. Production runs as Docker Compose behind Caddy and Cloudflare Tunnel. Exact versions are pinned in `package.json`, `infra/Dockerfile` and `infra/compose.yaml`.

## Prerequisites

- **Bun 1.4.3** (`engines` in `package.json`; CI and the image use exactly this version). Install it with `curl -fsSL https://bun.com/install | bash -s "bun-v1.4.3"`; the script installs into `$BUN_INSTALL` when that is set (default `~/.bun`) and replaces the Bun already there.
- **Docker Engine with Docker Compose** for the dev services (PostgreSQL with PostGIS, Mailpit, ClamAV).
- Free local ports: 5173 (dev server), 55432 (Postgres), 51025 and 58025 (Mailpit SMTP and web UI), 53310 (clamd). Every dev service binds to `127.0.0.1` only.
- To build the sample data: `pdftoppm`, `pdfinfo`, `ffprobe` and `ffmpeg` on your `PATH` (Debian and Ubuntu: `poppler-utils` and `ffmpeg`).
- A browser that resolves `*.localhost` to your machine (current Chrome, Firefox and Safari do; so does `curl`).

## First-Time Setup

Run every command from the repository root.

1. Install dependencies exactly as locked:

   ```sh
   CI=true bun install --frozen-lockfile
   ```

   Bun runs no dependency install scripts here, so enable the Git hooks yourself (Biome and typecheck before each commit):

   ```sh
   bunx lefthook install
   ```

2. Create `.env` from the example and add the secrets, as CI does:

   ```sh
   cp .env.example .env
   {
     echo "BETTER_AUTH_SECRETS=1:$(openssl rand -base64 32)"
     echo "LACAK_LINK_KEYS=1:$(openssl rand -base64 32)"
     echo "AUDIT_HMAC_KEY=$(openssl rand -base64 32)"
     echo "WHATSAPP_JOB_KEY=$(openssl rand -base64 32)"
     echo "WHATSAPP_CREDS_KEY=$(openssl rand -base64 32)"
   } >> .env
   ```

   The appended lines override the empty ones above them. `BETTER_AUTH_SECRETS` and `LACAK_LINK_KEYS` are versioned keyrings (`<version>:<base64>`, newest first); the other three are plain base64 keys. `WHATSAPP_JOB_KEY` seals the WhatsApp code jobs; leave it empty and WhatsApp shows as unavailable while email codes still work. `WHATSAPP_CREDS_KEY` seals a Baileys session and is only read with `WHATSAPP_PROVIDER=baileys`. The example already holds the local database URLs, Cloudflare's always-pass Turnstile test keys, `EMAIL_PROVIDER=mailpit` and `WHATSAPP_PROVIDER=dev` (WhatsApp codes go to Mailpit, no real WhatsApp), so nothing else is needed for development.

3. Start PostgreSQL, Mailpit and ClamAV, and wait until they are healthy (ClamAV loads its signatures on first start, which takes a minute or two):

   ```sh
   bun run db:up
   ```

   `bun run db:down` stops them again; the database volume is kept.

4. Apply the migrations, then load the region list, the two dev organisations with their admin accounts, and the sample data:

   ```sh
   bun run db:migrate
   bun db/seed/regions.ts
   bun db/seed/organizations.ts
   bun run db:seed:sample
   ```

   The sample seed gives ITB 180 reports and 43 issues and UGM 40 reports and 9 issues, across every status, with follows, complaints and processed evidence (photos, plus per campus one undecided PDF, one undecided video and one photo the reporter has not sent yet, visible on `/lacak` for about a day after seeding), and sample tuntutan: ITB 7 (2 national, 5 regional in Jawa Barat and DKI Jakarta, one closed, one draft) and UGM 5 (1 national, 4 regional in DI Yogyakarta, Jawa Tengah and Jawa Timur), each with a category and 3 to 6 subtuntutan, dated updates, a few issue links and one-page sample policy brief PDFs scanned by the dev ClamAV. Sample bodies, notes, sources and brief summaries start with "[Data sampel]". So every public page and `/kelola` has content. It runs the real evidence jobs, so it needs `pdftoppm`, `pdfinfo`, `ffprobe` and `ffmpeg` on your `PATH` and the ClamAV container from `bun run db:up`. It refuses to run with `NODE_ENV=production` or against a non-local database, and a second run changes nothing. `bun run db:seed:sample --reset` removes the sample rows, tuntutan, files and accounts (audit log rows stay, because the audit log is append-only). Re-running `bun db/seed/organizations.ts` resets the dev campus themes.

5. Start the dev server:

   ```sh
   bun run dev
   ```

   | Host | What You See |
   |---|---|
   | http://itb.localhost:5173 | KM ITB, with the KM ITB theme |
   | http://ugm.localhost:5173 | BEM KM UGM, default theme, low-data notes on `/data` |
   | http://localhost:5173 | The apex host: national numbers from every campus, no sign-in, no JavaScript |

   The campus is chosen from the `Host` header; `APEX_HOST=localhost` in `.env` makes the bare host the national view.

6. Start the three workers in three more terminals. Without them, emails, follower notifications, takedowns, the 15-minute dashboard refresh, the daily retention cleanup, evidence processing, policy brief scans and WhatsApp codes wait in the queue:

   ```sh
   bun run worker
   bun run worker:media
   bun run worker:whatsapp
   ```

   `worker` runs the `aggregate-refresh`, `email-send`, `issue-notify`, `demand-notify`, `takedown` and `maintenance-daily` queues; `worker:media` runs `evidence`, `evidence-video`, `evidence-publish` and `evidence-brief`, which call `heif-dec`, `pdfinfo`, `pdftoppm`, `qpdf`, `ffprobe`, `ffmpeg` and the dev ClamAV (the Docker image has the tools; without `qpdf` on the host an uploaded policy brief stays "Menunggu pemindaian", because only a metadata-stripped copy is ever served; to try briefs on such a host, run the media worker in the media test image: `docker compose -f infra/compose.dev.yaml --profile media build media-test`, then `docker run --rm --network host --user "$(id -u):$(id -g)" -v "$PWD":/app -w /app -e WORKER_QUEUES=evidence,evidence-video,evidence-publish,evidence-brief suara-madani-dev-media-test bun --env-file=.env worker/index.ts`); `worker:whatsapp` runs `whatsapp-send` with the provider from `WHATSAPP_PROVIDER` (`dev` locally) and needs `WHATSAPP_JOB_KEY`. Each logs `{"msg":"worker started",...}` when it is ready. While `worker:whatsapp` runs, the sign-in form offers WhatsApp; without it, WhatsApp shows as unavailable.

## Emails and WhatsApp Codes in Development

All mail goes to Mailpit: open **http://127.0.0.1:58025**. Sign-in codes are sent to every address, including the `.test` dev accounts. With `WHATSAPP_PROVIDER=dev` and `bun run worker:whatsapp` running, a code sent by WhatsApp also lands in Mailpit, as an email to `wa-<number>@whatsapp.localhost` (for example `wa-6281100000101@whatsapp.localhost`) holding the plain WhatsApp text. Never link a real WhatsApp number in development and choose WhatsApp for a seed account: the seed numbers are fictional but could belong to someone. Notifications (status changes, follower updates, complaint decisions) and team invitations are never sent to reserved test domains (`.test`, `.example`, `.invalid`, `.localhost`, `example.com`) or to an email the account has not verified (for example an account made with the code by WhatsApp); the notification row is marked `skipped` instead. To see those emails, sign in with an address on another domain, for example `nama@contoh.id`, with the code by email; Mailpit catches it either way.

## Dev Accounts and Admin Sign-In

| Account | Role | WhatsApp number (fictional) |
|---|---|---|
| `admin2.itb@suaramadani.test`, `admin.itb@suaramadani.test` | Admin of KM ITB (everything in `/kelola`) | `+6281100000101`, `+6281100000102` |
| `admin2.ugm@suaramadani.test`, `admin.ugm@suaramadani.test` | Admin of BEM KM UGM | `+6281100000201`, `+6281100000202` |
| `superadmin@suaramadani.test` | Superadmin (`/admin`: add an organisation, link the WhatsApp sender); no campus role | `+6281100000001` |
| `sampel.itb.NNN@contoh.test`, `sampel.ugm.NNN@contoh.test`, `sampel.<slug>.admin@contoh.test` | Sample reporters and the second sample admin, created by the sample seed; names contain "Sampel" | `+628110…` |

There is one tenant staff role, `admin`. There are no passwords. Admin pages need a second step with TOTP:

1. Open http://itb.localhost:5173/masuk, keep the "Masuk" tab, enter `admin2.itb@suaramadani.test` (or its number `0811 0000 0101`) and press "Lanjutkan".
2. Choose "Email" (or "WhatsApp" while `bun run worker:whatsapp` runs) and press "Kirim kode verifikasi". Read the six-digit code in Mailpit and enter it.
3. Open http://itb.localhost:5173/kelola. The first time you get a 403 page with "Verifikasi dua langkah", which opens `/masuk/dua-langkah`: add the setup key to an authenticator app (manual entry; there is no QR code for TOTP yet), enter the current code, confirm that you saved the backup codes, and you land on `/kelola`. Later sign-ins ask for the TOTP code after the sign-in code.
4. Admin sessions end after 12 hours. Team and settings pages (`/kelola/anggota`, `/kelola/pengaturan`) and `/admin` ask for a fresh TOTP code at `/masuk/konfirmasi` when the last one is older than 5 minutes. The superadmin signs in on a campus host the same way and lands on `/admin`.

A new account uses the "Daftar" tab: full name, email, WhatsApp number (08…, 62… or +62…) and the 18+ box, then the code channel. In production each address and number gets at most one code per minute and 8 a day; development has no cap.

To make another existing account superadmin, run `bun run db:superadmin grant <email>`; `revoke` undoes it. The dev superadmin already has the flag.

To reset a dev admin account's TOTP:

```sh
docker exec suara-madani-dev-postgres-1 psql -U postgres -d suara_madani -c "begin; delete from two_factors where user_id = (select id from users where email = 'admin2.itb@suaramadani.test'); update users set two_factor_enabled = false where email = 'admin2.itb@suaramadani.test'; delete from sessions where user_id = (select id from users where email = 'admin2.itb@suaramadani.test'); commit;"
```

## Quality Gates

Every change must pass the six gates CI runs (`.github/workflows/ci.yml`):

```sh
bun run typecheck   # react-router typegen, then tsc --noEmit
bun run lint        # biome check .
bun run test        # bun test, against the suara_madani_test database
bun run build       # react-router build
bun run size        # size-limit: first-load JS budget per route
bun run knip        # unused files, exports and dependencies
```

- `bun run test` needs `bun run db:up` first; it uses the `TEST_DATABASE_*` URLs in `.env`, and the test database is reset by the tests themselves. Run one test run at a time.
- Seven HEIC tests skip when libheif's `heif-dec` and `heif-enc` are not installed, and one policy brief test skips without `qpdf`. CI runs the suite inside the media test container, where nothing skips:

  ```sh
  docker compose -f infra/compose.dev.yaml --profile media build media-test
  docker compose -f infra/compose.dev.yaml --profile media run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp media-test bun run test
  ```

- `bun run format` applies Biome formatting. Code comments are at most five words with no `;` (`tooling.test.ts` checks it), and every UI string lives in `messages/id.json`.
- CI also runs gitleaks, osv-scanner (`infra/osv-scan.sh`), squawk on new migrations, an image build and scan, the production stack test with the PLAN §10.8 Lighthouse budgets (`STACK_LIGHTHOUSE=1 infra/stack-test.sh`, checked by `infra/lighthouse-budget.ts`), and the Playwright and axe suite in `e2e/`. Under WSL, run the Lighthouse step with `CHROME_PATH` set to a Linux Chrome (for example the Playwright Chromium); otherwise chrome-launcher starts the Windows Chrome, which never connects and keeps running.
- End to end, against a production build on port 5198 with the sample seed (Node and Chromium needed; `CHROME_PATH` may point at a local Chrome):

  ```sh
  bun run build
  PORT=5198 NODE_ENV=production EMAIL_PROVIDER=brevo BREVO_API_KEY=unused bun --env-file=.env server/index.ts &
  npx playwright install chromium
  bun run e2e
  ```

  The suite signs in a throwaway admin account (`e2e-staf@contoh.test`, created by `e2e/staff-session.ts`) to check `/kelola`; delete it afterwards on a shared database.
- Load test (k6, PLAN §13 exit): `infra/load-test.js`; see [docs/runbook.md](docs/runbook.md) for running it against the origin.

## Deploy

Production is one host running `infra/compose.yaml` (Caddy, web, worker, worker-media, worker-whatsapp, Postgres with pgBackRest, ClamAV, cloudflared) behind Cloudflare Tunnel. After the first deploy, the superadmin links the WhatsApp sender number at `/admin/whatsapp` ([docs/runbook.md](docs/runbook.md#whatsapp-sender)). Host preparation, secrets (`infra/.env.sops` with SOPS and age), the Cloudflare checklist and the monitors are in [infra/README.md](infra/README.md).

- **Normal deploy:** push to `main`. `ci.yml` runs the gates, scans and the image job, then calls `deploy.yml`, which builds and pushes `ghcr.io/<owner>/suara-madani:<sha>`, and connects through Cloudflare Access SSH to the host, where the forced command `infra/deploy-gate.sh` runs:

  ```sh
  infra/deploy.sh <sha>
  ```

  `deploy.sh` pulls the image, runs migrations in the one-off `migrate` container, starts every service with `--wait`, checks that `/healthz` reports the new SHA, runs `infra/smoke.ts` per campus host and records the deploy in `infra/.deployed-history`. Any failure redeploys the previous SHA.

- **Rollback:** run the Deploy workflow by hand with action `rollback` and an earlier SHA, which runs `infra/deploy.sh rollback <sha>` on the host. No migration runs, and a SHA older than the newest contract migration is refused.

- **Local production check** before touching a host: build both images and run the production compose on `127.0.0.1:5199`, then the backup restore drill. Neither needs a Cloudflare, R2 or B2 account.

  ```sh
  docker build -f infra/Dockerfile --target runtime --build-arg GIT_SHA=local --build-arg PGBOSS_VERSION="$(jq -r '.dependencies["pg-boss"]' package.json)" -t suara-madani:local .
  docker build -f infra/postgres.Dockerfile -t suara-madani-postgres:local infra
  infra/stack-test.sh suara-madani:local suara-madani-postgres:local
  infra/restore-test.sh
  ```

  Each script ends with `stack-test: PASS` or `restore-test: PASS`.

As of 16 October 2026 the deploy and backup paths have run only in these local drills; the first real deploy needs the GitHub environments, the Cloudflare account, R2 and B2 described in `infra/README.md`.
