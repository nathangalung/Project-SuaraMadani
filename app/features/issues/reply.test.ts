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
import { DAILY_REPLIES } from "../../../shared/replies.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { runMerge } from "../moderation/merge.server.ts"
import { runIssueAction } from "../moderation/referrals.server.ts"
import {
  decideReply,
  decideReplyRequest,
  listReplies,
  parseReplyDecision,
} from "../moderation/replies.server.ts"
import { runPublish } from "./publish.server.ts"
import {
  type ReplyDeps,
  replyRequest,
  replyTarget,
  submitReply,
} from "./reply.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const NOW = new Date("2026-10-13T03:00:00Z")
const NO_PURGE: PurgeClient = {
  purgeUrls: async () => ({ skipped: true }),
  purgeHosts: async () => ({ skipped: true }),
}
const pass: ReplyDeps = { verifyCaptcha: async () => ({ ok: true }) }

let orgA = ""
let orgB = ""
let admin = ""
let agencyUser = ""
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
      email: "humas@pu.go.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: false,
      updatedAt: at,
    },
    session: { id: "s", createdAt: at, expiresAt: at },
  }
}

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData()
  const values: Record<string, string> = {
    submissionId: crypto.randomUUID(),
    agency: "Dinas Bina Marga Kota Bandung",
    senderRole: "Kepala Bidang Jalan",
    body: "Perbaikan jalan di Dago dijadwalkan pada pekan kedua November 2026.",
    sourceUrl: "",
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    ...fields,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

async function seedIssue(publish = true) {
  serial += 1
  const reporter = await insertUser(su, `pelapor.hj${serial}@contoh.id`)
  const [report] = await suDb
    .insert(reports)
    .values(
      reportValues(orgA, reporter, { status: "verified", verifiedAt: NOW }),
    )
    .returning({ id: reports.id })
  if (!report) throw new Error("no report")
  const merged = await runMerge(orgA, {
    reportIds: [report.id],
    target: {
      kind: "new",
      title: "Jalan berlubang di Dago",
      summary: "Beberapa laporan menyebut jalan berlubang sejak Agustus.",
    },
    actorId: admin,
    now: NOW,
  })
  if (!merged.ok) throw new Error(merged.reason)
  if (publish) {
    await runPublish(
      { id: orgA, host: tenantA.host },
      { issueId: merged.issueId, actorId: admin, notify: false },
      { purge: NO_PURGE },
    )
  }
  return { id: merged.issueId, code: merged.code }
}

async function refer(issue: { id: string; code: string }) {
  const { rows } = await su.query<{ version: number }>(
    "SELECT version FROM issues WHERE id = $1",
    [issue.id],
  )
  const result = await runIssueAction(
    { id: orgA, host: tenantA.host },
    {
      issueId: issue.id,
      seen: {
        advocacy: "monitoring",
        government: "awaiting_response",
        version: rows[0]?.version ?? 0,
      },
      actorId: admin,
      action: "refer",
      referral: {
        agency: "Dinas Bina Marga Kota Bandung",
        channel: "official_letter",
        ticket: null,
        sentOn: "2026-10-01",
        deadlineOn: "2026-10-15",
      },
    },
    { purge: NO_PURGE },
  )
  if (!result.ok) throw new Error(result.reason)
}

function submit(code: string, fields: Record<string, string> = {}) {
  return submitReply({
    tenant: tenantA,
    session: session(agencyUser),
    code,
    form: form(fields),
    remoteIp: "192.0.2.1",
    deps: pass,
  })
}

async function replyId(code: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `SELECT r.id FROM agency_replies r JOIN issues i ON i.id = r.issue_id
     WHERE i.public_code = $1 ORDER BY r.created_at DESC LIMIT 1`,
    [code],
  )
  return rows[0]?.id ?? ""
}

async function mails(replyId: string) {
  const { rows } = await su.query<{ template: string; user_id: string }>(
    "SELECT template, user_id FROM notifications WHERE reply_id = $1 ORDER BY created_at",
    [replyId],
  )
  return rows
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  tenantA.id = orgA
  admin = await insertUser(su, "admin.hj@contoh.id")
  agencyUser = await insertUser(su, "humas@pu.go.id")
})

beforeEach(async () => {
  await su.query("DELETE FROM agency_replies")
  await su.query("DELETE FROM issue_reports")
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM org_counters")
  await su.query("DELETE FROM reports")
  await su.query(
    "DELETE FROM pgboss.job WHERE name IN ('email-send', 'issue-notify')",
  )
})

