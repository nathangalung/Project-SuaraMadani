# Backend Acceptance Scenarios

Every backend acceptance criterion of Sadar Bersuara, written as a Given / When / Then scenario (BDD) and automated as an acceptance test (ATDD). `bun run acceptance` (`infra/acceptance-gate.ts`, [ADR-24](decisions.md#adr-24-coverage-and-acceptance-gates)) checks this file and the tests; CI runs it in the `gates` job.

## Format

Each scenario is one level-three heading with its ID and a short title, a `Source:` line, then the steps as list items:

```md
### AC-<AREA>-<NN> Short title

Source: PLAN.md §5.7, line 1237

- Given a published issue with a claimed resolution
- When a signed-in citizen rates it a second time
- Then the server answers 409 and stores one rating
- And the refusal is audited
```

Rules the gate enforces:

- The ID is `AC-`, an area code of capital letters and digits that starts with a letter (for example `API`, `UPLOAD`, `SURVEY`), `-`, and a number of at least two digits. IDs are unique.
- `Source:` cites where the criterion is written: a PLAN.md section and line, a docs/architecture.md contract, or a docs/nfr-audit.md control the backend owns. Nothing else is a source. Every `PLAN.md §<section>, line <n>` citation outside a code fence (also `lines <a>-<b>` and `and <n>`) must name a numbered PLAN.md heading and a non-blank line inside that section (`docs/acceptance.md:<line>: PLAN.md line <n> is blank`). The gate cannot tell whether it is the intended line, so a line added to PLAN.md needs every later citation re-read by review.
- `- Given`, `- When` and `- Then` each appear at least once, in that order. `- And` and `- But` lines may follow any step.
- A scenario is automated when at least one test carries its ID in square brackets in the test's own title, for example `test("[AC-API-03] Given a published issue, when ..., then ...", ...)`. One test may carry several IDs. IDs in `describe` titles are not read.
- Tests are read from every `*.test.ts` file (`bun test`) and every `e2e/*.e2e.ts` file (Playwright) that git tracks or would track, and from the `check "[AC-...] ..."` lines of the shell tests listed in `SHELL_TESTS` (today `infra/stack-test.sh` and `infra/deploy-test.sh`, both run by the CI `image` job against a production compose stack; a gate test checks that `ci.yml` runs each one). A tagged test does not count when it is skipped, todo, fixme, failing or conditional (`.skip`, `.todo`, `.fixme`, `.failing`, `.skipIf`, `.todoIf`, `.if`), when it is `xtest`, `xit` or sits in an `xdescribe`, when an enclosing `describe` is, when Bun may not register it on load (it must sit at the top of the file or directly in a `describe` callback: inside a loop, a `catch`, an `if` or `else` block, a helper function or arrow, or after a `return` in the same `describe` body, or behind `?:`, `&&` or `||`, it does not count), when it is an `.each` over anything but a non-empty array literal (`test.each([])`, `test.each(ROWS)`), when a `test.skip(...)` or `test.fixme(...)` statement sits in the test, in an enclosing `describe` or at the top of the file, or when it is called through an alias (`const heifTest = test.skipIf(...)`). Call `test(` or `it(` directly. A `.only` fails `bun run lint` (Biome `noFocusedTests`) and, because the CI Test step passes `CI` into the container, the test run itself.
- An ID in a test title that this file does not define fails the gate, also in a skipped test.
- A test file whose brackets do not balance fails the gate (`<file>: unbalanced brackets`), so a misread regex or a cut-off file cannot move a test out of a skipped `describe`.
- Any heading that names an ID must be a level-three scenario heading in the form above; `#### AC-…`, `###AC-…` or an escaped `\[AC-…]` fails as a malformed heading instead of leaving the share unnoticed.
- At least 99% of the scenarios in Scenarios must be automated. Scenarios under Pre-Launch Checks are parsed the same way, also need a non-empty `Checked by:` line, and are left out of that share (review, not the gate, checks that the line gives the exact command and the infrastructure it waits for); at most 3 may sit there, and a fourth fails the gate. The gate prints their number as `outside` and the share with them counted as open as `withOutside`. No scenario ID may appear under Out of Scope.

Acceptance tests run at the HTTP level: the Hono app through `app.request` with the real test database, or the production server through `e2e/api.e2e.ts`. Unit tests alone do not count. The gate cannot tell a unit test from an acceptance test; review checks it. Four kinds of scenario are not driven through `app.request`, and are named here so the share stays honest: the production stack scenarios (AC-STACK) run `infra/stack-test.sh` over HTTP through Caddy against the CI images; the release scenarios (AC-DEPLOY) run the deploy gate script and the smoke script black-box, and AC-DEPLOY-03 runs `infra/deploy-test.sh`, which drives the real `deploy-gate.sh` and `deploy.sh` against a throwaway production stack and checks the result over HTTP through Caddy, from the running containers and from `infra/.deployed-history`; the code caps scenario (AC-AUTH-16) sends a `Request` to the Better Auth handler that `/api/auth/*` mounts, built with the production configuration (`dev: false`), because the caps apply in production only and the in-process app runs as `test`; and the routeless contract scenarios in the next paragraph.

## Scenarios

The bun acceptance tests are the `*.acceptance.test.ts` files beside the module they exercise. They drive the whole web process in memory through `e2e/app-harness.ts`: `createApp` from `server/app.ts` with every route of `app/routes.ts` behind the real root middleware (tenant from `Host`, Origin check, session, staff gate), the real test database, and real Better Auth sessions minted with the same secrets (a staff session completes TOTP). Only services outside the system are replaced, at their boundary: Cloudflare's Turnstile `siteverify` call (token `pass` passes, any other token fails), the email provider (a capturing sender, or a failing `/api/v1/send` in AC-OPS-05), the WhatsApp provider behind the `whatsapp-send` handler (a capturing or failing sender in AC-AUTH-14, whose file sets `WHATSAPP_JOB_KEY` so the app builds the real gateway), GlitchTip's ingest URL and the Cloudflare purge API. Given steps may set up rows directly; When steps go over HTTP. Where a scenario's effect is a background job (email, survey, digest), the test triggers it over HTTP, runs the worker's job handler in the same process and asserts the rows and the message handed to the email sender.

Three Phase 2 backend features have no route yet, by design (PLAN §5.5 and §5.7, "halaman ... menunggu frontend"): issue ratings per claim, the "Sudah beres?" survey and the agency right of reply, and the "Sesi Aktif" page has none either. Their boundary is the `*.server.ts` contract in [docs/architecture.md](architecture.md#resolution-claims-survey-and-right-of-reply) that the frontend routes will call. The action contracts take the route's `Request` and are called with a real one (form body, `Origin`, `X-Client-IP`) and a real session read from a real cookie: `rateClaimRequest` (AC-CLAIM-02, AC-CLAIM-04), `answerSurveyRequest` (AC-SURVEY-02 to AC-SURVEY-04), `replyRequest` (AC-REPLY-01, AC-REPLY-02) and `decideReplyRequest` (AC-REPLY-03, AC-REPLY-04, called after `requireAdmin`, which the route owns). Two scenarios call contracts that take no `Request` because the route would pass only ids: the claim section loader `claimSection(orgId, code)` (AC-CLAIM-03) and the session list `listSessions` and `revokeSessions` (AC-AUTH-12), each with the tenant and session read from a real cookie. The admin steps that already have routes go over HTTP. As of 25 October 2026: of the 136 counted scenarios, 136 are automated (100%, the gate's figure); with the 3 Pre-Launch Checks in the denominator it is 136 of 139 (97.84%, the gate's `withOutside`). Leaving out the 2 loader contracts, the production-configuration scenario and the 6 AC-STACK and AC-DEPLOY scenarios as well, 127 of 136 (93.38%) drive their When through `app.request`, a route's `Request`, or the real handler of a worker job run in process as described above.

### AC-API-01 Issue list and issue JSON carry the licence and no personal data

Source: PLAN.md §13 Fase 2, line 1208; docs/architecture.md Public Data API (Rules, Endpoints)

- Given a campus with published issues
- When a data user reads `/api/v1/isu` and `/api/v1/isu/{code}`
- Then both answer 200 JSON whose `meta` names `CC-BY-4.0`, the licence URL and the attribution line
- And the `Link` header names the licence and the HTML page
- And no payload holds a personal key (email, phone, user id, name, story, contact) or an email-shaped value

### AC-API-02 Hidden records stay hidden in the API

Source: PLAN.md §5.5, line 277; docs/architecture.md Public Data API (Rules: tenant hosts only)

- Given an unpublished issue, a removed issue, a draft tuntutan and another campus's issue
- When the API is asked for each of them, and the apex or an unknown host is asked for any list
- Then the unpublished issue, the draft, the other campus's code, the apex and the unknown host answer 404
- And the removed issue answers 410 `taken_down` with only the date and the standard
- And every error answer is `no-store`

### AC-API-03 Read only for any origin, never with credentials

Source: docs/architecture.md Public Data API (Rules: read only, CORS); docs/nfr-audit.md V4.1.4

- Given a script on another website
- When it reads the API and then tries POST, PUT, PATCH and DELETE
- Then the read carries `Access-Control-Allow-Origin: *`, exposes `ETag,Link` and never allows credentials
- And every write method answers 405 `method_not_allowed` with `Allow: GET, HEAD`

### AC-API-04 API answers are cached like public pages

Source: PLAN.md §6, line 456; docs/architecture.md Public Data API (Rules: caching)

- Given a published issue's JSON
- When it is read anonymously, read again with its `ETag`, and read with a session cookie
- Then the anonymous answer sends `public, max-age=0, no-transform`, the 60 s `Cloudflare-CDN-Cache-Control` line, a weak `ETag` and no cookie
- And the repeat with `If-None-Match` answers 304 without a body
- And the answer to a request with a session cookie is `private, no-store`

### AC-API-05 Tracking parameters and lowercase codes redirect to the canonical URL

Source: PLAN.md §10.6, line 898; docs/architecture.md Public Data API (Rules: query strings)

- Given a shared link with `utm_*` parameters, and a lowercase issue code
- When either is opened
- Then the API answers 301 to the canonical URL that keeps only the known parameters or the canonical code
- And the redirect is cacheable like a page

### AC-API-06 Each client has a request budget at the origin

Source: PLAN.md §10.3, line 803; docs/architecture.md Public Data API (Rules: rate limit)

- Given one client that used its whole budget in the current window
- When it calls the API again
- Then it gets 429 `rate_limited` with `Retry-After` and `no-store`
- But another client is still served

### AC-API-07 Dashboard tables as JSON and stable CSV with a README

Source: PLAN.md §5.8, line 331; docs/architecture.md Public Data API (Endpoints, Datasets)

- Given a campus with a dashboard snapshot
- When a data user reads `/api/v1/data`, one table's CSV and the README
- Then the metadata lists the 14 tables with stable CSV URLs and the licence
- And the CSV is `text/csv; charset=utf-8; header=present`, downloads as `<campus>-<table>.csv`, names the licence and its JSON in `Link`, and holds the same rows as the JSON
- And the README names the licence URL

### AC-API-08 No snapshot is never shown as zeros

Source: PLAN.md §5.8, line 334; docs/architecture.md Public Data API (Rules: errors)

- Given a campus whose dashboard snapshot was never computed
- When one of its tables is read
- Then the API answers 503 `snapshot_pending` with `Retry-After: 900`

### AC-API-09 Report counts from one to four are suppressed

Source: PLAN.md §5.8, line 332; docs/architecture.md Public Data API (Datasets: empty cell); docs/architecture.md Starting Values (Public suppression)

- Given a campus whose only published issue holds three verified reports, with two reports rejected under standard 3 and five under standard 2
- When the dashboard job runs and the region and reason tables are read as JSON and CSV
- Then the province row exists and its cell is empty (`null`), the standard 3 cell is empty and the standard 2 cell shows 5
- And no cell of either CSV shows 1 to 4, and the metadata publishes the minimum n of 5

### AC-API-10 CSV cells cannot start a spreadsheet formula

Source: docs/architecture.md Public Data API (Datasets: CSV); docs/nfr-audit.md V1.2.10

- Given a published issue whose title starts with `=`
- When the issue ranking CSV is downloaded
- Then that cell starts with a `'`
- But the JSON keeps the title as written

### AC-API-11 Short searches are refused

Source: PLAN.md §6, line 437; docs/architecture.md Public Data API (Rules: errors)

- Given a search of two characters
- When the issue list is searched through the API
- Then the API answers 400 `short_query`

### AC-API-12 The tuntutan JSON shows a citizen place only from ten counted rankers

Source: docs/architecture.md Public Data API (Endpoints: `/api/v1/tuntutan/{code}`); docs/architecture.md §13 Tuntutan (Citizen ranking)

- Given a published tuntutan ranked by nine accounts at least 7 days old and three younger accounts
- When its JSON is read
- Then `ranking.rankers` is 9, `ranking.shown` is false and `rank.place` is null
- And once a tenth counted account ranks it, `rank.place` is 1 and the list row carries the same place

### AC-REPORT-01 A signed-in reporter's report is stored privately with its code, consent record and receipt

Source: PLAN.md §7, lines 547 and 558; PLAN.md §7 (Halaman sukses), lines 565-566; PLAN.md §5.4, line 266; PLAN.md §5.5, line 279

- Given a signed-in reporter with a complete step-7 form and one declared photo
- When the form is sent
- Then the server answers 201 with a code `<CAMPUS>-<yy>-<5 Crockford base32 characters>` and one evidence row to upload
- And the report holds the ticked boxes, the server time and the consent text version
- And the submission is audited as `report.submit`
- And the reporter receives one receipt email that names the code
- But the report's story never appears on a public page

### AC-REPORT-02 No anonymous reports

Source: PLAN.md §7, lines 545 and 547

- Given a visitor who is not signed in
- When the step-7 form is sent
- Then the server answers 401 `sign_in_required`
- And nothing is stored

### AC-REPORT-03 The 18+ box is required by the server

Source: PLAN.md §7, line 558; PLAN.md §11 item 3, line 1084

- Given a signed-in reporter whose form lacks the "Saya berusia 18 tahun atau lebih" box
- When the form is sent
- Then the server answers 400 with `error_consent_age_required`
- And nothing is stored

### AC-REPORT-04 Form limits are checked again on the server

Source: PLAN.md §7 step 3, line 533; PLAN.md §7 step 5, line 538; PLAN.md §10.5, line 856

- Given a form with an event date in the future, a form with six files, a photo over 10 MB and a video over 50 MB
- When each is sent
- Then each answers 400 with its field error (`error_occurred_on_future`, `error_evidence_too_many`, `error_evidence_too_large`)
- And nothing is stored

### AC-REPORT-05 A resent submission is idempotent

Source: PLAN.md §5.2, line 186 (`submission_id`); PLAN.md §10.7, line 916

- Given a report that was already stored
- When the browser sends the same submission again
- Then the server answers 200 with the same code and evidence rows
- And one report exists

### AC-REPORT-06 Turnstile guards the submit

Source: PLAN.md §10.5, line 865; PLAN.md §10.3, line 811

- Given a form whose Turnstile token fails verification
- When it is sent
- Then the server answers 403 `captcha_failed`
- And nothing is stored

### AC-REPORT-07 Contact consent copies the account's proven number, never a typed one

Source: PLAN.md §7 step 6, line 541; PLAN.md §5.2, line 187

- Given a reporter with a proven WhatsApp number who agrees to be contacted
- When the report is sent
- Then the account's number and preferred method are copied to `report_contacts`, apart from the report
- But an account without a number that agrees gets 400 `error_contact_no_phone` and nothing is stored

### AC-REPORT-08 Paused intake refuses new reports

Source: PLAN.md §5.10, line 384; PLAN.md §13 Fase 1, line 1192

- Given a campus whose admin paused report intake
- When a report is sent
- Then the server answers 503 `intake_paused`
- And nothing is stored

### AC-REPORT-09 Daily report quota per account per campus

Source: PLAN.md §10.5, line 865; docs/architecture.md Starting Values (Business quotas: 5 reports per account per campus per 24 h)

- Given a reporter who sent five reports in the last 24 hours
- When a sixth is sent
- Then the server answers 429 `quota_exceeded`
- And five reports exist

### AC-REPORT-10 The success page never confirms a report that is not there

Source: PLAN.md §7 (Halaman sukses), line 571

- Given a report sent to one campus
- When its success page is opened on that campus, on another campus, and with a code never sent
- Then the own campus shows the code
- And the other campus and the unsent code answer 404

### AC-REPORT-11 The emailed tracking link shows one report, privately, for 30 days

Source: PLAN.md §6, line 450; PLAN.md §7 (Halaman sukses), line 569; docs/architecture.md Email (Signed links)

- Given a reporter's receipt email with its `/lacak?t=` link
- When the link is opened without a session
- Then the page shows that report with `private, no-store` and `Referrer-Policy: no-referrer`
- And the token is valid until 30 days after the mail was sent and not after
- But a tampered token and a token past its expiry answer 200 with the invalid-link state and no report

### AC-REPORT-12 A long review queue is announced to reporters

Source: PLAN.md §5.10, line 383

- Given a dashboard snapshot whose review queue holds 49 and then 50 reports
- When a reporter opens `/lacak` and the report form's layout data is read
- Then at 49 nothing is said
- And at 50 `/lacak` says "Pemeriksaan lebih lama dari biasanya." and the report form is flagged as slow

### AC-UPLOAD-01 The owner's file is stored privately, typed from its bytes and queued once

Source: PLAN.md §7, line 547; PLAN.md §10.5 (Unggahan), lines 860-861

- Given a submitted report with one declared photo
- When its owner sends the file to `/api/upload/<id>`
- Then the server answers 201 and the evidence row is `received` with the type read from the bytes and the byte size
- And the original is on the private volume and one `evidence` job is queued
- And sending the same file again answers 200 and queues nothing new

### AC-UPLOAD-02 Only the owner on the report's campus may upload

Source: PLAN.md §7, line 547; PLAN.md §5.11, line 424; docs/architecture.md Resumable Upload Contract (Errors)

- Given a file awaiting upload
- When it is sent without a session, by another account, and from another campus's host
- Then the answers are 401, 404 and 404
- And the file is still awaiting upload

### AC-UPLOAD-03 The type comes from the bytes, not the client

Source: PLAN.md §10.5 (Unggahan), line 860; PLAN.md §10.3, line 809

- Given a file declared as a PDF
- When image bytes are sent
- Then the server answers 415 `unsupported_type`
- And nothing is stored

### AC-UPLOAD-04 No more bytes than declared

Source: PLAN.md §7 step 5, line 538; docs/architecture.md Resumable Upload Contract (Errors: 413); docs/nfr-audit.md V5.2.1

- Given a declared file size
- When more bytes are sent
- Then the server answers 413 `too_large`
- And nothing is stored

### AC-UPLOAD-05 The upload window closes 24 hours after submit

Source: PLAN.md §7, line 548; docs/architecture.md Resumable Upload Contract (Errors: 410)

- Given a report sent more than 24 hours ago with a file never sent
- When the owner sends it or asks for its offset
- Then both answer 410

### AC-UPLOAD-06 An upload cut off mid-file resumes from the stored offset

Source: PLAN.md §7 step 5, line 540; PLAN.md §13 Fase 2, line 1211; docs/architecture.md Resumable Upload Contract

- Given a file awaiting upload
- When the owner sends half with tus `PATCH`, asks `HEAD` for the offset, then sends the rest with `POST` and `X-HTTP-Method-Override: PATCH`
- Then `HEAD` answers the stored offset and the declared length with `private, no-store`
- And the final `PATCH` answers 204 with the full offset and the row is `received`
- And the stored original equals the file byte for byte

### AC-UPLOAD-07 Protocol mistakes get their tus status

Source: docs/architecture.md Resumable Upload Contract (Request table, Errors)

- Given a resumable upload at offset 0
- When the client omits `Tus-Resumable`, sends a non-numeric offset, a wrong offset or a wrong content type, and asks `OPTIONS`
- Then the answers are 412, 400 `bad_offset`, 409 `offset_mismatch`, 415 and 204 with `Tus-Version: 1.0.0` and `Tus-Max-Size: 52428800`
- And the offset is still 0

### AC-UPLOAD-08 A PATCH from another origin is refused

Source: docs/architecture.md Resumable Upload Contract (Rules that do not change); PLAN.md §10.5, line 851

- Given a signed-in owner
- When a `PATCH` for the owner's file arrives with another site's `Origin`
- Then the server answers 403
- And the offset is still 0

### AC-UPLOAD-09 Paused intake refuses uploads

Source: docs/architecture.md Resumable Upload Contract (Errors: 503 `intake_paused`); PLAN.md §5.10, line 384

- Given a campus that paused intake
- When the owner sends a file
- Then the server answers 503 `intake_paused`

### AC-UPLOAD-10 A forwarded report's file is no longer wanted

Source: docs/architecture.md Resumable Upload Contract (Errors: 403 `report_closed`); PLAN.md §5.10, line 370

- Given a report that was forwarded to another campus
- When its file is resumed
- Then the server answers 403 `report_closed`

### AC-FOLLOW-01 Following needs an account, mails each update once, and the emailed link unfollows only on confirmation

Source: PLAN.md §5.4, line 267; PLAN.md §6, line 440; PLAN.md §10.8, line 965

- Given a published issue
- When a visitor follows it without a session, a signed-in person follows it, the issue is referred, the person opens the unfollow link from the email, posts a tampered token, then confirms with the real token, and the issue changes again
- Then the visitor is sent to `/masuk?kembali=/isu/<code>`
- And the follower receives exactly one email with a `/berhenti?t=` link whose page is `private, no-store` with `Referrer-Policy: no-referrer`
- And opening the link and posting the tampered token leave the follow in place, while confirming removes it
- And the next change is accepted (303) and mailed to the reporter, who still follows, but not to the former follower

### AC-FOLLOW-02 Issues filter by regency and search by region name

Source: PLAN.md §5.9, lines 348 and 351

- Given published issues in Kota Bandung and Kabupaten Bandung
- When `/isu` is filtered by `wilayah=32.73`, searched for "Kabupaten Bandung", and filtered by an unknown region
- Then the filter lists only the Kota Bandung issue, the search only the Kabupaten Bandung issue
- And the unknown region redirects 301 to `/isu`

### AC-PUBLIC-01 Unreviewed reports and unpublished issues are never public

Source: PLAN.md §5.1, line 173; PLAN.md §5.5, line 277; PLAN.md §13 Fase 1, line 1185

- Given a report waiting for review and an issue that was never published
- When the home page, `/isu`, a search for their words, `/tuntutan`, `/api/v1/isu`, the issue page and its OG image are read
- Then none of them shows either record, and the issue page and OG image answer 404
- But the published issue is listed and its OG image is a PNG

### AC-PUBLIC-02 Only anonymous success is cached at the edge

Source: PLAN.md §10.6, lines 887 and 896

- Given a published issue page
- When it is read anonymously, with a session cookie, and a missing issue is read
- Then the anonymous 200 sends `public, max-age=0, no-transform`, the 60 s `Cloudflare-CDN-Cache-Control` line and no cookie
- And the session render is `private, no-store` without the CDN line
- And the 404 is `no-store`

### AC-PUBLIC-03 Unknown query parameters redirect to the canonical URL

Source: PLAN.md §10.6, line 898

- Given a shared `/isu` link with `fbclid` and `utm_*`
- When it is opened
- Then the server answers 301 to the URL with only the known parameters, cacheable like the page

### AC-PUBLIC-04 Searches need three characters and stop at page 50

Source: PLAN.md §6, line 437

- Given the issue list
- When it is searched with two characters, and a cursor for page 51 is followed
- Then the first answers 200 with a `short_query` result instead of a list, and the second says "Persempit pencarian Anda"

### AC-PUBLIC-05 Pages carry the security headers

Source: PLAN.md §10.5, line 864; docs/nfr-audit.md V3.4.3

- Given a page served through Caddy's TLS hop
- When it is read
- Then the CSP's `script-src` holds the `sha256-` hash of every inline script in the served page, `'strict-dynamic'` and no `'unsafe-inline'` or `'unsafe-eval'`, and the CSP has `frame-ancestors 'none'`
- And it sends `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` with `geolocation=(self)`, `Strict-Transport-Security: max-age=300` and `no-transform`
- But a plain HTTP request gets no HSTS

### AC-PUBLIC-06 Region lists for the cascading selects

Source: PLAN.md §5.9, line 339; PLAN.md §6, line 449

- Given the official region codes
- When `/wilayah/32.json` and an unknown code are requested
- Then the first lists the province's regencies with a one-day CDN cache
- And the unknown code answers 404

### AC-PUBLIC-07 The apex shows only the national view

Source: PLAN.md §5.11, line 423; PLAN.md §6, line 435

- Given the apex domain
- When its home and `/tuntutan`, `/lapor`, `/masuk`, `/kelola`, `/isu` and `/api/v1` are opened
- Then the home answers 200, cacheable, lists the campus hosts and has no form
- And every other path answers 404

### AC-PUBLIC-08 Unknown and non-canonical hosts get nothing

Source: PLAN.md §5.11, line 423; docs/nfr-audit.md V1.5.3

- Given a host no campus uses, an uppercase host and a host with a trailing dot
- When a page is requested
- Then each answers 404 `no-store`

### AC-PUBLIC-09 Health checks are never cached and job details need the token

Source: PLAN.md §6, line 457; PLAN.md §10.9, line 973; docs/nfr-audit.md V13.4.5

- Given the uptime monitors
- When they call `/healthz`, and `/healthz/jobs` with and without the bearer token
- Then `/healthz` answers 200 `{status, sha}` with `no-store`
- And `/healthz/jobs` shows only `ok` without the token and `ok` with `checks` with it, both `no-store`

### AC-PUBLIC-10 Hostile URLs and oversized forms are refused early

Source: docs/nfr-audit.md V5.2.1; docs/nfr-audit.md A05

- Given a URL with a NUL byte and a form body over 128 KB
- When they are sent
- Then the server answers 400 and 413 `no-store`

### AC-MOD-01 Every review step changes the report and emails the reporter

Source: PLAN.md §5.4, lines 227-235 and 266; PLAN.md §5.4, line 263

- Given a new report
- When an admin starts the review and then verifies it with a method
- Then the report is "in review" and then "verified"
- And the reporter receives one email per step that names the report code
- But a step sent from a status the report has left answers 409

### AC-MOD-02 A rejection carries a numbered standard and its reason to the reporter

Source: PLAN.md §5.10, lines 387-395; PLAN.md §5.4, line 266

- Given a report under review
- When an admin rejects it with a standard but a too-short reason, and then with a full reason
- Then the first answers 400 and nothing changes
- And the second stores `reason_code` and `decided_by`, emails the reporter the reason with a link to `/pedoman`, and `/lacak` shows the reason privately (`private, no-store`)

### AC-MOD-03 A merged report waits for publication, its reporter follows the issue, and closed issues take no new reports

Source: PLAN.md §5.1, line 173; PLAN.md §5.4, lines 267 and 272

- Given a verified report
- When an admin merges it into a new issue
- Then the issue page answers 404 until it is published, and the reporter follows the issue
- And once that issue is closed, merging another verified report into it is refused and the report stays verified

### AC-MOD-04 Publishing needs the whole checklist and emails followers

Source: PLAN.md §5.10, lines 400-404; PLAN.md §5.4, line 267

- Given an unpublished issue followed by its reporter
- When an admin publishes it with a partial checklist, then with all four items
- Then the partial attempt answers 400 and the issue stays hidden
- And after the full checklist the issue page and the `/isu` list show it, and the follower receives exactly one email naming it

### AC-MOD-05 Issue actions follow the two-axis state machine with sourced responses

Source: PLAN.md §5.4, lines 240-250; PLAN.md §10.5, line 857

- Given a published issue
- When an admin refers it, escalates it, marks it "Bukan kewenangan", refers it again and records a response
- Then the referral moves the advocacy axis to "Diteruskan" and the re-referral after escalation keeps "Dieskalasi"
- And a response with a `javascript:` source answers 400, a form with a stale version answers 409
- And the valid response moves the government axis to "Ditanggapi" and appears in the issue's JSON with its source

### AC-MOD-06 Showing the reporter's contact is private and audited

Source: PLAN.md §5.5, line 278; PLAN.md §10.5, line 853

- Given a report whose reporter agreed to be contacted
- When an admin presses "Tampilkan kontak"
- Then the answer holds the number, and `report.view_contact` is audited with the admin as actor
- But the report page itself never shows the number and is `private, no-store`

### AC-MOD-07 Forwarding copies the report and its evidence to the other campus, never the contact

Source: PLAN.md §5.10, line 370

- Given a report with an uploaded photo and a contact, about another campus
- When an admin forwards it to campus B
- Then campus B has one copy with its own code and the evidence, and no contact row
- And the original is "forwarded", both campuses' audit logs record the forward, and the reporter's email links to campus B's `/lacak`

### AC-MOD-08 Editing an issue is version-checked and audited without the text

Source: PLAN.md §5.10, lines 381 and 399

- Given a published issue
- When an admin changes its title
- Then the public page shows the new title
- And `issue.edit` records only the changed column names, never the text
- And a second edit with the old version answers 409

### AC-MOD-09 A legal takedown removes the issue with its reason and mails nobody

Source: PLAN.md §5.10, lines 378-380; PLAN.md §5.4, line 267; PLAN.md §10.6, line 894

- Given a published issue with a follower
- When an admin removes it under "Turunkan Isu Sesuai Perintah Hukum" for a Komdigi order
- Then the issue page answers 410 `no-store` and links to `/pedoman#perintah`
- And a `takedown` job is queued
- But the follower receives no email

### AC-MOD-10 Closing a reporter's account removes their data at that campus, never a staff account

Source: PLAN.md §5.10, line 382; PLAN.md §11 item 3, line 1084

- Given a reporter who asks for their account and reports to be deleted
- When an admin closes the account at that campus
- Then the membership, the reports and every session of the account are gone, `/lacak` no longer lists the report, and `account.close` is audited
- But closing the account of someone who is an admin at any campus answers 403

### AC-MOD-11 The original file downloads only after a clean scan, as an audited attachment

Source: PLAN.md §5.10, line 385; PLAN.md §10.5 (Unggahan), line 861; docs/nfr-audit.md V5.4.1

- Given an uploaded photo named by the reporter with a misleading extension
- When an admin downloads the original before and after the ClamAV scan
- Then the first answers 404
- And the second is the unmodified file as an `attachment` named from the detected type, with `nosniff` and a `sandbox` CSP, and `evidence.download_original` is audited
- But a reporter session gets 403 on that URL

### AC-MOD-12 The audit log is readable by admins and cannot be changed

Source: PLAN.md §5.2, line 211; PLAN.md §10.5, line 853

- Given audited actions at a campus
- When an admin opens `/kelola/audit`
- Then the actions are listed
- And the application role cannot UPDATE or DELETE an audit row

### AC-MOD-13 Merge suggestions put the same regency first and never offer closed issues

Source: PLAN.md §5.6, line 285; PLAN.md §5.4, line 272

- Given published issues in the report's regency and in another regency, and a closed issue
- When an admin opens a verified report and then searches for the other issue's code
- Then the same-regency issue is listed before the other and labelled "kab/kota sama"
- And the closed issue is not offered
- And the search lists the other issue

### AC-COMPLAINT-01 A content complaint needs an account, a reason, the part, good faith and Turnstile, and gets a private receipt

Source: PLAN.md §5.10, lines 372-373; PLAN.md §6, line 446; PLAN.md §11 item 8, line 1120

- Given a published issue
- When a visitor without a session, a signed-in person without the good-faith box, one failing Turnstile, and one with every field file a complaint
- Then the answers are 401, 400, 403 and a redirect to the receipt `/aduan/<code>`
- And the receipt page is `private, no-store` and names the code, and the complainant receives one receipt email
- But another account opening that receipt gets 404

### AC-COMPLAINT-02 Ten complaints per account per campus per day

Source: PLAN.md §5.10, line 373

- Given a person who filed ten complaints today at a campus
- When an eleventh is filed
- Then the server answers 429 and ten complaints exist

### AC-COMPLAINT-03 Admins never see who complained

Source: PLAN.md §5.10, line 373

- Given a complaint in the queue
- When an admin opens it in `/kelola/aduan`
- Then the page shows the complaint but not the complainant's name or email

### AC-COMPLAINT-04 Issue decisions edit, hide or remove with a numbered standard and tell the complainant

Source: PLAN.md §5.10, lines 374 and 396

- Given complaints about three published issues
- When an admin decides "sunting", "sembunyikan" and "hapus" (the last first without the confirmation box)
- Then the edited page shows the new title and "Disunting admin", the hidden issue answers 404 and the removed issue answers 410
- And the unconfirmed removal answers 400
- And the complainant receives the decision for each complaint

### AC-COMPLAINT-05 One appeal, decided by a different admin

Source: PLAN.md §5.10, lines 372 and 376

- Given a complaint decided by one admin
- When the complainant appeals and the same admin tries to decide the appeal
- Then that answers 403, and a different admin's decision is stored as `appeal_decided`
- And a second appeal is refused with 400

### AC-COMPLAINT-06 A tuntutan complaint can only keep or hide, and hiding returns it to draft

Source: PLAN.md §5.10, line 375

- Given a complaint about a published tuntutan
- When an admin tries "hapus" and then "sembunyikan"
- Then "hapus" answers 400
- And "sembunyikan" returns the tuntutan to draft with `hidden_at`, its page answers 404, and `demand.hide` is audited

### AC-DEMAND-01 A tuntutan needs a category to publish and stays private as a draft

Source: PLAN.md §5.4, lines 253 and 260; PLAN.md §13 Fase 1, line 1187

- Given the admin editor at `/kelola/tuntutan/baru`
- When a tuntutan is created without a category, then with one, and published
- Then the first is refused with a `category` error
- And the second gets a `TUN-<campus>-<yy>-<nnnn>` code, answers 404 publicly while a draft, and after publishing is shown on its page and in `/tuntutan`
- But a draft whose category is empty (a row from before migration 0024) cannot be published

### AC-DEMAND-02 Sub-tuntutan updates follow the axis rules and carry a source

Source: PLAN.md §5.4, lines 254-257; PLAN.md §10.5, line 857

- Given a published sub-tuntutan
- When updates are recorded that reject without a response, are dated before the raise date, lack a source text or carry a `javascript:` link
- Then each is refused with its field error
- And an update with the same state is kept as a note without moving an axis
- And "Direspons" is recorded and can never go back to "Belum direspons"
- And the public page shows the source and "Admin {organisasi}" as the author

### AC-DEMAND-03 Progress is computed, never typed

Source: PLAN.md §5.4, line 258

- Given a published tuntutan with two sub-tuntutan
- When one and then both are marked fulfilled
- Then the stored and public progress is 1 of 2 "Sebagian dipenuhi", and then "Dipenuhi"

### AC-DEMAND-04 Closing needs a public reason, reopening publishes again, and only unpublished drafts can be deleted

Source: PLAN.md §5.4, line 253

- Given a published tuntutan and a draft that was never published
- When the admin closes the first without and with a reason, reopens it, tries to delete it, and deletes the draft
- Then the reasonless close is refused, the close shows its reason publicly, reopening makes it "Terbit" again
- And deleting the published tuntutan changes nothing while the draft is gone

### AC-DEMAND-05 Tuntutan followers get one email per event

Source: PLAN.md §5.4, line 267; PLAN.md §13 Fase 1, line 1191; docs/architecture.md Email (Notifications)

- Given a person who follows a published tuntutan
- When a sub-tuntutan gets a sourced status change and the tuntutan is closed
- Then the follower receives exactly two emails, each naming the tuntutan

### AC-DEMAND-06 A ranking needs an account and Turnstile, is one whole list per account, and holds published tuntutan only

Source: docs/architecture.md §13 Tuntutan (Citizen ranking: `rankDemands`, `/tuntutan/peringkat`)

- Given published, closed, draft and hidden tuntutan
- When people save, change and withdraw a top-five list at `/tuntutan/peringkat`
- Then the page is `private, no-store`, no session answers 401, a failed Turnstile 403, an empty list or one number given twice 400
- And a list is stored in its chosen order once per account, and a second save replaces the whole list
- And withdrawing needs no Turnstile and removes the list
- And a list naming a closed, draft or hidden tuntutan answers 404 and leaves the saved list as it was

### AC-DEMAND-07 Young accounts wait seven days and the citizen place shows from ten counted rankers

Source: docs/architecture.md §13 Tuntutan (Citizen ranking: `readCitizenRanking`, `pendingRankers`); docs/architecture.md Starting Values (Home tuntutan)

- Given a list from a 30-day-old account and one from a new account
- When the tuntutan page and the admin editor are read
- Then the page says the place shows from ten rankers and counts one, and shows neither account's name nor email
- And the admin editor's data counts one list waiting for its account to reach 7 days
- And once nine more counted accounts rank it, the page shows its place

### AC-DEMAND-08 Twenty accounts per address prefix per tuntutan

Source: docs/architecture.md Starting Values (Rating eligibility: at most 20 per IP prefix); docs/architecture.md §13 Tuntutan (Citizen ranking)

- Given twenty accounts whose lists hold a tuntutan, saved from one address prefix
- When a twenty-first account saves a list holding it from that prefix
- Then the server answers 429 and the account's saved list stays as it was
- But the same account is served from another prefix, and from that prefix with a list without that tuntutan

### AC-DEMAND-09 Policy briefs are PDFs that download only after a clean scan and publication

Source: PLAN.md §5.10, line 386; PLAN.md §6, line 443; PLAN.md §10.5, line 862

- Given a sub-tuntutan of a published tuntutan
- When the admin uploads a text file, a file over 10 MB and a PDF, the PDF is scanned by `worker-media` and then published
- Then the text file is refused as not a PDF and the large file as too large
- And the PDF's download answers 404 until it is clean and published, then serves `application/pdf` as an `attachment` with `nosniff`, a `sandbox` CSP and the 60 s CDN line
- But the same file under a draft tuntutan answers 404

### AC-DEMAND-10 The admin editor flags a tuntutan whose rankers come mostly from one address prefix

Source: docs/architecture.md Starting Values (Rating eligibility: anomaly flag when more than 30%); docs/architecture.md §13 Tuntutan (Citizen ranking)

- Given a published tuntutan ranked by ten accounts, four of them from one address prefix
- And another ranked by ten accounts, three of them from one prefix
- When the admin editor's data is read for each
- Then the first is flagged (`prefixAnomaly`) and the second, at exactly 30%, is not

### AC-DEMAND-11 The admin reorders sub-tuntutan and links published issues

Source: PLAN.md §13 Fase 1, line 1187

- Given a published tuntutan with two sub-tuntutan, a published issue and an unpublished issue
- When the admin moves the first sub-tuntutan down, links the unpublished issue, links the published one and unlinks it again at `/kelola/tuntutan/<code>`
- Then `/api/v1/tuntutan/<code>` lists the sub-tuntutan in the new order, numbered 1 and 2
- And the unpublished issue is refused (`issue_code`), the published one appears in the tuntutan's `issues` and the tuntutan in the issue's `demands`, and after unlinking neither does
- And `demand.item_move`, `demand.issue_link` and `demand.issue_unlink` are audited in that order

### AC-DEMAND-12 A ranking list leaves the citizen ranking when its account is closed

Source: docs/architecture.md §13 Tuntutan (Citizen ranking: `removeAtCampus` deletes `demand_rankings`); PLAN.md §5.10, line 382

- Given a published tuntutan ranked by ten counted accounts, one of which also sent a report
- When an admin closes that reporter's account at `/kelola/laporan/<code>/tutup-akun`
- Then `/api/v1/tuntutan/<code>` counts nine rankers and shows no place
- And no tuntutan JSON carries an account's name, email or id

### AC-DEMAND-13 The tuntutan editor flags loaded words, double exclamation marks and shouted slogans

Source: PLAN.md §13 Fase 1, line 1188; PLAN.md §8.3, line 665

- Given a draft whose title has a loaded word and "!!" and whose summary has a slogan in capitals, and a neutral draft
- When the admin editor is read
- Then the first lists the word, the exclamation and the shouting as findings and the second lists none
- And the findings are advice: the flagged draft still publishes

### AC-CLAIM-01 Claiming resolution opens a round, schedules the survey and tells followers

Source: PLAN.md §5.7, line 296; docs/architecture.md Resolution Claims, Survey and Right of Reply (Claim rounds)

- Given a published issue followed by its reporter
- When an admin marks it "Diklaim selesai" on `/kelola/isu/<code>`
- Then an open `resolution_claims` row names the admin, and a `survey-send` job is due 28 days later
- And the public claim section shows the open round
- And the follower receives one email naming the issue

### AC-CLAIM-02 One immutable rating per account per round, with Turnstile

Source: PLAN.md §5.7, lines 290-291 and 296; docs/architecture.md Resolution Claims, Survey and Right of Reply (`/isu/:code/nilai`)

- Given a published issue without a round, then with an open round, then confirmed
- When people rate through the rating contract
- Then no round answers 409, no session 401, a failed Turnstile 403 and a score of 0 answers 400
- And a citizen's first rating answers 201 and a second answers 409 `already_rated` with the first score kept
- And a reporter's rating is marked as a reporter's
- And after the admin confirms, a new rating answers 409 `closed`

### AC-CLAIM-03 Reporters and other citizens are shown apart, young accounts are excluded, small groups are hidden

Source: PLAN.md §5.7, lines 292-294 and 296

- Given an open round rated by nine reporters, ten other accounts at least 7 days old and three younger accounts
- When the claim section is read, and again after a tenth reporter rates
- Then "warga lain" counts the ten (two per score) and excludes the three, which the admin review counts as excluded
- And the reporters' group counts only reporters: below ten it shows no distribution, at ten it shows their own scores
- And no mean is published

### AC-CLAIM-04 Twenty ratings per address prefix per round, and anomaly flags for admins

Source: PLAN.md §5.7, lines 293 and 296

- Given twenty new accounts that rated a round from one address prefix
- When a twenty-first rates from it
- Then the contract answers 429 `prefix_cap`
- And the admin review flags both the prefix share and the young accounts
- But a round rated by ten old accounts from ten prefixes raises no flag

### AC-SURVEY-01 The survey reaches only reporters email can reach, with a signed link, and waits while it is off

Source: PLAN.md §5.7, line 296; PLAN.md §13 Fase 2, line 1205; docs/architecture.md Resolution Claims, Survey and Right of Reply (Survey)

- Given a round with one reporter with a proven email and one WhatsApp-only reporter (number proven, email not)
- When `survey-send` runs while surveys are off, and again when they are on
- Then the first run queues no mail, records no invitation and re-queues the job for the next 07:00 WIB
- And the second records and sends exactly one invitation, to the reachable reporter, emails a `/isu/<code>/survei?t=` link that opens the survey and is valid until 30 days after sending, and audits `claim.survey_send`

### AC-SURVEY-02 One "belum beres" reopens the issue at once

Source: PLAN.md §5.7, line 296; PLAN.md §5.1, lines 165-167

- Given an invited reporter of a round with two reporters
- When that reporter answers "belum beres" through the emailed link
- Then the issue is "Dibuka kembali" and the round closes as `reopened` on the `survey` basis
- And the other reporter, a follower, is emailed, and the answer is audited as `claim.survey_answer`

### AC-SURVEY-03 "Sudah beres" from every invited reporter confirms the issue

Source: PLAN.md §5.7, lines 295-296

- Given a round with two invited reporters
- When the first answers "sudah beres" and then the second
- Then nothing moves after the first answer
- And after the second the issue is "Selesai terkonfirmasi" and the round closes as `confirmed` on the `survey` basis

### AC-SURVEY-04 Only invited reporters of the current round can answer

Source: docs/architecture.md Resolution Claims, Survey and Right of Reply (`/isu/:code/survei?t=`)

- Given an invited reporter's link
- When someone answers without a link or session, a signed-in person who was not invited answers, the reporter sends an unknown answer, and the reporter uses the link after the issue was reopened and claimed again
- Then the answers are 401, 403 `not_invited`, 400 and 409 `closed`

### AC-SURVEY-05 An admin can confirm a round

Source: PLAN.md §5.7, lines 295-296

- Given an open round
- When an admin confirms the issue on `/kelola/isu/<code>`
- Then the round closes as `confirmed` on the `admin` basis with the admin as closer

### AC-REPLY-01 An agency's reply waits for an admin, with a receipt

Source: PLAN.md §5.5, line 280; PLAN.md §13 Fase 2, line 1207; docs/architecture.md Resolution Claims, Survey and Right of Reply (Right of reply)

- Given a published issue
- When an officer signed in with a proven email sends a reply with Turnstile through the reply contract
- Then it answers 201 and the reply is pending in the admin queue with the agency, role and the sender's email
- And `reply.submit` is audited and the sender receives one receipt email

### AC-REPLY-02 Reply refusals and the per-campus quota

Source: PLAN.md §5.5, line 280; docs/architecture.md Resolution Claims, Survey and Right of Reply (`/isu/:code/hak-jawab`)

- Given the reply contract
- When it is sent without a session, from an account whose email is unproven, with a failing Turnstile, with empty or invalid fields and a `javascript:` link, for an unknown issue, and a sixth time in 24 hours
- Then the answers are 401, 403 `email_unverified`, 403 `captcha_failed`, 400 naming `agency`, `sender_role`, `body` and `source_url`, 404 and 429 `quota_exceeded`
- But the same officer still has five replies on another campus

### AC-REPLY-03 Accepting a reply records it as the agency's response

Source: PLAN.md §5.5, line 280; docs/architecture.md Resolution Claims, Survey and Right of Reply (Right of reply)

- Given a pending reply without a source link
- When an admin accepts it
- Then the issue's government axis is "Ditanggapi" and its JSON lists the response with the issue page's `#tanggapan` URL as source
- And the issue's follower and the sender each receive one email, and `reply.accept` is audited

### AC-REPLY-04 A reply waits while the state forbids it and can be rejected with a reason

Source: PLAN.md §5.5, line 280; docs/architecture.md Resolution Claims, Survey and Right of Reply (Right of reply)

- Given a pending reply on an issue "Dalam penanganan"
- When an admin accepts it, then rejects it as `sender_unconfirmed`
- Then the accept answers `not_allowed` and the reply stays pending
- And the rejection stores the reason, emails the sender and audits `reply.reject`

### AC-MAIL-01 The daily notification ceiling defers mail to the next morning

Source: PLAN.md §12, line 1141; docs/architecture.md Email (Quota reservation)

- Given 199 notification emails sent today and 5 that failed
- When a receipt and then a review email are due
- Then the receipt is sent, since failed sends do not count
- And the review email is not sent, its notification stays pending and its job waits for 07:00 WIB the next day

### AC-MAIL-02 Mail never goes to unproven, reserved or departed recipients

Source: docs/architecture.md Email (Who is skipped); PLAN.md §5.10, line 382

- Given reporters with an unproven email, a reserved `.test` address, and one whose campus membership was removed
- When their receipts are due
- Then nothing is sent and each notification is skipped as `unverified`, `undeliverable` and `closed`

### AC-MAIL-03 One overdue-referral digest per admin per day, at 07:00 WIB

Source: PLAN.md §13 Fase 2, line 1206; docs/architecture.md Deadline Reminders

- Given two admins and a published issue whose referral passed its deadline without a response
- When the deadline job runs at 07:30 WIB, runs again, and runs the next day at 05:00 WIB
- Then each admin's address receives exactly one digest that names the issue and links to `/kelola/isu?perlu=lewat-tenggat`
- And the rerun queues nothing
- And the early run's digests wait for 07:00 WIB

### AC-MAIL-04 Amazon SES sends signed UTF-8 mail, defers throttling and fails rejections

Source: PLAN.md §13 Fase 2, line 1209; docs/architecture.md Email (SES)

- Given `EMAIL_PROVIDER=ses` with region and keys
- When three receipts are sent while SES accepts, throttles with `Retry-After: 120`, and rejects the message
- Then the first request is SigV4-signed JSON with UTF-8 content and the notification is sent
- And the throttled job is re-queued about 120 s later with the notification pending
- And the rejected notification fails as `http_400`

### AC-TEAM-01 Admin invitations last 7 days and belong to the invited address

Source: PLAN.md §5.2, lines 182 and 210; PLAN.md §6, line 447; PLAN.md §7, line 560

- Given an admin with a fresh TOTP session
- When the admin invites a colleague's email, another account opens and tries to accept the invitation, and the invited person signs in and accepts it
- Then an invitation expiring in 7 days is mailed with its `/undangan/<id>` link
- And the other account sees a `private, no-store` page without the invited address and is not made a member
- And the invited person becomes an admin, is sent to TOTP enrolment, and gets 403 on `/kelola` until enrolled

### AC-TEAM-02 Removing an admin takes effect at once, and no admin removes themself

Source: PLAN.md §5.2, line 182

- Given two TOTP-verified admins
- When one removes the other without and with the confirmation box, then tries to remove themself
- Then the unconfirmed removal changes nothing, the confirmed one ends the colleague's `/kelola` access at once
- And the self-removal is refused and the admin stays

### AC-TEAM-03 Pausing intake from the settings stops new reports

Source: PLAN.md §5.10, line 384; PLAN.md §13 Fase 1, line 1192

- Given an admin on `/kelola/pengaturan`
- When intake is paused with a status page URL, a report is sent, intake is reopened and the report is sent again
- Then the site banner says "Pelaporan sedang dihentikan sementara." and the report layout data carries the pause and the status link
- And the first submit answers 503 and the second 201

### AC-TEAM-04 Logos are raster only and themes cannot inject markup

Source: PLAN.md §5.11, line 425; docs/nfr-audit.md V1.3.4; docs/nfr-audit.md V1.3.5

- Given the settings page
- When an admin uploads an SVG logo, a colour value carrying a script, and a PNG logo
- Then the SVG and the colour are refused, the stored theme is unchanged and the home page (200) does not contain the script
- And an allowed colour is saved and served in the page's theme CSS
- And the PNG is served from `/logo/<hash>.webp` as WebP with a `sandbox` CSP

### AC-TEAM-05 A superadmin adds a campus with its first admin invitation

Source: PLAN.md §6, line 455; PLAN.md §5.2, line 184

- Given a TOTP-verified superadmin
- When a campus is added from `/admin`, and the same slug is added again
- Then the campus gets the host `<slug>.<apex>` and its first admin receives an invitation link on that host
- And the second attempt is refused as taken

### AC-OPS-01 Public photos are re-encoded copies without metadata, made only after approval and publication

Source: PLAN.md §5.2, lines 189-192; PLAN.md §5.10, line 385; PLAN.md §10.5 (Unggahan), lines 860-862; PLAN.md §11 item 5, lines 1112-1114

- Given a reporter's JPEG with camera and author EXIF
- When `worker-media` scans it, an admin approves it without redaction, its issue is published and `evidence-publish` runs
- Then the issue JSON links a public WebP served with `nosniff` and a `sandbox` CSP
- And the WebP has no EXIF and none of the original metadata text
- But the original still needs an admin session

### AC-OPS-02 A takedown deletes public files and purges the whole campus host

Source: PLAN.md §5.10, line 379; PLAN.md §10.6, line 894

- Given a published issue with a public photo
- When an admin removes the issue and the `takedown` job runs
- Then the public file answers 404, the CDN purge is called for the campus host, and the takedown is marked done

### AC-OPS-03 Retention: rejected files after 90 days, IPs and rating address hashes after 30 days, missing uploads marked

Source: PLAN.md §11 item 3, lines 1097 and 1101; PLAN.md §10.5, line 870; PLAN.md §5.7, line 296; PLAN.md §7, line 548

- Given a report rejected 91 days ago with its file, a session with an IP from 31 days ago, three ratings from one prefix 31 days ago, and a file never sent 25 hours after its report
- When `maintenance-daily` runs
- Then the rejected report's file and evidence row are gone, the session has no IP, the ratings have no address hash while the round keeps its top prefix count of three
- And the unsent file is marked missing

### AC-OPS-04 Request logs hold paths without queries and no client address

Source: PLAN.md §10.5 (Log), line 879; PLAN.md §10.5 (Data minimum), lines 868-871

- Given a search request and a refused `/kelola` request from a client address
- When the web process logs them
- Then the request lines carry `/isu` and `/kelola` with their statuses, and no line holds the search words or the client address

### AC-OPS-05 Errors reach GlitchTip without personal data

Source: PLAN.md §13 Fase 2, line 1212; PLAN.md §10.3, line 814

- Given a worker booted with `ERROR_REPORTING=true`, a GlitchTip DSN and the `email-send` queue
- When the receipt mail of a report submitted over HTTP fails at the email provider with an error quoting an email, a phone number and an IP address
- Then GlitchTip receives one envelope naming the queue, without the email, the number or the address

### AC-OPS-06 A redacted photo is published with its boxes burned in

Source: PLAN.md §5.2, lines 189-192; PLAN.md §5.10, line 385

- Given a reporter's photo, scanned clean
- When an admin saves a black box over its left half, its issue is published and `evidence-publish` runs
- Then the public WebP is black inside the box (every channel below 32) and keeps the photo's colour outside it
- But the original the admin downloads is byte for byte the uploaded file

### AC-OPS-07 A photo marked "Jangan terbitkan" never becomes public

Source: PLAN.md §5.2, line 191; PLAN.md §5.10, line 385

- Given a reporter's photo, scanned clean
- When an admin decides it must not be published and its issue is published
- Then no public file is written and the issue JSON lists no media for it

### AC-DATA-01 Dashboard numbers come from the 15-minute snapshot

Source: PLAN.md §5.8, lines 309-314; PLAN.md §5.11, line 420; PLAN.md §10.6, line 897

- Given a campus with five verified reports in one published issue, one rejected and one waiting report
- When the dashboard job runs
- Then the API reports 7 received, 5 verified, 1 in the queue, 1 published issue holding 5 reports, with a fresh `computedAt`, and `/data` shows that `computedAt` as its "Terakhir diperbarui" time in WIB
- And a new report changes the numbers only after the next run

### AC-DATA-02 The national view lists every campus and hides counts from one to four

Source: PLAN.md §5.11, line 421; PLAN.md §6, line 435; PLAN.md §13 Fase 1, line 1190

- Given a campus with seven reports and a campus with two
- When the national view is refreshed and the apex home is read
- Then both campuses are listed
- And the first campus's count equals its stored reports, not counting forwarded copies, while the second's is hidden

### AC-DATA-03 The dashboard's agency response numbers follow the published definitions

Source: PLAN.md §5.8, lines 309-314; PLAN.md §13 Fase 1, line 1189

- Given six referred issues answered after 2, 4, 6, 8, 10 and 20 days, two referred 30 days ago and still unanswered past their deadline, and one referred 3 days ago, the unanswered three to one agency
- When the dashboard job runs and `/data` is read
- Then the response rate shows N = 14 days, a denominator of 8 issues due and a numerator of 5 answered within 14 days
- And the first-response median is 7 days and the P90 15 days, from 6 answers (at least 5 are needed)
- And the agency with unanswered issues is listed with 2 overdue of 3 referred, alphabetically and never ranked, and the other agency is counted as clear

### AC-DATA-04 The `/data` map has a report layer with small counts hidden and an exact tuntutan layer

Source: PLAN.md §5.9, lines 344-346

- Given one published issue holding 3 verified reports in one province
- When the dashboard job runs and `/data?lapisan=laporan` is read
- Then that province's count and the map total are hidden
- And after an issue with 7 verified reports in a second province and another run, the first province stays hidden, the second shows 7 and the map total shows 10
- And `/data?lapisan=tuntutan` counts regional tuntutan per province exactly and live: 0 before a regional tuntutan is published and 1 right after, with no refresh

### AC-HOME-01 The campus home picks its tuntutan and issues by the published rules

Source: PLAN.md §6, line 434; PLAN.md §6.1, lines 474-475; docs/architecture.md Starting Values (Home tuntutan); docs/architecture.md §13 Tuntutan (Citizen ranking)

- Given four published tuntutan and eleven counted accounts whose lists give them 35, 24, 24 and 0 Borda points, the two at 24 from six and from five rankers
- And a new account's list that would put the last one first
- And seven published issues and a newer unpublished one
- When the campus home's data is read
- Then "Paling Penting Menurut Warga" lists the first three in that order, by points then rankers, and never the one only the new account chose
- And "Terbaru" lists the three newest tuntutan, newest first
- And "Isu Terbaru" lists the six newest published issues, newest first, without the unpublished one

### AC-AUTH-01 Daftar stores the 18+ declaration and sets a host-only session cookie

Source: PLAN.md §7, lines 560 and 562; PLAN.md §10.5, line 851

The in-process app runs with the development cookie name `sb.session_token` and without `Secure`, like every non-production process. The production name `__Host-sb.session_token` and `Secure` are proven by the production-mode round trip in `server/auth.test.ts` ("production cookies carry the __Host- prefix") and on a released host by `infra/smoke.ts`, which sends that cookie.

- Given a new person on a campus host
- When they sign up through `/api/auth/account/send-code` with name, email and a WhatsApp number typed as `0812-...`, then send the emailed code with the 18+ box
- Then the account stores the number as `+62...`, a verified email, the declaration time and its text version
- And the session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/` and has no `Domain`
- And no response body carries the session token

### AC-AUTH-02 Accounts need the 18+ box and a mobile WhatsApp number

Source: PLAN.md §7, lines 560 and 562; PLAN.md §11 item 3, line 1084

- Given a sign-up whose code is entered without the 18+ box, and sign-ups with no number, an 0800-0809 number or a landline
- When they are sent
- Then the first answers 400 `AGE_DECLARATION_REQUIRED` and creates no account
- And the others answer 400 `INVALID_PHONE`

### AC-AUTH-03 A code allows three attempts and expires

Source: PLAN.md §10.5, line 852; PLAN.md §10.3, line 806

- Given a sign-in code sent to an account
- When three wrong codes are entered, or the code has passed its expiry
- Then the right code answers 400 and no session cookie is set

### AC-AUTH-04 Codes need Turnstile and stay bound to their destination

Source: PLAN.md §10.5, line 865; PLAN.md §13 Fase 1, line 1182

- Given an account
- When a code is requested with a failing Turnstile token
- Then the server answers 403 `CAPTCHA_FAILED`
- And a code sent before the account's email changed answers 400 and sets no cookie

### AC-AUTH-05 Signing out deletes the session

Source: docs/nfr-audit.md V7.4.1; PLAN.md §10.5, line 851

- Given a signed-in person
- When they post to `/keluar`
- Then the server redirects with 303 and no session row of the account remains
- And the old cookie, which showed the account's email on `/lacak` before, reads as no session and `/lacak` (200) no longer shows it

### AC-AUTH-06 `/kelola` needs an admin membership on this host and a TOTP-verified session under 12 hours

Source: PLAN.md §10.5, line 853; PLAN.md §6, line 454

- Given an admin without TOTP, a reporter, a visitor and a TOTP-verified admin
- When each opens `/kelola`
- Then only the verified admin gets 200 `private, no-store`, the others get 403
- And a staff session created more than 12 hours ago gets 403

### AC-AUTH-07 Member and settings pages ask for the authenticator again after 300 seconds

Source: PLAN.md §10.5, line 853; PLAN.md §13 Fase 1, line 1182

- Given a staff session whose sign-in and last step-up are older than 300 seconds
- When the admin opens `/kelola/anggota` or `/kelola/pengaturan`
- Then the server redirects to `/masuk/konfirmasi?ke=<page>`
- But a fresh staff session opens `/kelola/anggota`

### AC-AUTH-08 Cross-site form posts are refused

Source: PLAN.md §10.5, line 851; docs/nfr-audit.md V3.5.1

- Given a signed-in admin and a report waiting for review
- When the review form arrives with another site's `Origin`, and with no `Origin` or `Sec-Fetch-Site`
- Then both are refused (400 from the router's origin check, 403 from the CSRF middleware) and the report is unchanged
- And the same form with `Sec-Fetch-Site: same-origin` is served

### AC-AUTH-09 Sessions and data stay on their campus host

Source: PLAN.md §5.11, line 424; PLAN.md §10.5, line 854

- Given an admin of campus A, and an admin of both campuses
- When the first uses the session on host B, and the second asks host B for campus A's report, issue, original file and complaint
- Then `/kelola` on host B answers 403 for the first
- And every campus A record answers 404 on host B while the same report opens on host A

### AC-AUTH-10 `/admin` needs the superadmin flag and TOTP

Source: PLAN.md §6, line 455; PLAN.md §5.2, line 184; docs/nfr-audit.md V8.2.1

- Given a campus admin, a superadmin without TOTP and a TOTP-verified superadmin
- When each opens `/admin`
- Then only the last gets 200 `private, no-store`, the others get 403

### AC-AUTH-11 Email stays available when WhatsApp sending is not

Source: PLAN.md §7 step 7, line 545; PLAN.md §13 Fase 1, line 1183

- Given a campus without a working WhatsApp sender
- When an account holder looks up the account, asks for a code by WhatsApp, then by email
- Then the lookup reports WhatsApp as not ready and the WhatsApp request answers 503 `WHATSAPP_UNAVAILABLE`
- And the emailed code signs the person in

### AC-AUTH-12 A person sees only their own sessions and can end the others after signing in recently

Source: docs/architecture.md Multi-Host Auth (Session list, frontend contract); docs/nfr-audit.md V7.4.3, V7.5.2

- Given a person signed in on two devices, one session holding an IP address, and someone else signed in
- When the person lists their sessions, tries to end the others from a session signed in 10 minutes ago, then from a fresh session
- Then the list holds only their two sessions, marks the current one and never shows the address
- And the stale attempt answers `stale` and ends nothing
- And the fresh attempt ends both older sessions of that person only and audits `session.revoke`

### AC-AUTH-13 A superadmin asks to link the WhatsApp sender by pairing code

Source: PLAN.md §13 Fase 1, line 1183

- Given a TOTP-verified superadmin and a campus admin
- When each asks on `/admin/whatsapp` to link a number by pairing code
- Then the campus admin gets 403
- And the superadmin's malformed number is refused (`phone`) with nothing stored, while a valid one is stored as a `link_code` request with the number in E.164 for the WhatsApp worker, and the page shows the request as pending

### AC-AUTH-14 A sign-in code by WhatsApp travels sealed through the queue and proves the number

Source: PLAN.md §13 Fase 1, lines 1182-1183

- Given a connected sender and an account whose number is not yet proven
- When the person asks a sign-in code by WhatsApp, the worker's `whatsapp-send` handler hands it to the sender, and the person enters it
- Then the job holds the number and code only sealed, the sender gets the account's number and a 6-digit code, the status reads `sent`, the code signs in and the number is now proven
- And when the sender fails, the job is retried and ends in `whatsapp-send-dlq`, the log row is `failed` with `provider`, and the status reads `failed` so the page can offer email

### AC-AUTH-15 An account without a number adds one on `/masuk`

Source: PLAN.md §13 Fase 1, line 1182; docs/architecture.md Multi-Host Auth (Sessions and re-authentication)

- Given an account whose number was released, another account's proven number, a third account's unproven number, and a session signed in 10 minutes ago
- When the account adds a malformed number, each taken number, a free one, and then another
- Then they are refused as `format`, `taken` and `pending`, the free one is stored unproven, the next is refused as `exists`, and the page stops asking for a number
- And the 10-minute-old session is ended and sent to `/masuk` with 303 instead, and its account keeps no number

### AC-AUTH-16 One code per address or number per 60 seconds and 8 per 24 hours

Source: PLAN.md §13 Fase 1, line 1182; docs/architecture.md Multi-Host Auth (Rate limiter)

- Given the production auth configuration (`dev: false`) and an account with a proven email and number
- When codes are asked by email and by WhatsApp twice in a row, again after 61 seconds, again with 8 sent in the last 24 hours, and again after one of them is older than 24 hours
- Then the second in a row and the ninth in 24 hours get 429 `OTP_LIMIT`, and the others are sent

### AC-AUTH-17 A TOTP code and a backup code each work once

Source: docs/architecture.md Multi-Host Auth (Backup codes; TOTP replay and lifetime); docs/nfr-audit.md V6.5.2

- Given an admin with TOTP and backup codes
- When they pass the sign-in challenge with a TOTP code, then with the same code again, then with a backup code, then with the same backup code again
- Then the first use of each code gets a session that opens `/kelola`
- And each reuse gets 401 and no session

### AC-AUTH-18 Sessions end 30 days after sign-in, and staff sessions after 30 idle minutes

Source: docs/architecture.md Multi-Host Auth (Sessions and re-authentication); docs/nfr-audit.md V7.3.1; docs/nfr-audit.md V7.3.2

- Given a citizen's session and an admin's session
- When the citizen's sign-in is 29 days old and idle for 6 days, then 30 days and 1 minute old, and the admin is idle for 29 minutes, then 31
- Then the citizen stays signed in at 29 days and the admin at 29 minutes
- And past 30 days or 30 idle minutes the request reads as signed out and that session row is deleted

### AC-STACK-01 The production stack caps request bodies at Caddy

Source: PLAN.md §10.5 (Unggahan), lines 860-862; PLAN.md §10.9, line 973

- Given the production compose stack started from the CI images
- When `infra/stack-test.sh` posts a 2 MB body through Caddy to a page and to the policy brief upload
- Then the page answers 413 from Caddy while the brief upload passes the cap to the app
- And public media serves a campus's WebP with a `sandbox` CSP and answers 404 for other file types and other hosts

### AC-STACK-02 Only Caddy's fixed address can set the client IP

Source: PLAN.md §10.10, line 1002; docs/nfr-audit.md V15.3.4

- Given the production stack, where `web` trusts `X-Client-IP` only from Caddy's fixed address
- When another container sends 125 API requests straight to `web`, each with a different `X-Client-IP`
- Then at least one answers 429, because all of them fall in one rate-limit bucket: the forged header is ignored

### AC-STACK-03 Containers run read-only, capped and without published ports

Source: PLAN.md §10.9, line 973; docs/nfr-audit.md V13.2.2

- Given the production stack
- When `infra/stack-test.sh` inspects the running containers and CI scans `infra/compose.yaml`
- Then `web` has a read-only root filesystem and runs as `bun`, `web`, `worker-media` and `postgres` cap processes and open files
- And no service publishes a port

### AC-DEPLOY-01 The deploy key runs only a deploy by digests or a rollback by SHA

Source: PLAN.md §10.10 (Deploy dan Rollback), line 1007

- Given the forced command `infra/deploy-gate.sh` of the deploy SSH key
- When it receives a deploy without both image digests, with a mutable tag or with extra words, or a rollback with more than a SHA
- Then each is refused with exit code 2 before git runs
- But a well-formed deploy or rollback goes on

### AC-DEPLOY-02 The release smoke test names every cache and CSP problem per campus host

Source: PLAN.md §10.10 (Deploy dan Rollback), line 1008

- Given a released campus host whose anonymous page never becomes a `HIT`, whose page has an inline script missing from the CSP and whose signed-in response is cached
- When the smoke test runs against it
- Then it exits 1 and names each of the three problems with the host

### AC-DEPLOY-03 A release that fails its checks rolls back to the previous SHA

Source: PLAN.md §10.10 (Deploy dan Rollback), line 1008

- Given a running release recorded in `infra/.deployed-history`
- When a new release's `/healthz` reports another SHA or its smoke test fails
- Then `infra/deploy.sh` installs the previous SHA again and records it

## Pre-Launch Checks

Backend criteria that wait for infrastructure that does not exist yet: the production origin server, the Cloudflare zone and the B2 account. By the user's decision of 22 October 2026 ([ADR-24](decisions.md#adr-24-coverage-and-acceptance-gates)) they leave the CI share and run once that infrastructure exists. They are written as scenarios and parsed by the gate; each needs a `Checked by:` line with the exact command and what it waits for. At most 3 may sit here, and a fourth fails the gate. The gate prints their number as `outside` and the share with them counted as open as `withOutside`.

### AC-LOAD-01 The origin holds the load test

Source: PLAN.md §13 Fase 1, line 1197

Checked by: `infra/load-test.js` with k6 against the origin through Cloudflare Access, from three machines with one third of the clients each, as in [docs/runbook.md](runbook.md#load-test) Load Test. Its thresholds fail on any SSR error and on a 503 without a positive `Retry-After` (check `503 has Retry-After`); `upload_busy` summed over the three summaries must be above 0, and `docker inspect -f '{{.RestartCount}}'` of `web` (runbook step 2) must be the same before and after. Waits for: the production origin server. Run on a local machine on 21 October 2026, before the 503, `upload_busy` and restart checks were added on 22 October 2026, never against the origin server.

```sh
docker run --rm --network host -v "$PWD/infra:/s:ro" -v "$PWD/load:/k:ro" \
  grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34 \
  run -e BASE=https://<access-hostname> -e HOST=itb.<domain> -e ORIGIN=https://itb.<domain> \
  -e UPLOADS=/k/uploads.json -e UPLOAD_FILE=/k/video.mp4 -e SOAK=1h /s/load-test.js
```

- Given the production origin
- When k6 runs uncached SSR with concurrent 50 MB uploads, then a one-hour soak
- Then SSR answers without errors, extra uploads get 503 with `Retry-After` and then finish, and `web` does not restart

### AC-EDGE-01 Cloudflare caches only anonymous pages, by the origin's headers, with HSTS at the edge

Source: PLAN.md §10.6, lines 886-891

Checked by: the zone's Cache Rules in `bypass_by_default` mode (spike P1), then `bun infra/smoke.ts itb.<domain>` (anonymous page a `HIT`, a session response never a `HIT` and `private, no-store`) and `bun infra/smoke.ts edge itb.<domain>` (TLS 1.2 and 1.3 only, HSTS) against the zone, then the TTL check of PLAN.md §10.6 line 888 below: after a `HIT`, `age` never passes 60 and `cf-cache-status` turns `EXPIRED` or `REVALIDATED` within the two minutes. Waits for: the Cloudflare zone. No zone exists yet.

```sh
for _ in $(seq 1 24); do
  curl -sI https://itb.<domain>/ | tr -d '\r' | grep -iE '^(cf-cache-status|age):' | paste -sd ' '
  sleep 5
done
```

- Given a campus zone with the Cache Rules and TTL mode of PLAN §10.6
- When anonymous and signed-in pages are requested through Cloudflare
- Then anonymous 200 pages are cached for 60 s from `Cloudflare-CDN-Cache-Control`, `private` and `no-store` answers never are, and the edge sends HSTS over TLS 1.2 and 1.3 only

### AC-RESTORE-01 Backups restore to a point in time, per tenant and from the off-site copy

Source: PLAN.md §10.5 (Backup), line 880; PLAN.md §13 Fase 1, line 1198

Checked by: `infra/restore-test.sh`, which CI's `image` job already runs (pgBackRest PITR to a target time, the one-tenant export and load with per-table checksums, and a restic round trip), so only the B2 copy step waits. Waits for: a B2 account. Once it exists and `.github/workflows/backup-copy.yml` has copied the pgBackRest repository (`BACKUP_COPY_ENABLED=true`), the quarterly restore drill on a scratch host ([docs/architecture.md](architecture.md) Restore drill) points the `PGBACKREST_REPO1_S3_*` values of `infra/.env.sops` at the B2 copy bucket and runs `sudo infra/restore-db.sh latest`. pgBackRest's settings for B2's S3 endpoint are **[unverified]** (P15).

- Given pgBackRest and restic backups of two campuses
- When the restore drill restores the cluster to a target time and one tenant from it
- Then the restored tenant's tables match their checksums at the target time, the other tenant and the shared tables are unchanged, and files restore from restic
- And the weekly B2 copy restores the same way

## Out of Scope

Frontend-only criteria, owned by the frontend teammate, and criteria PLAN records as not built or never run; none is counted. Each is a bullet with its source and the reason, without an ID.

- Report form steps 1-6 in the browser: one topic per step, error summary with focus and "Kesalahan: " title, the step list without `role="progressbar"`, native date input with "Hari ini" and "Kemarin": PLAN.md §7, lines 517-524. Client rendering only; the server checks the same rules again (AC-REPORT-03, AC-REPORT-04).
- Draft kept only in `sessionStorage`, never on the server, cleared on sign-out and after submit, conditional fields cleared: PLAN.md §7, lines 575-581. Browser storage.
- `/lapor` notice when JavaScript is off and the disabled submit button while sending: PLAN.md §7, line 513. Client behaviour.
- Pause notice inside each `/lapor` step: PLAN.md §5.10, line 384. Rendered by the step page in the browser; the server sends the pause flag and refuses submits (AC-TEAM-03, AC-REPORT-08).
- Success page "Simpan sebagai PDF", the panel without links and the emergency 112 banner: PLAN.md §7, lines 570-573. Page markup.
- Sign-in component masking of email and number before Turnstile, and the "Kirim lewat email" button after a failed WhatsApp send: PLAN.md §7 step 7, line 545. Page markup; the server side is AC-AUTH-11.
- Pages for the issue rating `/isu/:code/nilai`, the survey `/isu/:code/survei`, the right of reply `/isu/:code/hak-jawab`, the admin queue `/kelola/hak-jawab` and the claim section on `/isu/:code`: PLAN.md §5.5, line 280; PLAN.md §5.7, line 296; docs/architecture.md Resolution Claims, Survey and Right of Reply (Contract for the frontend). Routes not built; their contracts are AC-CLAIM, AC-SURVEY and AC-REPLY.
- "Unduh data yang ditampilkan" buttons on `/data` and the JSON link on `/isu/:code`: PLAN.md §5.8, line 331; PLAN.md §6.1, line 486. Links to the API of AC-API-01 and AC-API-07.
- Resumable upload client (tus-js-client settings, retry on 408): PLAN.md §7 step 5, line 540; docs/architecture.md Resumable Upload Contract (For the frontend). Browser code; the server side is AC-UPLOAD-06 and AC-UPLOAD-07.
- Umami script tag and its CSP note: PLAN.md §13 Fase 2, line 1212; docs/architecture.md Analytics Snippet (Frontend Contract). Page markup.
- Display of the tuntutan prefix anomaly flag on the admin tuntutan page: PLAN.md §5.7, line 305 ("tampilan penanda adalah tugas frontend", written for the rating and carried over to the ranking by [ADR-25](decisions.md#adr-25-citizen-ranking-safeguards)). Page markup; the server's flag (`prefixAnomaly`) is AC-DEMAND-10.
- Labels for the raw audit actions `claim.*`, `reply.*` and `referral.remind` in `/kelola/audit`: docs/architecture.md Deadline Reminders (Not built here); docs/architecture.md Resolution Claims, Survey and Right of Reply. UI label map.
- Chart and map presentation rules: titles that state the finding, direct labels, the data table under each chart, colour classes fixed per measure, "Tidak ada data" colour, footnotes and attribution, the map's SVG styling, legends and tables, and the province links: PLAN.md §5.8, lines 328-330 and 333 (display text); PLAN.md §5.9, lines 343, 347, 349 and 352. Rendering in the page components; the layer counts are AC-DATA-04, the data and CSV are AC-API-07 to AC-API-09, and region filtering is AC-FOLLOW-02.
- The per-capita map view and the regency map: PLAN.md §5.9, lines 348 and 350; PLAN.md §13 Fase 1, line 1189 ("peta per kapita dan peta kabupaten/kota belum"). Not built.
- Linking a real WhatsApp number with Baileys, the link and unlink buttons in a browser, and the Meta Cloud API adaptor against Meta: PLAN.md §13 Fase 1, line 1183 ("penautan nomor sungguhan, tombol tautkan dan lepas lewat browser, dan adaptor Meta terhadap Meta belum pernah dijalankan"). They need a real WhatsApp account and a Meta business account; the stored link request is AC-AUTH-13 and the code path with the fake sender is AC-AUTH-14.
- Home page section layout: card form, numbering 01 to 03, sub-tuntutan lines and the order of the sections: PLAN.md §6.1, lines 474-475. Page markup; which tuntutan and issues the sections hold is AC-HOME-01.
- Accessibility audit with axe and the performance budgets (size-limit, Lighthouse): PLAN.md §10.8, lines 950-964; PLAN.md §13 Fase 1, lines 1199-1200. Client bundle and markup.
- English version under `/en`: PLAN.md §13 Fase 2, line 1210. Frontend work.
- Evidence editor drawing redaction boxes: PLAN.md §5.10, line 385. Canvas UI; the server stores and applies the decision (AC-OPS-01, AC-OPS-06, AC-OPS-07).
- The "Sesi Aktif" page with its "Keluarkan sesi lain" button, and a visible sign-out on every signed-in page: docs/nfr-audit.md V7.4.3, V7.4.4, V7.5.2. Page markup; the session list and revoke contract is AC-AUTH-12, sign-out is AC-AUTH-05.
