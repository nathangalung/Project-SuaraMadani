import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "../../../db/migrate.ts"
import { reports } from "../../../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { parseHashKey } from "../../../server/email-log.ts"
import type { PurgeClient } from "../../../server/purge.server.ts"
import { parseKeyring, signLink } from "../../../server/signed-link.ts"
import { CLAIM_RULES } from "../../../shared/claims.ts"
import type { IssueState } from "../../../shared/status.ts"
import { createMaintenanceHandler } from "../../../worker/maintenance.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { runMerge } from "../moderation/merge.server.ts"
import {
  type IssueActionInput,
  runIssueAction,
} from "../moderation/referrals.server.ts"
import { claimReview, claimSection } from "./claims.server.ts"
import { runPublish } from "./publish.server.ts"
import {
  ownClaimRating,
  type RateClaimDeps,
  rateClaim,
  rateClaimRequest,
} from "./ratings.server.ts"
import {
  answerSurvey,
  answerSurveyRequest,
  surveyTarget,
} from "./survey.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const NOW = new Date("2026-10-13T03:00:00Z")
const DAY = 86_400_000
const NO_PURGE: PurgeClient = {
  purgeUrls: async () => ({ skipped: true }),
  purgeHosts: async () => ({ skipped: true }),
}
const keyring = parseKeyring(`1:${Buffer.alloc(32, 7).toString("base64")}`)
const hashKey = parseHashKey(Buffer.alloc(32, 8).toString("base64"))

let orgA = ""
let orgB = ""
let admin = ""
let serial = 0

const tenantA: TenantContext = {
  id: "",
  slug: "itb",
  host: "itb.localhost",
  name: "KM ITB",
  campusCode: "ITB",
  campusName: "ITB",
  theme: {},
  settings: {},
}

function session(userId: string): SessionContext {
  const at = new Date()
  return {
    user: {
      id: userId,
      email: "warga@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: false,
      updatedAt: at,
    },
    session: { id: "s", createdAt: at, expiresAt: at },
  }
}

/** Account of a given age. */
async function citizen(days = 30): Promise<string> {
  serial += 1
  const id = await insertUser(su, `warga.klaim${serial}@contoh.id`)
  await su.query(
    "UPDATE users SET created_at = now() - $2::int * interval '1 day' WHERE id = $1",
    [id, days],
  )
  return id
}

type Issue = {
  id: string
  code: string
  state: IssueState & { version: number }
  reporters: string[]
}

async function refresh(issue: Issue): Promise<Issue> {
  const { rows } = await su.query<{
    advocacy_status: IssueState["advocacy"]
    gov_status: IssueState["government"]
    version: number
  }>("SELECT advocacy_status, gov_status, version FROM issues WHERE id = $1", [
    issue.id,
  ])
  const row = rows[0]
  if (!row) throw new Error("issue gone")
  return {
    ...issue,
    state: {
      advocacy: row.advocacy_status,
      government: row.gov_status,
      version: row.version,
    },
  }
}

async function act(
  issue: Issue,
  input: Partial<IssueActionInput> & Pick<IssueActionInput, "action">,
) {
  const current = await refresh(issue)
  const base = {
    issueId: issue.id,
    seen: current.state,
    actorId: admin,
    note: null,
  }
  return runIssueAction(
    { id: orgA, host: tenantA.host },
    { ...base, ...input } as IssueActionInput,
    { purge: NO_PURGE },
  )
}