afterAll(async () => {
  await resetData(su)
  await su.query(
    "DELETE FROM pgboss.job WHERE name IN ('email-send', 'issue-notify')",
  )
  await su.end()
})

describe("submitReply", () => {
  test("a signed-in sender files a pending reply with a receipt", async () => {
    const issue = await seedIssue()
    expect(await replyTarget(orgA, issue.code)).toEqual({
      code: issue.code,
      title: "Jalan berlubang di Dago",
    })
    const submissionId = crypto.randomUUID()
    expect(await submit(issue.code, { submissionId })).toEqual({
      status: 201,
      body: { code: issue.code },
    })
    // Retry returns the same
    expect(await submit(issue.code, { submissionId })).toEqual({
      status: 200,
      body: { code: issue.code },
    })
    const id = await replyId(issue.code)
    const { rows } = await su.query(
      "SELECT status, agency, sender_role, source_url, user_id FROM agency_replies WHERE id = $1",
      [id],
    )
    expect(rows).toEqual([
      {
        status: "pending",
        agency: "Dinas Bina Marga Kota Bandung",
        sender_role: "Kepala Bidang Jalan",
        source_url: null,
        user_id: agencyUser,
      },
    ])
    expect(await mails(id)).toEqual([
      { template: "reply_received", user_id: agencyUser },
    ])
    const { rows: audit } = await su.query(
      "SELECT actor_id FROM audit_log WHERE action = 'reply.submit' AND entity_id = $1",
      [issue.id],
    )
    expect(audit).toEqual([{ actor_id: agencyUser }])
    const { rows: member } = await su.query(
      "SELECT role FROM members WHERE organization_id = $1 AND user_id = $2",
      [orgA, agencyUser],
    )
    expect(member).toEqual([{ role: "reporter" }])
  })

  test("refusals: session, fields, captcha, unknown, cap", async () => {
    const issue = await seedIssue()
    expect(
      await submitReply({
        tenant: tenantA,
        session: null,
        code: issue.code,
        form: form(),
        remoteIp: null,
        deps: pass,
      }),
    ).toEqual({ status: 401, body: { error: "sign_in_required" } })
    // WhatsApp sign-up, email unproven
    const unproven = session(agencyUser)
    unproven.user.emailVerified = false
    expect(
      await submitReply({
        tenant: tenantA,
        session: unproven,
        code: issue.code,
        form: form(),
        remoteIp: null,
        deps: pass,
      }),
    ).toEqual({ status: 403, body: { error: "email_unverified" } })
    expect(await submit(issue.code, { body: "pendek" })).toEqual({
      status: 400,
      body: { errors: ["body"] },
    })
    expect(
      await submitReply({
        tenant: tenantA,
        session: session(agencyUser),
        code: issue.code,
        form: form(),
        remoteIp: null,
        deps: {
          verifyCaptcha: async () => ({ ok: false, reason: "rejected" }),
        },
      }),
    ).toEqual({ status: 403, body: { error: "captcha_failed" } })
    const hidden = await seedIssue(false)
    expect(await submit(hidden.code)).toEqual({
      status: 404,
      body: { error: "not_found" },
    })
    expect(
      await submitReply({
        tenant: { ...tenantA, id: orgB },
        session: session(agencyUser),
        code: issue.code,
        form: form(),
        remoteIp: null,
        deps: pass,
      }),
    ).toEqual({ status: 404, body: { error: "not_found" } })
    for (let n = 0; n < DAILY_REPLIES; n++) {
      expect((await submit(issue.code)).status).toBe(201)
    }
    expect(await submit(issue.code)).toEqual({
      status: 429,
      body: { error: "quota_exceeded" },
    })
  })
})

describe("submitReply double submit", () => {
  const spent: ReplyDeps = {
    verifyCaptcha: async () => ({ ok: false, reason: "duplicate" }),
  }
  const retry = (code: string, submissionId: string) =>
    submitReply({
      tenant: tenantA,
      session: session(agencyUser),
      code,
      form: form({ submissionId }),
      remoteIp: null,
      deps: spent,
    })

  test("Given a stored reply, when its retry carries a spent captcha token, then the stored receipt comes back", async () => {
    const issue = await seedIssue()
    const submissionId = crypto.randomUUID()
    expect((await submit(issue.code, { submissionId })).status).toBe(201)
    expect(await retry(issue.code, submissionId)).toEqual({
      status: 200,
      body: { code: issue.code },
    })
    const { rows } = await su.query(
      "SELECT 1 FROM agency_replies WHERE submission_id = $1",
      [submissionId],
    )
    expect(rows).toHaveLength(1)
  })

  test("a spent captcha token without a stored reply is refused and writes nothing", async () => {
    const issue = await seedIssue()
    const submissionId = crypto.randomUUID()
    expect(await retry(issue.code, submissionId)).toEqual({
      status: 403,
      body: { error: "captcha_failed" },
    })
    const { rows } = await su.query(
      "SELECT 1 FROM agency_replies WHERE submission_id = $1",
      [submissionId],
    )
    expect(rows).toHaveLength(0)
  })
})

