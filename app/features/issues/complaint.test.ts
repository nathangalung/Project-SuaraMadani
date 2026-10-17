import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
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
import type { PurgeClient } from "../../../server/purge.server.ts"
import type { TurnstileResult } from "../../../server/turnstile.server.ts"
import { DAILY_COMPLAINTS } from "../../../shared/complaints.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { runMerge } from "../moderation/merge.server.ts"
import {
  appealComplaint,
  type ComplaintDeps,
  getOwnComplaint,
  submitComplaint,
} from "./complaint.server.ts"
import { runPublish } from "./publish.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const NOW = new Date("2026-10-13T03:00:00Z")
const NO_PURGE: PurgeClient = {
  purgeUrls: async () => ({ skipped: true }),
  purgeHosts: async () => ({ skipped: true }),
}
const orgs = { a: "", b: "" }
let moderator = ""
let complainant = ""
let other = ""
let captcha: TurnstileResult = { ok: true }

function tenant(org: "a" | "b"): TenantContext {
  const code = org === "a" ? "CPA" : "CPB"
  return {
    id: orgs[org],
    slug: code.toLowerCase(),
    host: `${code.toLowerCase()}.localhost`,
    name: code,
    campusCode: code,
    campusName: code,
    theme: {},
    settings: {},
  }
}

function session(userId: string): SessionContext {
  const at = new Date()
  return {
    user: {
      id: userId,
      email: "pengadu@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: false,
      updatedAt: at,
    },
    session: { id: "s", createdAt: at, expiresAt: at },
  }
}

const deps: ComplaintDeps = {
  now: () => NOW,
  verifyCaptcha: async () => captcha,
}

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData()
  const values: Record<string, string> = {
    submissionId: crypto.randomUUID(),
    reason: "personal_data",
    part: "title_summary",
    explanation: "Ringkasan isu menyebut alamat rumah seorang warga.",
    goodFaith: "yes",
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    ...fields,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

async function seedIssue(org: "a" | "b", publish = true) {
  const reporter = await insertUser(su, `p${crypto.randomUUID()}@contoh.id`)
  const [report] = await suDb
    .insert(reports)
    .values(
      reportValues(orgs[org], reporter, {
        status: "verified",
        verifiedAt: NOW,
      }),
    )
    .returning({ id: reports.id })
  if (!report) throw new Error("no report")
  const merged = await runMerge(orgs[org], {
    reportIds: [report.id],
    target: {
      kind: "new",
      title: "Atap sekolah runtuh di Coblong",
      summary: "Beberapa laporan menyebut atap ruang kelas runtuh.",
    },
    actorId: moderator,
    campusCode: tenant(org).campusCode,
    now: NOW,
  })
  if (!merged.ok) throw new Error(merged.reason)
  if (publish) {
    await runPublish(
      { id: orgs[org], host: tenant(org).host },
      { issueId: merged.issueId, actorId: moderator, notify: false },
      { purge: NO_PURGE },
    )
  }
  return { id: merged.issueId, code: merged.code }
}

function submit(
  code: string,
  options: { org?: "a" | "b"; user?: string; fields?: FormData } = {},
) {
  return submitComplaint({
    tenant: tenant(options.org ?? "a"),
    session: session(options.user ?? complainant),
    subject: { kind: "issue", code },
    form: options.fields ?? form(),
    remoteIp: null,
    deps,
  })
}

async function decide(code: string) {
  await su.query(
    `UPDATE content_complaints SET status = 'decided', decision = 'keep',
       decision_reason = 'no_violation',
       decision_text = 'Isi isu tidak memuat data pribadi siapa pun.',
       decided_by = $2, decided_at = $3
     WHERE public_code = $1`,
    [code, moderator, NOW],
  )
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgs.a = await insertOrg(su, "cpa")
  orgs.b = await insertOrg(su, "cpb")
  moderator = await insertUser(su, "moderator.aduan@contoh.id")
  complainant = await insertUser(su, "pengadu@contoh.id")
  other = await insertUser(su, "lain@contoh.id")
})