/** Published, referred, two reporters. */
async function seedIssue(reporterCount = 2): Promise<Issue> {
  const reporters: string[] = []
  const reportIds: string[] = []
  for (let n = 0; n < reporterCount; n++) {
    const userId = await citizen(60)
    reporters.push(userId)
    const [report] = await suDb
      .insert(reports)
      .values(
        reportValues(orgA, userId, { status: "verified", verifiedAt: NOW }),
      )
      .returning({ id: reports.id })
    if (!report) throw new Error("no report")
    reportIds.push(report.id)
  }
  const merged = await runMerge(orgA, {
    reportIds,
    target: {
      kind: "new",
      title: "Jalan berlubang di Dago",
      summary: "Beberapa laporan menyebut jalan berlubang sejak Agustus.",
    },
    actorId: admin,
    now: NOW,
  })
  if (!merged.ok) throw new Error(merged.reason)
  await runPublish(
    { id: orgA, host: tenantA.host },
    { issueId: merged.issueId, actorId: admin, notify: false },
    { purge: NO_PURGE },
  )
  const issue = await refresh({
    id: merged.issueId,
    code: merged.code,
    state: {
      advocacy: "monitoring",
      government: "awaiting_response",
      version: 0,
    },
    reporters,
  })
  const referred = await act(issue, {
    action: "refer",
    referral: {
      agency: "Dinas Bina Marga Kota Bandung",
      channel: "agency_email",
      ticket: null,
      sentOn: "2026-10-01",
      deadlineOn: "2026-10-15",
    },
  })
  if (!referred.ok) throw new Error(referred.reason)
  return refresh(issue)
}

async function claimed(reporterCount = 2): Promise<Issue> {
  const issue = await seedIssue(reporterCount)
  const result = await act(issue, { action: "claim_resolved" })
  if (!result.ok) throw new Error(result.reason)
  return refresh(issue)
}

async function openClaim(issueId: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "SELECT id FROM resolution_claims WHERE issue_id = $1 AND closed_at IS NULL",
    [issueId],
  )
  const id = rows[0]?.id
  if (!id) throw new Error("no open claim")
  return id
}

/** What survey-send writes. */
async function invite(issue: Issue): Promise<string> {
  const claimId = await openClaim(issue.id)
  for (const userId of issue.reporters) {
    await su.query(
      "INSERT INTO fix_surveys (org_id, claim_id, user_id) VALUES ($1, $2, $3)",
      [orgA, claimId, userId],
    )
  }
  return claimId
}

function token(claimId: string, userId: string, orgId = orgA): string {
  return signLink(keyring, {
    purpose: "survei",
    orgId,
    subjectId: claimId,
    userId,
    expiresAt: new Date(Date.now() + DAY),
  })
}

function answerForm(answer: string, extra: Record<string, string> = {}) {
  const data = new FormData()
  data.set("answer", answer)
  for (const [key, value] of Object.entries(extra)) data.set(key, value)
  return data
}

const surveyDeps = { keyring: () => keyring, purge: NO_PURGE }

async function answer(
  issue: Issue,
  value: string,
  who: { token?: string; session?: SessionContext },
) {
  return answerSurvey({
    tenant: tenantA,
    code: issue.code,
    token: who.token ?? null,
    session: who.session ?? null,
    form: answerForm(value),
    deps: surveyDeps,
  })
}

const pass: RateClaimDeps = {
  verifyCaptcha: async () => ({ ok: true }),
  hashKey: () => hashKey,
}

