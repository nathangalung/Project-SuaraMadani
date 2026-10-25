import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import {
  CAPTCHA_PASS,
  dropJobs,
  type FullApp,
  formRequest,
  fullApp,
  hostsChanged,
  mailbox,
  routeContext,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../../../e2e/app-harness.ts"
import {
  issueAction,
  issueRow,
  referFields,
  reportToIssue,
  submitReport,
} from "../../../e2e/staff-flows.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import {
  decideReplyRequest,
  listReplies,
} from "../moderation/replies.server.ts"
import { replyRequest } from "./reply.server.ts"

const HOST = "accrpl.localhost"
const OTHER = "accrplb.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
let app: FullApp
let orgA = ""
let orgB = ""
let admin: Staff
let adminB: Staff
let restore = () => {}
let seq = 0

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62813333${String(seq).padStart(5, "0")}`,
    name: "Humas Dinas",
  }
}

const REPLY = {
  agency: "Dinas PU Kota Bandung",
  senderRole: "Kepala Bidang Jalan",
  body: "Perbaikan jalan dijadwalkan pekan depan setelah anggaran disetujui.",
  sourceUrl: "https://pu.bandung.go.id/hak-jawab/1",
}

async function referredIssue(host = HOST, staff = () => admin) {
  const owner = await signedIn(host, person("pelapor"))
  const { code: report } = await submitReport(app, host, owner.cookie)
  const code = await reportToIssue(app, su, host, staff().cookie, report)
  const today = jakartaIsoDate(new Date())
  await issueAction(
    app,
    su,
    host,
    staff().cookie,
    code,
    referFields(today, today),
  )
  return { code, owner }
}

async function send(
  code: string,
  cookie: string,
  fields: Record<string, string> = {},
  host = HOST,
) {
  const { tenant, session } = await routeContext(host, cookie)
  return replyRequest({
    request: formRequest(`http://${host}/isu/${code}/hak-jawab`, {
      submissionId: crypto.randomUUID(),
      turnstileToken: CAPTCHA_PASS,
      ...REPLY,
      ...fields,
    }),
    tenant,
    session,
    code,
  })
}

async function emailOf(userId: string): Promise<string> {
  const { rows } = await su.query<{ email: string }>(
    "SELECT email FROM users WHERE id = $1",
    [userId],
  )
  return rows[0]?.email ?? ""
}

/** Admin queue form, real Request. */
async function decide(replyId: string, fields: Record<string, string>) {
  const { tenant, session } = await routeContext(HOST, admin.cookie)
  if (!session) throw new Error("admin session")
  return decideReplyRequest({
    request: formRequest(`${ORIGIN}/kelola/hak-jawab`, { replyId, ...fields }),
    admin: { tenant, session },
  })
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "accrpl")
  orgB = await insertOrg(su, "accrplb")
  hostsChanged([HOST, OTHER])
  await su.query("DELETE FROM email_log")
  restore = stubTurnstile()
  app = await fullApp()
  admin = await staffSession(HOST, orgA, person("admin"))
  adminB = await staffSession(OTHER, orgB, person("adminb"))
})

afterAll(async () => {
  await dropJobs(su, [HOST, OTHER])
  // Later files rebuild auth
  hostsChanged([HOST, OTHER])
  restore()
  await resetData(su)
  await su.end()
})