beforeEach(async () => {
  captcha = { ok: true }
  await su.query("DELETE FROM content_complaints")
  await su.query("DELETE FROM issue_reports")
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM org_counters")
  await su.query("DELETE FROM reports")
  await su.query("DELETE FROM pgboss.job WHERE name = 'email-send'")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("submitComplaint", () => {
  test("records the complaint, audit, receipt and membership", async () => {
    const issue = await seedIssue("a")
    const result = await submit(issue.code)
    expect(result.status).toBe(201)
    if (!("code" in result.body)) throw new Error("no code")
    expect(result.body.code).toMatch(/^ADU-CPA-26-[0-9A-Z]{5}$/)
    const { rows } = await su.query(
      `SELECT c.status, c.reason, c.part, a.action, n.template
       FROM content_complaints c
       JOIN audit_log a ON a.entity_id = c.id
       JOIN notifications n ON n.complaint_id = c.id
       WHERE c.public_code = $1`,
      [result.body.code],
    )
    expect(rows).toEqual([
      {
        status: "open",
        reason: "personal_data",
        part: "title_summary",
        action: "complaint.submit",
        template: "complaint_received",
      },
    ])
    const member = await su.query(
      "SELECT role FROM members WHERE organization_id = $1 AND user_id = $2",
      [orgs.a, complainant],
    )
    expect(member.rows).toEqual([{ role: "reporter" }])
    const jobs = await su.query(
      `SELECT 1 FROM pgboss.job j JOIN notifications n
         ON n.id = (j.data->>'notificationId')::uuid
       WHERE j.name = 'email-send' AND n.complaint_id IS NOT NULL`,
    )
    expect(jobs.rowCount).toBe(1)
  })

  test("the same submission twice stores one row", async () => {
    const issue = await seedIssue("a")
    const fields = form()
    const first = await submit(issue.code, { fields })
    const again = await submit(issue.code, { fields })
    expect(first.status).toBe(201)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    // Losing double submit
    captcha = { ok: false, reason: "duplicate" }
    const third = await submit(issue.code, { fields })
    expect(third.status).toBe(200)
    const { rows } = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM content_complaints",
    )
    expect(rows[0]?.n).toBe(1)
  })

  test("concurrent submits of one key store one row", async () => {
    const issue = await seedIssue("a")
    const fields = form()
    const results = await Promise.all([
      submit(issue.code, { fields }),
      submit(issue.code, { fields }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 201])
    const { rows } = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM content_complaints",
    )
    expect(rows[0]?.n).toBe(1)
  })

  test("the daily quota stops the next complaint", async () => {
    const issue = await seedIssue("a")
    for (let i = 0; i < DAILY_COMPLAINTS; i++) {
      expect((await submit(issue.code)).status).toBe(201)
    }
    const over = await submit(issue.code)
    expect(over).toEqual({ status: 429, body: { error: "quota_exceeded" } })
  })

  test("unpublished and other campus issues are not found", async () => {
    const draft = await seedIssue("a", false)
    expect((await submit(draft.code)).status).toBe(404)
    const atB = await seedIssue("b")
    const crossed = await submit(atB.code, { org: "a" })
    expect(crossed).toEqual({ status: 404, body: { error: "not_found" } })
    const { rows } = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM content_complaints",
    )
    expect(rows[0]?.n).toBe(0)
  })

  test("field problems come back before the captcha", async () => {
    const issue = await seedIssue("a")
    captcha = { ok: false, reason: "rejected" }
    const result = await submit(issue.code, {
      fields: form({ reason: "", explanation: "pendek", goodFaith: "" }),
    })
    expect(result).toEqual({
      status: 400,
      body: { errors: ["reason", "explanation", "good_faith"] },
    })
  })

  test("a failed captcha stores nothing", async () => {
    const issue = await seedIssue("a")
    captcha = { ok: false, reason: "rejected" }
    const result = await submit(issue.code)
    expect(result).toEqual({ status: 403, body: { error: "captcha_failed" } })
  })
})

describe("own complaint and appeal", () => {
  async function submitted() {
    const issue = await seedIssue("a")
    const result = await submit(issue.code)
    if (!("code" in result.body)) throw new Error("no code")
    return result.body.code
  }

  test("only the complainant reads it, only on its campus", async () => {
    const code = await submitted()
    const own = await getOwnComplaint(orgs.a, code, complainant, NOW)
    expect(own?.status).toBe("open")
    expect(own?.canAppeal).toBe(false)
    expect(await getOwnComplaint(orgs.a, code, other, NOW)).toBeNull()
    expect(await getOwnComplaint(orgs.b, code, complainant, NOW)).toBeNull()
  })

  test("one appeal after the decision", async () => {
    const code = await submitted()
    const text = "Alamat itu masih terlihat di ringkasan isu sampai sekarang."
    const early = await appealComplaint(orgs.a, {
      code,
      userId: complainant,
      text,
      now: NOW,
    })
    expect(early).toEqual({ ok: false, reason: "closed" })
    await decide(code)
    expect(
      (await getOwnComplaint(orgs.a, code, complainant, NOW))?.canAppeal,
    ).toBe(true)
    const stranger = await appealComplaint(orgs.a, {
      code,
      userId: other,
      text,
      now: NOW,
    })
    expect(stranger).toEqual({ ok: false, reason: "not_found" })
    const first = await appealComplaint(orgs.a, {
      code,
      userId: complainant,
      text,
      now: NOW,
    })
    expect(first).toEqual({ ok: true })
    const second = await appealComplaint(orgs.a, {
      code,
      userId: complainant,
      text,
      now: NOW,
    })
    expect(second).toEqual({ ok: false, reason: "closed" })
    const { rows } = await su.query(
      `SELECT c.status, count(a.id)::int AS appeals FROM content_complaints c
       LEFT JOIN audit_log a ON a.entity_id = c.id AND a.action = 'complaint.appeal'
       WHERE c.public_code = $1 GROUP BY c.status`,
      [code],
    )
    expect(rows).toEqual([{ status: "appealed", appeals: 1 }])
  })

  test("the appeal window closes", async () => {
    const code = await submitted()
    await decide(code)
    const late = new Date(NOW.getTime() + 181 * 86_400_000)
    const result = await appealComplaint(orgs.a, {
      code,
      userId: complainant,
      text: "Alamat itu masih terlihat di ringkasan isu sampai sekarang.",
      now: late,
    })
    expect(result).toEqual({ ok: false, reason: "closed" })
  })

  test("a short appeal is refused", async () => {
    const code = await submitted()
    await decide(code)
    const result = await appealComplaint(orgs.a, {
      code,
      userId: complainant,
      text: "Tolong",
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: "length" })
  })
})