function rateForm(score: string, extra: Record<string, string> = {}) {
  const data = new FormData()
  const values: Record<string, string> = {
    intent: "rate",
    submissionId: crypto.randomUUID(),
    score,
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    ...extra,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

let ipSerial = 0

/** Distinct address per rating. */
function nextIp(): string {
  ipSerial += 1
  return `10.1.${Math.floor(ipSerial / 250)}.${ipSerial % 250}`
}

function rate(
  issue: Issue,
  userId: string,
  score = "4",
  ip: string | null = null,
) {
  return rateClaim({
    tenant: tenantA,
    session: session(userId),
    code: issue.code,
    form: rateForm(score),
    remoteIp: ip ?? nextIp(),
    deps: pass,
  })
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  tenantA.id = orgA
  admin = await insertUser(su, "admin.klaim@contoh.id")
})

beforeEach(async () => {
  await su.query("DELETE FROM issue_reports")
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM org_counters")
  await su.query("DELETE FROM reports")
  await su.query(
    "DELETE FROM pgboss.job WHERE name IN ('issue-notify', 'survey-send')",
  )
})

afterAll(async () => {
  await resetData(su)
  await su.query(
    "DELETE FROM pgboss.job WHERE name IN ('issue-notify', 'survey-send')",
  )
  await su.end()
})

describe("claim lifecycle", () => {
  test("a claim opens a round and schedules the survey", async () => {
    const issue = await claimed()
    const { rows } = await su.query(
      "SELECT claimed_by, closed_at, outcome, basis FROM resolution_claims WHERE issue_id = $1",
      [issue.id],
    )
    expect(rows).toEqual([
      { claimed_by: admin, closed_at: null, outcome: null, basis: null },
    ])
    const claimId = await openClaim(issue.id)
    const { rows: events } = await su.query(
      "SELECT claim_id FROM issue_events WHERE issue_id = $1 AND action = 'claim_resolved'",
      [issue.id],
    )
    expect(events).toEqual([{ claim_id: claimId }])
    const { rows: jobs } = await su.query<{ start_after: Date; data: object }>(
      "SELECT start_after, data FROM pgboss.job WHERE name = 'survey-send'",
    )
    expect(jobs.map((job) => job.data)).toEqual([{ orgId: orgA, claimId }])
    const due = Date.now() + CLAIM_RULES.surveyDelayDays * DAY
    const at = jobs[0]?.start_after.getTime() ?? 0
    expect(Math.abs(at - due)).toBeLessThan(60_000)
  })

  test("the sample seed schedules no survey", async () => {
    const issue = await seedIssue()
    const result = await act(issue, {
      action: "claim_resolved",
      notify: false,
    })
    expect(result.ok).toBe(true)
    const { rows } = await su.query(
      "SELECT 1 FROM pgboss.job WHERE name = 'survey-send'",
    )
    expect(rows).toHaveLength(0)
  })

  test("an admin confirm stores its proof, a reopen starts over", async () => {
    const issue = await claimed()
    const first = await openClaim(issue.id)
    expect(
      (await act(issue, { action: "reopen", note: "Masih rusak." })).ok,
    ).toBe(true)
    expect((await act(issue, { action: "claim_resolved" })).ok).toBe(true)
    const second = await openClaim(issue.id)
    expect(second).not.toBe(first)
    const confirmed = await act(issue, {
      action: "confirm_resolved",
      note: "Jalan sudah diaspal ulang.",
      evidenceUrl: "https://bandung.go.id/berita/aspal",
    })
    expect(confirmed.ok).toBe(true)
    const { rows } = await su.query(
      "SELECT id, outcome, basis, closed_by, evidence_url FROM resolution_claims WHERE issue_id = $1 ORDER BY claimed_at",
      [issue.id],
    )
    expect(rows).toEqual([
      {
        id: first,
        outcome: "reopened",
        basis: "admin",
        closed_by: admin,
        evidence_url: null,
      },
      {
        id: second,
        outcome: "confirmed",
        basis: "admin",
        closed_by: admin,
        evidence_url: "https://bandung.go.id/berita/aspal",
      },
    ])
  })

  test("a claimed issue without an open claim rolls back", async () => {
    const issue = await claimed()
    await su.query("DELETE FROM resolution_claims WHERE issue_id = $1", [
      issue.id,
    ])
    const before = await refresh(issue)
    await expect(
      act(issue, { action: "confirm_resolved", note: "Sudah selesai." }),
    ).rejects.toThrow()
    expect((await refresh(issue)).state).toEqual(before.state)
  })
})

describe("Sudah beres? survey", () => {
  test("a broken keyring fails closed, logged as error", async () => {
    const issue = await claimed()
    const claimId = await invite(issue)
    const [one] = issue.reporters
    if (!one) throw new Error("reporters")
    const logged = spyOn(console, "error").mockImplementation(() => {})
    const target = await surveyTarget({
      tenant: tenantA,
      code: issue.code,
      token: token(claimId, one),
      session: null,
      keyring: () => {
        throw new Error("LACAK_LINK_KEYS is not set")
      },
    })
    const lines = logged.mock.calls.map((call) => JSON.parse(String(call[0])))
    logged.mockRestore()
    expect(target).toEqual({ status: "sign_in_required" })
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "error",
        msg: "signed link check failed",
        message: "LACAK_LINK_KEYS is not set",
      }),
    )
  })

  test("every reporter fixed confirms by survey", async () => {
    const issue = await claimed()
    const claimId = await invite(issue)
    const [one, two] = issue.reporters
    if (!one || !two) throw new Error("reporters")
    expect(
      await surveyTarget({
        tenant: tenantA,
        code: issue.code,
        token: token(claimId, one),
        session: null,
        keyring: () => keyring,
      }),
    ).toEqual({
      status: "open",
      code: issue.code,
      title: "Jalan berlubang di Dago",
      answer: null,
    })
    expect(
      await answer(issue, "fixed", { token: token(claimId, one) }),
    ).toEqual({ status: 200, body: { saved: "fixed", decided: null } })
    expect((await refresh(issue)).state.government).toBe("claimed_resolved")
    expect(await answer(issue, "fixed", { session: session(two) })).toEqual({
      status: 200,
      body: { saved: "fixed", decided: "confirm" },
    })
    expect((await refresh(issue)).state.government).toBe("confirmed_resolved")
    const { rows: claim } = await su.query(
      "SELECT outcome, basis, closed_by FROM resolution_claims WHERE id = $1",
      [claimId],
    )
    expect(claim).toEqual([
      { outcome: "confirmed", basis: "survey", closed_by: null },
    ])
    const { rows: audit } = await su.query(
      "SELECT actor_id, reason_code FROM audit_log WHERE entity_id = $1 AND action = 'issue.confirm_resolved'",
      [issue.id],
    )
    expect(audit).toEqual([{ actor_id: null, reason_code: "survey" }])
    const { rows: answers } = await su.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'claim.survey_answer'",
      [issue.id],
    )
    expect(answers).toEqual([{ n: 2 }])
    const { rows: jobs } = await su.query(
      "SELECT data->>'template' AS template FROM pgboss.job WHERE name = 'issue-notify' AND data->>'issueId' = $1 AND data->>'template' = 'issue_confirm_resolved'",
      [issue.id],
    )
    expect(jobs).toHaveLength(1)
  })

  test("one not fixed answer reopens", async () => {
    const issue = await claimed()
    const claimId = await invite(issue)
    const one = issue.reporters[0] ?? ""
    expect(
      await answer(issue, "not_fixed", { token: token(claimId, one) }),
    ).toEqual({ status: 200, body: { saved: "not_fixed", decided: "reopen" } })
    expect((await refresh(issue)).state.government).toBe("reopened")
    // Closed claim takes no answers
    expect(
      await answer(issue, "fixed", { token: token(claimId, one) }),
    ).toEqual({ status: 409, body: { error: "closed" } })
  })

  test("an answer can change while the claim is open", async () => {
    const issue = await claimed()
    const claimId = await invite(issue)
    const one = issue.reporters[0] ?? ""
    await answer(issue, "fixed", { token: token(claimId, one) })
    const { rows } = await su.query(
      "SELECT answer FROM fix_surveys WHERE claim_id = $1 AND user_id = $2",
      [claimId, one],
    )
    expect(rows).toEqual([{ answer: "fixed" }])
    expect(
      (await answer(issue, "not_fixed", { token: token(claimId, one) })).body,
    ).toEqual({ saved: "not_fixed", decided: "reopen" })
  })

  test("only invited reporters with a valid link answer", async () => {
    const issue = await claimed()
    const claimId = await invite(issue)
    const one = issue.reporters[0] ?? ""
    const outsider = await citizen()
    expect(
      await answer(issue, "fixed", { session: session(outsider) }),
    ).toEqual({ status: 403, body: { error: "not_invited" } })
    expect(await answer(issue, "fixed", {})).toEqual({
      status: 401,
      body: { error: "sign_in_required" },
    })
    expect(
      await answer(issue, "fixed", { token: token(claimId, one, orgB) }),
    ).toEqual({ status: 401, body: { error: "sign_in_required" } })
    expect(
      (await answer(issue, "maybe", { token: token(claimId, one) })).status,
    ).toBe(400)
    const other = await claimed()
    // A link for another issue
    expect(
      await answerSurvey({
        tenant: tenantA,
        code: other.code,
        token: token(claimId, one),
        session: null,
        form: answerForm("fixed"),
        deps: surveyDeps,
      }),
    ).toEqual({ status: 409, body: { error: "closed" } })
    expect((await refresh(issue)).state.government).toBe("claimed_resolved")
  })

  test("a round closed while the answer waited", async () => {
    const issue = await claimed()
    const claimId = await invite(issue)
    const one = issue.reporters[0] ?? ""
    // Admin confirm, same statement order
    const holder = await su.connect()
    await holder.query("BEGIN")
    await holder.query(
      "UPDATE issues SET gov_status = 'confirmed_resolved', version = version + 1 WHERE id = $1",
      [issue.id],
    )
    await holder.query(
      "UPDATE resolution_claims SET closed_at = now(), outcome = 'confirmed', basis = 'admin' WHERE id = $1",
      [claimId],
    )
    const pending = answer(issue, "not_fixed", { token: token(claimId, one) })
    for (let tries = 0; tries < 200; tries++) {
      const { rows } = await su.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
      )
      if ((rows[0]?.n ?? 0) > 0) break
      await Bun.sleep(10)
    }
    await holder.query("COMMIT")
    holder.release()
    expect(await pending).toEqual({ status: 409, body: { error: "closed" } })
    const { rows } = await su.query(
      "SELECT answer FROM fix_surveys WHERE claim_id = $1 AND user_id = $2",
      [claimId, one],
    )
    expect(rows).toEqual([{ answer: null }])
  })

  test("an old round's link cannot answer the new one", async () => {
    const issue = await claimed(1)
    const first = await invite(issue)
    const one = issue.reporters[0] ?? ""
    await act(issue, { action: "reopen", note: "Masih rusak." })
    await act(issue, { action: "claim_resolved" })
    await invite(issue)
    expect(await answer(issue, "fixed", { token: token(first, one) })).toEqual({
      status: 409,
      body: { error: "closed" },
    })
  })
  test("the route wiring refuses an oversized body before parsing", async () => {
    const request = new Request("http://itb.localhost/isu/x/survei", {
      method: "POST",
      headers: { "content-length": String(9 * 1024) },
      body: "x",
    })
    expect(
      await answerSurveyRequest({
        request,
        tenant: tenantA,
        session: null,
        code: "x",
      }),
    ).toEqual({ status: 413 })
  })
})