describe("decideReply", () => {
  test("accept records the response and moves the axis", async () => {
    const issue = await seedIssue()
    await refer(issue)
    await submit(issue.code, { sourceUrl: "https://pu.bandung.go.id/surat" })
    const id = await replyId(issue.code)
    expect(await listReplies(orgA)).toMatchObject([
      {
        id,
        issueCode: issue.code,
        agency: "Dinas Bina Marga Kota Bandung",
        senderEmail: "humas@pu.go.id",
        status: "pending",
      },
    ])
    // Unproven email never shown
    await su.query("UPDATE users SET email_verified = false WHERE id = $1", [
      agencyUser,
    ])
    expect(await listReplies(orgA)).toMatchObject([{ id, senderEmail: null }])
    await su.query("UPDATE users SET email_verified = true WHERE id = $1", [
      agencyUser,
    ])
    const result = await decideReply(
      { id: orgA, host: tenantA.host },
      { replyId: id, actorId: admin, decision: { accept: true } },
      { purge: NO_PURGE },
    )
    expect(result).toMatchObject({ ok: true, code: issue.code })
    const { rows: issueRow } = await su.query(
      "SELECT gov_status FROM issues WHERE id = $1",
      [issue.id],
    )
    expect(issueRow).toEqual([{ gov_status: "responded" }])
    const { rows: response } = await su.query(
      `SELECT r.agency, r.body, r.source_url, r.created_by, a.status, a.decided_by
       FROM agency_replies a JOIN responses r ON r.id = a.response_id WHERE a.id = $1`,
      [id],
    )
    expect(response).toEqual([
      {
        agency: "Dinas Bina Marga Kota Bandung",
        body: "Perbaikan jalan di Dago dijadwalkan pada pekan kedua November 2026.",
        source_url: "https://pu.bandung.go.id/surat",
        created_by: admin,
        status: "accepted",
        decided_by: admin,
      },
    ])
    expect((await mails(id)).map((row) => row.template)).toEqual([
      "reply_received",
      "reply_decided",
    ])
    const { rows: jobs } = await su.query(
      "SELECT 1 FROM pgboss.job WHERE name = 'issue-notify' AND data->>'template' = 'issue_record_response' AND data->>'issueId' = $1",
      [issue.id],
    )
    expect(jobs).toHaveLength(1)
    // Decided once only
    expect(
      await decideReply(
        { id: orgA, host: tenantA.host },
        { replyId: id, actorId: admin, decision: { reject: "off_topic" } },
        { purge: NO_PURGE },
      ),
    ).toEqual({ ok: false, reason: "changed" })
  })

  test("without a source the issue page is cited", async () => {
    const issue = await seedIssue()
    await refer(issue)
    await submit(issue.code)
    const id = await replyId(issue.code)
    await decideReply(
      { id: orgA, host: tenantA.host },
      { replyId: id, actorId: admin, decision: { accept: true } },
      { purge: NO_PURGE, origin: "https://itb.sadarbersuara.id" },
    )
    const { rows } = await su.query(
      "SELECT r.source_url FROM agency_replies a JOIN responses r ON r.id = a.response_id WHERE a.id = $1",
      [id],
    )
    expect(rows).toEqual([
      {
        source_url: `https://itb.sadarbersuara.id/isu/${issue.code}#tanggapan`,
      },
    ])
  })

  test("accept waits while the state forbids a response", async () => {
    const issue = await seedIssue()
    // Not referred yet: allowed
    await submit(issue.code)
    const id = await replyId(issue.code)
    await su.query("UPDATE issues SET gov_status = 'closed' WHERE id = $1", [
      issue.id,
    ])
    expect(
      await decideReply(
        { id: orgA, host: tenantA.host },
        { replyId: id, actorId: admin, decision: { accept: true } },
        { purge: NO_PURGE },
      ),
    ).toEqual({ ok: false, reason: "not_allowed" })
    const { rows } = await su.query(
      "SELECT status FROM agency_replies WHERE id = $1",
      [id],
    )
    expect(rows).toEqual([{ status: "pending" }])
  })

  test("reject stores the reason and tells the sender", async () => {
    const issue = await seedIssue()
    await submit(issue.code)
    const id = await replyId(issue.code)
    expect(
      await decideReply(
        { id: orgA, host: tenantA.host },
        {
          replyId: id,
          actorId: admin,
          decision: { reject: "sender_unconfirmed" },
        },
        { purge: NO_PURGE },
      ),
    ).toMatchObject({ ok: true })
    const { rows } = await su.query(
      "SELECT status, reject_reason, response_id FROM agency_replies WHERE id = $1",
      [id],
    )
    expect(rows).toEqual([
      {
        status: "rejected",
        reject_reason: "sender_unconfirmed",
        response_id: null,
      },
    ])
    const { rows: audit } = await su.query(
      "SELECT reason_code FROM audit_log WHERE action = 'reply.reject' AND entity_id = $1",
      [issue.id],
    )
    expect(audit).toEqual([{ reason_code: "sender_unconfirmed" }])
    expect(await listReplies(orgA)).toEqual([])
    expect(await listReplies(orgA, "rejected")).toHaveLength(1)
    expect(await listReplies(orgB)).toEqual([])
  })
})

