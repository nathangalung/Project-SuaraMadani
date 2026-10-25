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
  insertedUsers,
  mailbox,
  queued,
  routeContext,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../../../e2e/app-harness.ts"
import {
  issueAction,
  issueRow,
  postForm,
  publishIssue,
  reportToIssue,
  review,
  submitReport,
} from "../../../e2e/staff-flows.ts"
import {
  LINK_TTL_MS,
  linkKeyring,
  verifyLink,
} from "../../../server/signed-link.ts"
import { nextSendMorning } from "../../../shared/notifications.ts"
import { createSurveySendHandler } from "../../../worker/survey-send.ts"
import { claimReview, claimSection } from "./claims.server.ts"
import { ownClaimRating, rateClaimRequest } from "./ratings.server.ts"
import { answerSurveyRequest, surveyTarget } from "./survey.server.ts"

const HOST = "accclm.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
let app: FullApp
let orgId = ""
let admin: Staff
let restore = () => {}
let seq = 0

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62813222${String(seq).padStart(5, "0")}`,
    name: "Warga Klaim",
  }
}

type Reporter = { cookie: string; userId: string }

/** Published issue with its reporters. */
async function issueWith(count: number): Promise<{
  code: string
  reporters: Reporter[]
}> {
  const reporters: Reporter[] = []
  for (let i = 0; i < count; i++) {
    reporters.push(await signedIn(HOST, person(`pelapor${i}`)))
  }
  const first = reporters[0]
  if (!first) throw new Error("one reporter needed")
  const { code: report } = await submitReport(app, HOST, first.cookie)
  const code = await reportToIssue(app, su, HOST, admin.cookie, report)
  await publishIssue(app, su, HOST, admin.cookie, code)
  const { id } = await issueRow(su, HOST, code)
  for (const other of reporters.slice(1)) {
    const extra = await submitReport(app, HOST, other.cookie)
    await review(app, su, HOST, admin.cookie, extra.code, {
      intent: "start_review",
    })
    await review(app, su, HOST, admin.cookie, extra.code, {
      intent: "verify",
      method: "document",
    })
    await postForm(
      app,
      `${ORIGIN}/kelola/laporan/${extra.code}`,
      admin.cookie,
      { intent: "merge", target: "existing", issueId: id },
    )
  }
  return { code, reporters }
}

async function claim(code: string) {
  const res = await issueAction(app, su, HOST, admin.cookie, code, {
    intent: "claim_resolved",
    note: "",
  })
  if (res.status !== 303) throw new Error(`claim ${res.status}`)
  const { rows } = await su.query<{ id: string }>(
    `SELECT c.id FROM resolution_claims c JOIN issues i ON i.id = c.issue_id
     WHERE i.public_code = $1 AND c.closed_at IS NULL`,
    [code],
  )
  const id = rows[0]?.id
  if (!id) throw new Error("no open round")
  return id
}

async function rate(
  code: string,
  cookie: string,
  fields: Record<string, string> = {},
  ip = "10.40.0.1",
) {
  const { tenant, session } = await routeContext(HOST, cookie)
  return rateClaimRequest({
    request: formRequest(
      `${ORIGIN}/isu/${code}/nilai`,
      {
        intent: "rate",
        submissionId: crypto.randomUUID(),
        score: "4",
        turnstileToken: CAPTCHA_PASS,
        ...fields,
      },
      ip,
    ),
    tenant,
    session,
    code,
  })
}

/** Survey links the worker mailed. */
async function surveyLinks(sentAt = new Date()): Promise<Map<string, string>> {
  const box = mailbox(() => sentAt)
  await box.deliver(su, orgId)
  const links = new Map<string, string>()
  for (const mail of box.sent) {
    const token = /\/survei\?t=([A-Za-z0-9._-]+)/.exec(mail.text)?.[1]
    if (!token) continue
    if (links.has(mail.to)) throw new Error(`two surveys to ${mail.to}`)
    links.set(mail.to, token)
  }
  return links
}

async function emailOf(userId: string): Promise<string> {
  const { rows } = await su.query<{ email: string }>(
    "SELECT email FROM users WHERE id = $1",
    [userId],
  )
  return rows[0]?.email ?? ""
}

/** Runs the 28-day job now. */
async function sendSurvey(claimId: string, enabled = true) {
  const jobs = await queued<{ orgId: string; claimId: string }>(
    su,
    "survey-send",
    orgId,
  )
  const job = jobs.find((one) => one.data.claimId === claimId)
  if (!job) throw new Error("no survey job")
  await su.query("UPDATE pgboss.job SET state = 'completed' WHERE id = $1", [
    job.id,
  ])
  return createSurveySendHandler({ enabled })(job.data)
}

async function answer(
  code: string,
  token: string | null,
  value: string,
  cookie = "",
) {
  const { tenant, session } = await routeContext(HOST, cookie)
  return answerSurveyRequest({
    // Hidden field keeps t
    request: formRequest(`${ORIGIN}/isu/${code}/survei`, {
      answer: value,
      ...(token === null ? {} : { t: token }),
    }),
    tenant,
    session,
    code,
  })
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "accclm")
  hostsChanged([HOST])
  await su.query("DELETE FROM email_log")
  restore = stubTurnstile()
  app = await fullApp()
  admin = await staffSession(HOST, orgId, person("admin"))
})

afterAll(async () => {
  await dropJobs(su, [HOST])
  // Later files rebuild auth
  hostsChanged([HOST])
  restore()
  await resetData(su)
  await su.end()
})

describe("resolution claims and ratings", () => {
  test("[AC-CLAIM-01] Given a published issue, when an admin marks it claimed resolved, then a claim round opens, a survey is scheduled 28 days later and followers are emailed", async () => {
    const { code, reporters } = await issueWith(1)
    await mailbox().deliver(su, orgId)
    const before = Date.now()
    const claimId = await claim(code)
    const { rows } = await su.query<{
      claimed_by: string
      closed_at: Date | null
    }>("SELECT claimed_by, closed_at FROM resolution_claims WHERE id = $1", [
      claimId,
    ])
    expect(rows[0]).toEqual({ claimed_by: admin.userId, closed_at: null })
    const jobs = await queued<{ orgId: string; claimId: string }>(
      su,
      "survey-send",
      orgId,
    )
    const job = jobs.find((one) => one.data.claimId === claimId)
    const days = ((job?.startAfter.getTime() ?? 0) - before) / 86_400_000
    expect(days).toBeGreaterThan(27.99)
    expect(days).toBeLessThan(28.01)
    const section = await claimSection(orgId, code)
    expect(section?.current?.claimId).toBe(claimId)
    const reporter = reporters[0]
    if (!reporter) throw new Error("no reporter")
    const box = mailbox()
    await box.deliver(su, orgId)
    const address = await emailOf(reporter.userId)
    const mine = box.sent.filter((m) => m.to === address)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.text).toContain(code)
  })

  test("[AC-CLAIM-02] Given an open claim round, when people rate it, then a rating needs an account, Turnstile and a 1-5 score, is stored once per account and never changed, and a closed round refuses ratings", async () => {
    const { code, reporters } = await issueWith(1)
    const noRound = await rate(code, reporters[0]?.cookie ?? "")
    expect(noRound.status).toBe(409)
    await claim(code)
    expect((await rate(code, "")).status).toBe(401)
    const citizen = await signedIn(HOST, person("penilai"))
    expect(
      (await rate(code, citizen.cookie, { turnstileToken: "robot" })).status,
    ).toBe(403)
    expect((await rate(code, citizen.cookie, { score: "0" })).status).toBe(400)
    const saved = await rate(code, citizen.cookie, { score: "5" })
    expect(saved).toEqual({ status: 201, body: { saved: "rated" } })
    const again = await rate(code, citizen.cookie, { score: "1" })
    expect(again).toEqual({ status: 409, body: { error: "already_rated" } })
    expect(await ownClaimRating(orgId, code, citizen.userId)).toBe(5)
    const reporter = reporters[0]
    if (!reporter) throw new Error("no reporter")
    expect((await rate(code, reporter.cookie)).status).toBe(201)
    const { rows } = await su.query<{ is_reporter: boolean }>(
      "SELECT is_reporter FROM ratings WHERE user_id = $1",
      [reporter.userId],
    )
    expect(rows[0]?.is_reporter).toBe(true)
    await issueAction(app, su, HOST, admin.cookie, code, {
      intent: "confirm_resolved",
      note: "Perbaikan sudah dicek langsung oleh admin di lokasi.",
    })
    const late = await signedIn(HOST, person("telat"))
    expect(await rate(code, late.cookie)).toEqual({
      status: 409,
      body: { error: "closed" },
    })
  })

  test("[AC-CLAIM-03] Given ratings from reporters, older and new accounts, when the claim section is read, then reporters and other citizens are apart, new accounts are not counted and each distribution is hidden below ten without a mean", async () => {
    const { code } = await issueWith(1)
    const claimId = await claim(code)
    const insert = async (
      userIds: string[],
      reporter: boolean,
      days: number,
      score: (i: number) => number,
    ) => {
      for (const [i, userId] of userIds.entries()) {
        await su.query(
          `INSERT INTO ratings (org_id, claim_id, user_id, score, is_reporter, account_days, client_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orgId, claimId, userId, score(i), reporter, days, `h${userId}`],
        )
      }
    }
    const read = async () => {
      const { tenant } = await routeContext(HOST, "")
      return (await claimSection(tenant.id, code))?.current?.ratings
    }
    // Reporters all say 5
    await insert(await insertedUsers(su, 9, 30), true, 30, () => 5)
    await insert(await insertedUsers(su, 10, 30), false, 30, (i) => (i % 5) + 1)
    await insert(await insertedUsers(su, 3, 2), false, 2, () => 1)
    const under = await read()
    expect(under?.reporters).toEqual({ n: 9, counts: null })
    expect(under?.others).toEqual({
      n: 10,
      counts: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 },
    })
    await insert(await insertedUsers(su, 1, 30), true, 30, () => 5)
    const section = await read()
    expect(section?.reporters).toEqual({
      n: 10,
      counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 10 },
    })
    expect(section?.others.n).toBe(10)
    expect(JSON.stringify(section)).not.toContain("mean")
    const review = await claimReview(orgId, (await issueRow(su, HOST, code)).id)
    expect(review?.excluded).toBe(3)
  })

  test("[AC-CLAIM-04] Given one address prefix, when a twenty-first account rates a round from it, then the server answers 429, and the admin review flags a round dominated by one prefix or by young accounts", async () => {
    const { code } = await issueWith(1)
    await claim(code)
    for (let i = 0; i < 20; i++) {
      const one = await signedIn(HOST, person(`prefiks${i}`))
      expect((await rate(code, one.cookie, {}, "10.41.0.7")).status).toBe(201)
    }
    const extra = await signedIn(HOST, person("lebih"))
    expect(await rate(code, extra.cookie, {}, "10.41.0.7")).toEqual({
      status: 429,
      body: { error: "prefix_cap" },
    })
    const review = await claimReview(orgId, (await issueRow(su, HOST, code)).id)
    expect(review?.anomaly).toEqual({ prefix: true, young: true })
    const calm = await issueWith(1)
    const calmClaim = await claim(calm.code)
    const old = await insertedUsers(su, 10, 60)
    for (const [i, userId] of old.entries()) {
      await su.query(
        `INSERT INTO ratings (org_id, claim_id, user_id, score, is_reporter, account_days, client_hash)
         VALUES ($1, $2, $3, 4, false, 60, $4)`,
        [orgId, calmClaim, userId, `p${i}`],
      )
    }
    const fine = await claimReview(
      orgId,
      (await issueRow(su, HOST, calm.code)).id,
    )
    expect(fine?.anomaly).toEqual({ prefix: false, young: false })
  })
})