describe("citizen ratings", () => {
  test("rating opens at the claim and allows one per account", async () => {
    const issue = await seedIssue()
    const warga = await citizen()
    expect(await rate(issue, warga)).toEqual({
      status: 409,
      body: { error: "closed" },
    })
    await act(issue, { action: "claim_resolved" })
    expect(await rate(issue, warga)).toEqual({
      status: 201,
      body: { saved: "rated" },
    })
    expect(await rate(issue, warga, "1")).toEqual({
      status: 409,
      body: { error: "already_rated" },
    })
    expect(await ownClaimRating(orgA, issue.code, warga)).toBe(4)
    expect(await ownClaimRating(orgA, issue.code, admin)).toBeNull()
    const big = new Request("http://itb.localhost/isu/x/nilai", {
      method: "POST",
      headers: { "content-length": String(9 * 1024) },
      body: "x",
    })
    expect(
      await rateClaimRequest({
        request: big,
        tenant: tenantA,
        session: session(warga),
        code: issue.code,
      }),
    ).toEqual({ status: 413 })
    const { rows } = await su.query(
      "SELECT score, is_reporter, account_days, client_hash IS NOT NULL AS hashed FROM ratings WHERE user_id = $1",
      [warga],
    )
    expect(rows).toEqual([
      { score: 4, is_reporter: false, account_days: 30, hashed: true },
    ])
  })

  test("bad input, no session, failed captcha", async () => {
    const issue = await claimed()
    const warga = await citizen()
    expect((await rate(issue, warga, "6")).status).toBe(400)
    expect(
      await rateClaim({
        tenant: tenantA,
        session: null,
        code: issue.code,
        form: rateForm("4"),
        remoteIp: null,
        deps: pass,
      }),
    ).toEqual({ status: 401, body: { error: "sign_in_required" } })
    expect(
      await rateClaim({
        tenant: tenantA,
        session: session(warga),
        code: issue.code,
        form: rateForm("4"),
        remoteIp: null,
        deps: {
          ...pass,
          verifyCaptcha: async () => ({ ok: false, reason: "rejected" }),
        },
      }),
    ).toEqual({ status: 403, body: { error: "captcha_failed" } })
    expect(
      await rateClaim({
        tenant: { ...tenantA, id: orgB },
        session: session(warga),
        code: issue.code,
        form: rateForm("4"),
        remoteIp: null,
        deps: pass,
      }),
    ).toEqual({ status: 404, body: { error: "not_found" } })
  })

  test("a form without the rate intent or a UUID submission is a bare 400", async () => {
    const issue = await claimed()
    const warga = await citizen()
    const extras: Record<string, string>[] = [
      { intent: "delete" },
      { submissionId: "satu" },
    ]
    for (const extra of extras) {
      expect(
        await rateClaim({
          tenant: tenantA,
          session: session(warga),
          code: issue.code,
          form: rateForm("4", extra),
          remoteIp: null,
          deps: pass,
        }),
      ).toEqual({ status: 400, body: { errors: [] } })
    }
    expect(await ownClaimRating(orgA, issue.code, warga)).toBeNull()
  })

  test("Given a stored rating, when its retry carries a spent captcha token, then the same score answers saved, another is refused", async () => {
    const issue = await claimed()
    const warga = await citizen()
    expect((await rate(issue, warga, "3")).status).toBe(201)
    const retry = (score: string) =>
      rateClaim({
        tenant: tenantA,
        session: session(warga),
        code: issue.code,
        form: rateForm(score),
        remoteIp: null,
        deps: {
          ...pass,
          verifyCaptcha: async () => ({ ok: false, reason: "duplicate" }),
        },
      })
    expect(await retry("3")).toEqual({ status: 200, body: { saved: "rated" } })
    expect(await retry("5")).toEqual({
      status: 403,
      body: { error: "captcha_failed" },
    })
    expect(await ownClaimRating(orgA, issue.code, warga)).toBe(3)
  })

  test("Given the route form without a captcha token, when posted, then 403 captcha_failed and no rating", async () => {
    const issue = await claimed()
    const warga = await citizen()
    const request = new Request(
      `http://itb.localhost/isu/${issue.code}/nilai`,
      {
        method: "POST",
        body: rateForm("4", { turnstileToken: "" }),
      },
    )
    expect(
      await rateClaimRequest({
        request,
        tenant: tenantA,
        session: session(warga),
        code: issue.code,
      }),
    ).toEqual({ status: 403, body: { error: "captcha_failed" } })
    expect(await ownClaimRating(orgA, issue.code, warga)).toBeNull()
  })

  test("a reopen closes the round, a new claim opens another", async () => {
    const issue = await claimed()
    const warga = await citizen()
    expect((await rate(issue, warga)).status).toBe(201)
    await act(issue, { action: "reopen", note: "Masih rusak." })
    expect(await rate(issue, warga)).toEqual({
      status: 409,
      body: { error: "closed" },
    })
    await act(issue, { action: "claim_resolved" })
    expect((await rate(issue, warga, "2")).status).toBe(201)
    const { rows } = await su.query(
      "SELECT count(*)::int AS n FROM ratings WHERE user_id = $1",
      [warga],
    )
    expect(rows).toEqual([{ n: 2 }])
  })

  test("one prefix adds at most the cap", async () => {
    const issue = await claimed()
    for (let n = 0; n < CLAIM_RULES.prefixCap; n++) {
      const result = await rate(issue, await citizen(), "5", "2001:db8:1:1::7")
      expect(result.status).toBe(201)
    }
    expect(
      await rate(issue, await citizen(), "5", "2001:db8:1:1:ffff::1"),
    ).toEqual({ status: 429, body: { error: "prefix_cap" } })
    expect(
      (await rate(issue, await citizen(), "5", "2001:db8:1:2::1")).status,
    ).toBe(201)
  })

  test("reporters apart, young accounts left out, n below 10 hidden", async () => {
    const issue = await claimed(2)
    for (const reporter of issue.reporters) {
      expect((await rate(issue, reporter, "2")).status).toBe(201)
    }
    // Young account: stored, uncounted
    expect((await rate(issue, await citizen(3), "5")).status).toBe(201)
    for (let n = 0; n < CLAIM_RULES.minShown - 1; n++) {
      await rate(issue, await citizen(), "4")
    }
    let section = await claimSection(orgA, issue.code)
    expect(section?.current?.ratings).toEqual({
      reporters: { n: 2, counts: null },
      others: { n: CLAIM_RULES.minShown - 1, counts: null },
    })
    await rate(issue, await citizen(), "1")
    section = await claimSection(orgA, issue.code)
    expect(section?.current?.ratings.others).toEqual({
      n: CLAIM_RULES.minShown,
      counts: { 1: 1, 2: 0, 3: 0, 4: CLAIM_RULES.minShown - 1, 5: 0 },
    })
    expect(section?.claims).toHaveLength(1)
    const review = await claimReview(orgA, issue.id)
    expect(review?.excluded).toBe(1)
  })

  test("the admin sees the survey tally and anomaly flags", async () => {
    const issue = await claimed(2)
    const claimId = await invite(issue)
    await answer(issue, "fixed", {
      token: token(claimId, issue.reporters[0] ?? ""),
    })
    for (let n = 0; n < 10; n++) {
      const ip = n < 4 ? "192.0.2.10" : null
      await rate(issue, await citizen(n < 5 ? 10 : 90), "5", ip)
    }
    const review = await claimReview(orgA, issue.id)
    expect(review).toMatchObject({
      claimId,
      survey: { invited: 2, fixed: 1, notFixed: 0 },
      supportsConfirm: true,
      anomaly: { prefix: true, young: true },
    })
    expect(await claimReview(orgB, issue.id)).toBeNull()
  })

  // Last: clears every hash
  test("the prefix flag outlives the 30-day hash clear", async () => {
    const issue = await claimed(2)
    for (let n = 0; n < 10; n++) {
      const ip = n < 4 ? "192.0.2.10" : null
      expect((await rate(issue, await citizen(90), "5", ip)).status).toBe(201)
    }
    const before = await claimReview(orgA, issue.id)
    expect(before?.anomaly).toEqual({ prefix: true, young: false })
    const filesDir = await mkdtemp(join(tmpdir(), "sb-claims-"))
    try {
      const later = new Date(Date.now() + 31 * DAY)
      await createMaintenanceHandler({ filesDir, now: () => later })()
    } finally {
      await rm(filesDir, { recursive: true, force: true })
    }
    const { rows } = await su.query(
      `SELECT count(*)::int AS n FROM ratings r
       JOIN resolution_claims c ON c.id = r.claim_id
       WHERE c.issue_id = $1 AND r.client_hash IS NOT NULL`,
      [issue.id],
    )
    expect(rows).toEqual([{ n: 0 }])
    const after = await claimReview(orgA, issue.id)
    expect(after?.anomaly).toEqual({ prefix: true, young: false })
  })
})