describe("reply forms", () => {
  function data(fields: Record<string, string>): FormData {
    const out = new FormData()
    for (const [key, value] of Object.entries(fields)) out.set(key, value)
    return out
  }

  test("the admin decision form", () => {
    expect(parseReplyDecision(data({ intent: "accept" }))).toEqual({
      accept: true,
    })
    expect(
      parseReplyDecision(
        data({ intent: "accept", sourceUrl: "https://pu.go.id/a" }),
      ),
    ).toEqual({ accept: true, sourceUrl: "https://pu.go.id/a" })
    expect(
      parseReplyDecision(data({ intent: "reject", reason: "off_topic" })),
    ).toEqual({ reject: "off_topic" })
    expect(
      parseReplyDecision(data({ intent: "accept", sourceUrl: "ftp://x" })),
    ).toBeNull()
    expect(
      parseReplyDecision(data({ intent: "reject", reason: "rude" })),
    ).toBeNull()
    expect(parseReplyDecision(data({ intent: "delete" }))).toBeNull()
  })

  test("Given the route form without a captcha token, when posted, then 403 captcha_failed and no reply", async () => {
    const issue = await seedIssue()
    const body = form({ turnstileToken: "" })
    const submissionId = String(body.get("submissionId"))
    const request = new Request(
      `http://itb.localhost/isu/${issue.code}/hak-jawab`,
      { method: "POST", body },
    )
    expect(
      await replyRequest({
        request,
        tenant: tenantA,
        session: session(agencyUser),
        code: issue.code,
      }),
    ).toEqual({ status: 403, body: { error: "captcha_failed" } })
    const { rows } = await su.query(
      "SELECT 1 FROM agency_replies WHERE submission_id = $1",
      [submissionId],
    )
    expect(rows).toHaveLength(0)
  })

  test("an oversized body is refused before parsing", async () => {
    const request = new Request("http://itb.localhost/isu/x/hak-jawab", {
      method: "POST",
      headers: { "content-length": String(70 * 1024) },
      body: "x",
    })
    expect(
      await replyRequest({
        request,
        tenant: tenantA,
        session: session(agencyUser),
        code: "x",
      }),
    ).toEqual({ status: 413 })
  })
})

describe("decideReplyRequest", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    decideReplyRequest({
      request: new Request("http://itb.localhost/kelola/hak-jawab", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body,
      }),
      admin: { tenant: tenantA, session: session(admin) },
    })

  test("a bad reply id or decision is refused as invalid", async () => {
    for (const body of [
      "replyId=x&intent=accept",
      `replyId=${crypto.randomUUID()}&intent=delete`,
    ]) {
      expect(await post(body)).toEqual({ ok: false, reason: "invalid" })
    }
  })

  test("an oversized body is refused before parsing", async () => {
    expect(await post("x", { "content-length": String(9 * 1024) })).toEqual({
      ok: false,
      reason: "too_large",
    })
  })

  test("a decided reply id answers changed", async () => {
    const body = `replyId=${crypto.randomUUID()}&intent=accept`
    expect(await post(body)).toEqual({ ok: false, reason: "changed" })
  })
})
