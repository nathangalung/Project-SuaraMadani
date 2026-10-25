# Sadar Bersuara: Agent Rules

Multi-tenant civic reporting platform for student organisations. PLAN.md is the product source of truth, docs/architecture.md the technical one, docs/decisions.md the record of why.

## Ownership

- The backend is ours: server/, worker/, db/, shared/, infra/, .github/, e2e/, docs/, app/**/*.server.ts and the .ts resource routes under app/routes/.
- The frontend belongs to a teammate: app/**/*.tsx, app/components/, app/root.tsx, app/routes.ts, DESIGN.md, public/. Never change its UI or UX (layout, styles, copy, flows, components). The one exception is integration: replacing placeholder or dummy data, hardcoded mocks and stub handlers with real loaders, actions and server data, keeping the markup and behaviour the teammate built.
- The backend follows the frontend's features. When they disagree, change the backend to match what the UI does, built properly (RLS, audit, rate limits, tests first), never the UI to match the backend.
- messages/id.json: only `mail_` and `api_` keys.
- Git is read-only for agents. Never run git add, commit, push, stash or worktree. The user commits.
- Port 5173 is the user's dev server. Agents use 5198 and 5199 only and stop every server they start.
- Dev database `sadar_bersuara`: never mutate, dump or restore it. Live runs that write data use a fresh copy (`CREATE DATABASE <name> TEMPLATE sadar_bersuara OWNER sb_migrator`, grants, URLs overridden in the shell only) and drop it afterwards.

## Tooling

- Bun only: `bun`, `bunx --bun`, `bun info <pkg> time`. Never npm or Node, and never npx. Playwright and Lighthouse run on the Bun runtime.
- Name: Sadar Bersuara. Technical prefix `sb` (`sb_app`, `SB_*_PASSWORD`, `__Host-sb.session_token`).
- Newest stable versions, at least 14 days old (`bunfig.toml` `minimumReleaseAge`). No Redis or Valkey.
- Strict TypeScript, no `any`, prefer `type`. Biome clean.
- Code and comments in English. Comments at most 5 words, no emoji, no `===` or `---` separators, no semicolons in comments.
- UI text in Indonesian, formal "Anda", Title Case headings and table headers.
- No folder that holds a single item.

## Testing: At Least 99%

Every change keeps all three at or above 99%, measured by the gates, never estimated.

- **TDD.** Write the failing test first. `bun run coverage` must report backend lines and functions each at least 99%, every backend source file present in the report, and no file under the 90% floor.
- **BDD.** Every backend acceptance criterion is a Given / When / Then scenario in docs/acceptance.md, citing its PLAN, architecture or audit source line.
- **ATDD.** `bun run acceptance` must report at least 99% of the scenarios under Scenarios automated. A test counts when its title carries the scenario ID, for example `[AC-API-03]`, and it is not skipped, todo, fixme or conditional.
- **Pre-Launch Checks.** docs/acceptance.md lists at most 3 scenarios that wait for infrastructure (production origin, Cloudflare zone, B2 account): today AC-LOAD-01, AC-EDGE-01 and AC-RESTORE-01, each with a `Checked by:` command. They sit outside the 99% share, the gate prints them as `outside` and `withOutside`, and a fourth fails it. Never move a scenario there to pass the gate.
- **E2E.** `bun run e2e` runs Playwright on the Bun runtime against the production build on port 5198, with the browser projects and the `api` project. The `infra/stack-test.sh` production stack test (with `STACK_LIGHTHOUSE=1`), the `infra/deploy-test.sh` rollback drill (the real deploy-gate.sh and deploy.sh, AC-DEPLOY-03) and the `infra/restore-test.sh` restore drill run before a change is called done, as in the CI `image` job.
- **Edge cases.** Each new behaviour is tested at its boundaries: empty, one, maximum and maximum plus one; invalid and hostile input; Unicode; another tenant's data; signed out, wrong role and expired session; repeated and concurrent requests (idempotency, races); timeouts and a dependency that is down.
- **Bug fixes.** Reproduce first, write a failing regression test, fix at the root cause, keep the test.
- **Test quality.** Assert what a caller can observe. No test that only executes lines, mocks the module under test or depends on timing. Prefer deleting dead code over testing it.

## pstack

pstack (Lauren Tan) is installed for this user. Read `~/.claude/plugins/cache/cursor-plugins/pstack/<version>/docs/harness/claude-code.md` once per session, then read and follow the SKILL.md that fits. Its git, PR and Cursor-only steps are skipped here (git is read-only for agents).

| Situation | Skill |
|---|---|
| Any nontrivial task | `poteto-mode`, `figure-it-out` for large work |
| Design across a function boundary | `architect`, `how` |
| Writing or keeping a test | `tdd`, `principle-test-behavior-not-implementation` |
| A defect | Bug fix playbook, `principle-fix-root-causes` |
| A repeated agent mistake | `correct` |
| Proving the work | `principle-prove-it-works`, `create-verification-skill` |
| Review before done | `interrogate`, `blast-radius` |
| A measured number | `benchmark-checklist`, `principle-explain-the-number` |
| Long or unattended runs | `show-me-your-work` |

## Done Means

`bun run typecheck`, `bun run lint`, `bun run coverage`, `bun run acceptance`, `bun run build`, `bun run size`, `bun run knip`, `shellcheck infra/*.sh`, `bun run e2e`, `infra/stack-test.sh`, `infra/deploy-test.sh` and `infra/restore-test.sh` all pass, run in this session, with their output quoted. A step that could not run is reported as not run, with the reason.

## Rules and What Enforces Them

| Rule | Enforced by |
|---|---|
| Name is Sadar Bersuara | `tooling.test.ts` "backend says Sadar Bersuara only" |
| `sb` prefix, no `sm` | `tooling.test.ts` "backend abbreviation is sb" |
| Bun only (no npm, no npx) | `tooling.test.ts` "backend runs Bun, not npm" |
| No Node: `bunx --bun`, `bun --bun` | `tooling.test.ts` "--bun on every bunx" and "package scripts run bins on the Bun runtime", CI gates job "No Node" step |
| Comments at most 5 words | `tooling.test.ts` "comment rule" |
| Coverage at least 99% | `infra/coverage-gate.ts`, CI gates job |
| Acceptance at least 99% | `infra/acceptance-gate.ts`, CI gates job |
| Pre-Launch Checks at most 3 | `infra/acceptance-gate.ts`, CI gates job |
| Cited PLAN.md line is non-blank, in its section | `infra/acceptance-gate.ts` `planCiteProblems`, CI gates job |
| Release age 14 days | `bunfig.toml` `minimumReleaseAge`, Renovate |
| No published ports in production | CI "No published ports" step |
| `sql.raw` needs a reason | CI "No sql.raw outside migrations" step |
| `infra/*.sh` shellcheck clean | CI gates job "Shellcheck" step (0.11.0, sha256 pinned) |
| Frontend untouched, git read-only | Review only, nothing fails automatically |