describe("agency right of reply", () => {
  test("[AC-REPLY-01] Given a published issue, when an agency officer with a proven email sends a reply with Turnstile, then it waits in the admin queue with the sender's email, is audited and the sender gets a receipt", async () => {
    const { code } = await referredIssue()
    const officer = await signedIn(HOST, person("humas"))
    expect(await send(code, officer.cookie)).toEqual({
      status: 201,
      body: { code },
    })
    const queue = await listReplies(orgA)
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      issueCode: code,
      agency: REPLY.agency,
      senderRole: REPLY.senderRole,
      status: "pending",
      senderEmail: await emailOf(officer.userId),
    })
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'reply.submit' AND actor_id = $1",
      [officer.userId],
    )
    expect(audit.rowCount).toBe(1)
    const box = mailbox()
    await box.deliver(su, orgA)
    const address = await emailOf(officer.userId)
    expect(box.sent.filter((m) => m.to === address)).toHaveLength(1)
  })

  test("[AC-REPLY-02] Given the reply form, when it comes without a session, from an unproven email, with a failed Turnstile, with bad fields, for a hidden issue or beyond five a day, then each is refused, and another campus keeps its own five", async () => {
    const { code } = await referredIssue()
    expect((await send(code, "")).status).toBe(401)
    const unproven = await signedIn(HOST, person("tanpaemail"))
    await su.query("UPDATE users SET email_verified = false WHERE id = $1", [
      unproven.userId,
    ])
    expect(await send(code, unproven.cookie)).toEqual({
      status: 403,
      body: { error: "email_unverified" },
    })
    const officer = await signedIn(HOST, person("petugas"))
    expect(
      await send(code, officer.cookie, { turnstileToken: "robot" }),
    ).toEqual({ status: 403, body: { error: "captcha_failed" } })
    const bad = await send(code, officer.cookie, {
      agency: "",
      senderRole: "x",
      body: "pendek",
      sourceUrl: "javascript:alert(1)",
    })
    expect(bad).toEqual({
      status: 400,
      body: { errors: ["agency", "sender_role", "body", "source_url"] },
    })
    expect((await send("ISU-2026-10-0999", officer.cookie)).status).toBe(404)
    for (let i = 0; i < 5; i++) {
      expect((await send(code, officer.cookie)).status).toBe(201)
    }
    expect(await send(code, officer.cookie)).toEqual({
      status: 429,
      body: { error: "quota_exceeded" },
    })
    const elsewhere = await referredIssue(OTHER, () => adminB)
    const there = await signedIn(OTHER, {
      email: await emailOf(officer.userId),
      phone: "+6281333300000",
      name: "Humas Dinas",
    })
    expect((await send(elsewhere.code, there.cookie, {}, OTHER)).status).toBe(
      201,
    )
  })

  test("[AC-REPLY-03] Given a pending reply, when an admin accepts it, then it becomes the agency response with a source, the government axis says Ditanggapi, the sender is emailed while followers are not, and it is audited", async () => {
    const { code, owner } = await referredIssue()
    const officer = await signedIn(HOST, person("terima"))
    await send(code, officer.cookie, { sourceUrl: "" })
    await mailbox().deliver(su, orgA)
    const pending = (await listReplies(orgA)).find(
      (one) => one.issueCode === code,
    )
    if (!pending) throw new Error("no reply")
    const result = await decide(pending.id, { intent: "accept" })
    expect(result.ok).toBe(true)
    expect((await issueRow(su, HOST, code)).gov_status).toBe("responded")
    const json = await (
      await app.request(`${ORIGIN}/api/v1/isu/${code}`)
    ).json()
    expect(json.issue.responses).toEqual([
      expect.objectContaining({
        agency: REPLY.agency,
        body: REPLY.body,
        sourceUrl: `${ORIGIN}/isu/${code}#tanggapan`,
      }),
    ])
    const box = mailbox()
    await box.deliver(su, orgA)
    const sender = await emailOf(officer.userId)
    expect(box.sent.filter((m) => m.to === sender)).toHaveLength(1)
    // Follower emails removed 25 Oct
    const reporter = await emailOf(owner.userId)
    expect(box.sent.filter((m) => m.to === reporter)).toEqual([])
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'reply.accept' AND actor_id = $1",
      [admin.userId],
    )
    expect(audit.rowCount).toBe(1)
  })

  test("[AC-REPLY-04] Given pending replies, when the issue's state forbids a response or the admin rejects one with a reason, then the first stays pending and the second is rejected and the sender told", async () => {
    const { code } = await referredIssue()
    const officer = await signedIn(HOST, person("tolak"))
    await send(code, officer.cookie)
    await issueAction(app, su, HOST, admin.cookie, code, {
      intent: "mark_in_progress",
      note: "",
    })
    const pending = (await listReplies(orgA)).find(
      (one) => one.issueCode === code,
    )
    if (!pending) throw new Error("no reply")
    const refused = await decide(pending.id, { intent: "accept" })
    expect(refused).toEqual({ ok: false, reason: "not_allowed" })
    expect((await listReplies(orgA)).map((one) => one.id)).toContain(pending.id)
    await mailbox().deliver(su, orgA)
    const rejected = await decide(pending.id, {
      intent: "reject",
      reason: "sender_unconfirmed",
    })
    expect(rejected.ok).toBe(true)
    const done = await listReplies(orgA, "rejected")
    expect(done.find((one) => one.id === pending.id)?.rejectReason).toBe(
      "sender_unconfirmed",
    )
    const box = mailbox()
    await box.deliver(su, orgA)
    const address = await emailOf(officer.userId)
    expect(box.sent.filter((m) => m.to === address)).toHaveLength(1)
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'reply.reject' AND actor_id = $1",
      [admin.userId],
    )
    expect(audit.rowCount).toBe(1)
  })
})