describe("survey Sudah beres?", () => {
  test("[AC-SURVEY-01] Given a claim round whose survey is due, when survey-send runs, then only reporters email can reach are invited with a signed 30-day link, not WhatsApp-only ones, and while surveys are off nothing is sent and the job waits for the next morning", async () => {
    const { code, reporters } = await issueWith(2)
    const [mailable, whatsappOnly] = reporters
    if (!mailable || !whatsappOnly) throw new Error("two reporters")
    // Proved a number, not email
    await su.query(
      "UPDATE users SET email_verified = false, phone_verified = true WHERE id = $1",
      [whatsappOnly.userId],
    )
    const claimId = await claim(code)
    await mailbox().deliver(su, orgId)
    const off = await sendSurvey(claimId, false)
    expect(off).toEqual({ skipped: "disabled" })
    expect(await queued(su, "email-send", orgId)).toEqual([])
    const invited = async () =>
      (
        await su.query<{ user_id: string }>(
          "SELECT user_id FROM fix_surveys WHERE claim_id = $1",
          [claimId],
        )
      ).rows.map((row) => row.user_id)
    expect(await invited()).toEqual([])
    const waiting = await queued<{ orgId: string; claimId: string }>(
      su,
      "survey-send",
      orgId,
    )
    const next = waiting.find((one) => one.data.claimId === claimId)
    expect(next?.startAfter.getTime()).toBe(
      nextSendMorning(new Date()).getTime(),
    )
    expect(await sendSurvey(claimId, true)).toEqual({ surveys: 1 })
    expect(await invited()).toEqual([mailable.userId])
    const sentAt = new Date()
    const links = await surveyLinks(sentAt)
    expect([...links.keys()]).toEqual([await emailOf(mailable.userId)])
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'claim.survey_send' AND org_id = $1",
      [orgId],
    )
    expect(audit.rowCount).toBe(1)
    const token = [...links.values()][0] ?? null
    const valid = (ms: number) =>
      verifyLink(linkKeyring(), token ?? "", {
        purpose: "survei",
        orgId,
        now: new Date(sentAt.getTime() + ms),
      })
    expect(valid(LINK_TTL_MS - 1000)).not.toBeNull()
    expect(valid(LINK_TTL_MS)).toBeNull()
    const { tenant } = await routeContext(HOST, "")
    const target = await surveyTarget({ tenant, code, token, session: null })
    expect(target).toMatchObject({ status: "open", code, answer: null })
  })

  test("[AC-SURVEY-02] Given an invited reporter, when they answer belum beres, then the issue reopens at once on the survey's basis and followers are told", async () => {
    const { code, reporters } = await issueWith(2)
    const claimId = await claim(code)
    await sendSurvey(claimId)
    const links = await surveyLinks()
    const first = reporters[0]
    if (!first) throw new Error("no reporter")
    const token = links.get(await emailOf(first.userId)) ?? null
    const result = await answer(code, token, "not_fixed")
    expect(result).toEqual({
      status: 200,
      body: { saved: "not_fixed", decided: "reopen" },
    })
    expect((await issueRow(su, HOST, code)).gov_status).toBe("reopened")
    const { rows } = await su.query<{ outcome: string; basis: string }>(
      "SELECT outcome, basis FROM resolution_claims WHERE id = $1",
      [claimId],
    )
    expect(rows[0]).toEqual({ outcome: "reopened", basis: "survey" })
    const box = mailbox()
    await box.deliver(su, orgId)
    const second = reporters[1]
    if (!second) throw new Error("no reporter")
    const address = await emailOf(second.userId)
    const told = box.sent.filter((m) => m.to === address)
    expect(told).toHaveLength(1)
    expect(told[0]?.text).toContain(code)
    const audit = await su.query<{ reason_code: string }>(
      "SELECT reason_code FROM audit_log WHERE action = 'claim.survey_answer' AND actor_id = $1",
      [first.userId],
    )
    expect(audit.rows).toEqual([{ reason_code: "not_fixed" }])
  })

  test("[AC-SURVEY-03] Given every invited reporter, when all answer sudah beres, then the issue is confirmed resolved on the survey's basis, and not before the last answer", async () => {
    const { code, reporters } = await issueWith(2)
    const claimId = await claim(code)
    await sendSurvey(claimId)
    const links = await surveyLinks()
    const [first, second] = reporters
    if (!first || !second) throw new Error("two reporters")
    const one = await answer(
      code,
      links.get(await emailOf(first.userId)) ?? null,
      "fixed",
    )
    expect(one).toEqual({
      status: 200,
      body: { saved: "fixed", decided: null },
    })
    expect((await issueRow(su, HOST, code)).gov_status).toBe("claimed_resolved")
    const two = await answer(
      code,
      links.get(await emailOf(second.userId)) ?? null,
      "fixed",
    )
    expect(two).toEqual({
      status: 200,
      body: { saved: "fixed", decided: "confirm" },
    })
    expect((await issueRow(su, HOST, code)).gov_status).toBe(
      "confirmed_resolved",
    )
    const { rows } = await su.query<{ outcome: string; basis: string }>(
      "SELECT outcome, basis FROM resolution_claims WHERE id = $1",
      [claimId],
    )
    expect(rows[0]).toEqual({ outcome: "confirmed", basis: "survey" })
  })

  test("[AC-SURVEY-04] Given survey links, when someone not invited, someone without a link or session, or an old round's link answers, then each is refused", async () => {
    const { code, reporters } = await issueWith(1)
    const claimId = await claim(code)
    await sendSurvey(claimId)
    const links = await surveyLinks()
    const reporter = reporters[0]
    if (!reporter) throw new Error("no reporter")
    const token = links.get(await emailOf(reporter.userId)) ?? null
    expect((await answer(code, null, "fixed")).status).toBe(401)
    const stranger = await signedIn(HOST, person("asing"))
    expect(await answer(code, null, "fixed", stranger.cookie)).toEqual({
      status: 403,
      body: { error: "not_invited" },
    })
    expect((await answer(code, token, "maybe")).status).toBe(400)
    await issueAction(app, su, HOST, admin.cookie, code, {
      intent: "reopen",
      note: "Warga melaporkan masalah yang sama masih terjadi.",
    })
    await claim(code)
    expect(await answer(code, token, "fixed")).toEqual({
      status: 409,
      body: { error: "closed" },
    })
  })

  test("[AC-SURVEY-05] Given an open claim round, when an admin confirms it on the issue page, then the round closes as confirmed on the admin's basis", async () => {
    const { code } = await issueWith(1)
    const claimId = await claim(code)
    const res = await issueAction(app, su, HOST, admin.cookie, code, {
      intent: "confirm_resolved",
      note: "Perbaikan sudah dicek langsung oleh admin di lokasi.",
    })
    expect(res.status).toBe(303)
    const { rows } = await su.query<{
      outcome: string
      basis: string
      closed_by: string
    }>(
      "SELECT outcome, basis, closed_by FROM resolution_claims WHERE id = $1",
      [claimId],
    )
    expect(rows[0]).toEqual({
      outcome: "confirmed",
      basis: "admin",
      closed_by: admin.userId,
    })
  })
})
