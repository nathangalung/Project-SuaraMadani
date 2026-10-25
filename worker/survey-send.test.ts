import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { migrate } from "../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import type { EmailMessage } from "../server/email.ts"
import { parseHashKey } from "../server/email-log.ts"
import { parseKeyring, verifyLink } from "../server/signed-link.ts"
import { TAKEDOWN_REASONS } from "../shared/complaints.ts"
import { formatDate } from "../shared/format.ts"
import { createEmailSendHandler, type EmailSendDeps } from "./email-send.ts"
import { createSurveySendHandler, surveyEnabled } from "./survey-send.ts"

const su = superuserPool()
// 05:00 WIB, quiet hours
const EARLY = new Date("2026-11-10T22:00:00Z")
// 10:00 WIB
const NOW = new Date("2026-11-11T03:00:00Z")
const keyring = parseKeyring(`1:${Buffer.alloc(32, 5).toString("base64")}`)
const key = parseHashKey(Buffer.alloc(32, 6).toString("base64"))

let orgA = ""
let reporterOne = ""
let reporterTwo = ""
let number = 0
let sent: EmailMessage[] = []

function mailDeps(): EmailSendDeps {
  return {
    email: {
      send: async (message) => {
        sent.push(message)
      },
    },
    keyring: () => keyring,
    hashKey: () => key,
    now: () => NOW,
    originFor: (host) => `https://${host}`,
  }
}

async function issueWithClaim(
  values: { reporters?: string[]; published?: boolean; gov?: string } = {},
) {
  number++
  const code = `ISU-2026-10-${String(number).padStart(4, "0")}`
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
       category_id, subcategory_id, province_code, regency_code,
       gov_status, advocacy_status, report_count, published_at)
     VALUES ($1, 2026, $2, $3, 'Atap sekolah runtuh', 'Ringkasan isu.',
       'program', 'program.pendidikan', '32', '32.73', $4, 'referred', 1, $5)
     RETURNING id`,
    [
      orgA,
      number,
      code,
      values.gov ?? "claimed_resolved",
      values.published === false ? null : NOW,
    ],
  )
  const issueId = rows[0]?.id ?? ""
  for (const userId of values.reporters ?? [reporterOne, reporterTwo]) {
    // Two reports, one reporter
    for (let copy = 0; copy < 2; copy++) {
      const report = reportValues(orgA, userId, { status: "merged" })
      const inserted = await su.query<{ id: string }>(
        `INSERT INTO reports (org_id, user_id, public_code, submission_id,
           relation, province_code, regency_code, district_code, title, story,
           category_id, subcategory_id, occurred_on, urgency,
           affected_groups, affected_count, ongoing, contactable, consents,
           consent_text_version, status)
         VALUES ($1, $2, $3, $4, 'self', '32', '32.73', '32.73.02', $5, $6,
           'program', 'program.pendidikan', '2026-10-01', 'medium',
           '{general_public}', '11_100', 'yes', true, $7, $8, 'merged')
         RETURNING id`,
        [
          orgA,
          userId,
          report.publicCode,
          report.submissionId,
          report.title,
          report.story,
          report.consents,
          report.consentTextVersion,
        ],
      )
      await su.query(
        "INSERT INTO issue_reports (org_id, issue_id, report_id) VALUES ($1, $2, $3)",
        [orgA, issueId, inserted.rows[0]?.id],
      )
    }
  }
  const claim = await su.query<{ id: string }>(
    "INSERT INTO resolution_claims (org_id, issue_id) VALUES ($1, $2) RETURNING id",
    [orgA, issueId],
  )
  return { issueId, code, claimId: claim.rows[0]?.id ?? "" }
}

async function surveyMails(issueId: string) {
  const { rows } = await su.query<{
    id: string
    user_id: string
    status: string
    error: string | null
  }>(
    `SELECT id, user_id, status, error FROM notifications
     WHERE issue_id = $1 AND template = 'claim_survey' ORDER BY user_id`,
    [issueId],
  )
  return rows
}

async function startAfter(notificationId: string) {
  const { rows } = await su.query<{ start_after: Date }>(
    `SELECT start_after FROM pgboss.job
     WHERE name = 'email-send' AND data->>'notificationId' = $1`,
    [notificationId],
  )
  return rows.map((row) => row.start_after)
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "sva")
  reporterOne = await insertUser(su, "pelapor.satu@kampus.id")
  reporterTwo = await insertUser(su, "pelapor.dua@kampus.id")
  for (const userId of [reporterOne, reporterTwo]) {
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'reporter')",
      [orgA, userId],
    )
  }
})

beforeEach(async () => {
  sent = []
  await su.query("DELETE FROM email_log")
})

afterAll(async () => {
  await resetData(su)
  await su.query("DELETE FROM email_log")
  await su.query(
    "DELETE FROM pgboss.job WHERE name IN ('email-send', 'survey-send')",
  )
  await su.end()
})

describe("survey-send", () => {
  test("each reporter gets one survey and one mail", async () => {
    const { issueId, code, claimId } = await issueWithClaim()
    const send = createSurveySendHandler({ now: () => NOW, enabled: true })
    expect(await send({ orgId: orgA, claimId })).toEqual({ surveys: 2 })

    const { rows: surveys } = await su.query(
      "SELECT user_id, answer FROM fix_surveys WHERE claim_id = $1 ORDER BY user_id",
      [claimId],
    )
    expect(surveys).toHaveLength(2)
    const { rows: audit } = await su.query(
      "SELECT action, actor_id, entity_id FROM audit_log WHERE action = 'claim.survey_send' AND entity_id = $1",
      [issueId],
    )
    expect(audit).toEqual([
      { action: "claim.survey_send", actor_id: null, entity_id: issueId },
    ])
    const mails = await surveyMails(issueId)
    expect(mails.map((row) => row.user_id).sort()).toEqual(
      [reporterOne, reporterTwo].sort(),
    )

    // Rerun and retry add nothing
    expect(await send({ orgId: orgA, claimId })).toEqual({ skipped: "sent" })
    expect(await surveyMails(issueId)).toHaveLength(2)

    const deliver = createEmailSendHandler(mailDeps())
    const first = mails[0]
    if (!first) throw new Error("no survey mail")
    expect(await deliver({ orgId: orgA, notificationId: first.id })).toBe(
      "sent",
    )
    const mail = sent[0]
    expect(mail?.subject).toContain(code)
    const { rows: claim } = await su.query<{ claimed_at: Date }>(
      "SELECT claimed_at FROM resolution_claims WHERE id = $1",
      [claimId],
    )
    const claimedAt = claim[0]?.claimed_at ?? new Date(0)
    expect(mail?.text).toContain(
      `diklaim selesai pada ${formatDate(claimedAt)}`,
    )
    const link = mail?.text.match(/\/survei\?t=(\S+)/)?.[1] ?? ""
    expect(
      verifyLink(keyring, link, { purpose: "survei", orgId: orgA, now: NOW }),
    ).toEqual({ subjectId: claimId, userId: first.user_id })
  })

  test("before 07:00 WIB the mail waits", async () => {
    const { issueId, claimId } = await issueWithClaim({
      reporters: [reporterOne],
    })
    await createSurveySendHandler({ now: () => EARLY, enabled: true })({
      orgId: orgA,
      claimId,
    })
    const [mail] = await surveyMails(issueId)
    expect(await startAfter(mail?.id ?? "")).toEqual([
      new Date("2026-11-11T00:00:00Z"),
    ])
  })

  test("switched off, the survey waits a day", async () => {
    const { issueId, claimId } = await issueWithClaim()
    expect(
      await createSurveySendHandler({ now: () => NOW, enabled: false })({
        orgId: orgA,
        claimId,
      }),
    ).toEqual({ skipped: "disabled" })
    expect(await surveyMails(issueId)).toHaveLength(0)
    const { rows } = await su.query<{ sent: Date | null }>(
      "SELECT survey_sent_at AS sent FROM resolution_claims WHERE id = $1",
      [claimId],
    )
    expect(rows[0]?.sent).toBeNull()
    const jobs = await su.query<{ start_after: Date }>(
      `SELECT start_after FROM pgboss.job
       WHERE name = 'survey-send' AND data->>'claimId' = $1`,
      [claimId],
    )
    // 07:00 WIB next day
    expect(jobs.rows.map((row) => row.start_after)).toEqual([
      new Date("2026-11-12T00:00:00Z"),
    ])
  })

  test("SURVEY_ENABLED is true or false", () => {
    expect(surveyEnabled({})).toBe(false)
    expect(surveyEnabled({ SURVEY_ENABLED: "" })).toBe(false)
    expect(surveyEnabled({ SURVEY_ENABLED: "false" })).toBe(false)
    expect(surveyEnabled({ SURVEY_ENABLED: "true" })).toBe(true)
    expect(() => surveyEnabled({ SURVEY_ENABLED: "yes" })).toThrow(
      "SURVEY_ENABLED must be true or false",
    )
  })

  test("only reporters email can reach are surveyed", async () => {
    const unverified = await insertUser(su, "belum.verifikasi@kampus.id")
    await su.query("UPDATE users SET email_verified = false WHERE id = $1", [
      unverified,
    ])
    const released = await insertUser(su, "dilepas.sementara@kampus.id")
    await su.query("UPDATE users SET email = $2 WHERE id = $1", [
      released,
      `${released}@dilepas.invalid`,
    ])
    // Left the campus, still reporter
    const departed = await insertUser(su, "keluar.kampus@kampus.id")
    for (const userId of [unverified, released]) {
      await su.query(
        "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'reporter')",
        [orgA, userId],
      )
    }
    const { issueId, claimId } = await issueWithClaim({
      reporters: [reporterOne, unverified, released, departed],
    })
    const send = createSurveySendHandler({ now: () => NOW, enabled: true })
    expect(await send({ orgId: orgA, claimId })).toEqual({ surveys: 1 })
    const { rows } = await su.query(
      "SELECT user_id FROM fix_surveys WHERE claim_id = $1",
      [claimId],
    )
    expect(rows).toEqual([{ user_id: reporterOne }])
    expect((await surveyMails(issueId)).map((row) => row.user_id)).toEqual([
      reporterOne,
    ])

    // Nobody reachable, round still sent
    const lone = await issueWithClaim({ reporters: [unverified] })
    expect(await send({ orgId: orgA, claimId: lone.claimId })).toEqual({
      surveys: 0,
    })
    const sent = await su.query(
      "SELECT survey_sent_at IS NOT NULL AS sent FROM resolution_claims WHERE id = $1",
      [lone.claimId],
    )
    expect(sent.rows).toEqual([{ sent: true }])
    const trail = await su.query(
      "SELECT action, reason_code FROM audit_log WHERE entity_id = $1",
      [lone.issueId],
    )
    expect(trail.rows).toEqual([
      { action: "claim.survey_send", reason_code: "no_recipient" },
    ])
  })

  test("a closed claim sends nothing", async () => {
    const { issueId, claimId } = await issueWithClaim()
    await su.query(
      "UPDATE resolution_claims SET closed_at = now(), outcome = 'reopened', basis = 'admin' WHERE id = $1",
      [claimId],
    )
    expect(
      await createSurveySendHandler({ now: () => NOW, enabled: true })({
        orgId: orgA,
        claimId,
      }),
    ).toEqual({ skipped: "closed" })
    expect(await surveyMails(issueId)).toHaveLength(0)
  })

  test("a hidden issue's survey waits for republish", async () => {
    const { issueId, claimId } = await issueWithClaim({ published: false })
    const send = createSurveySendHandler({ now: () => NOW, enabled: true })
    expect(await send({ orgId: orgA, claimId })).toEqual({ skipped: "hidden" })
    expect(await surveyMails(issueId)).toHaveLength(0)
    const jobs = await su.query<{ start_after: Date }>(
      `SELECT start_after FROM pgboss.job
       WHERE name = 'survey-send' AND data->>'claimId' = $1`,
      [claimId],
    )
    expect(jobs.rows.map((row) => row.start_after)).toEqual([
      new Date("2026-11-12T00:00:00Z"),
    ])
    await su.query("UPDATE issues SET published_at = $2 WHERE id = $1", [
      issueId,
      NOW,
    ])
    expect(await send({ orgId: orgA, claimId })).toEqual({ surveys: 2 })
  })

  test("a taken down issue drops the survey", async () => {
    const { issueId, claimId } = await issueWithClaim({ published: false })
    await su.query(
      "UPDATE issues SET taken_down_at = now(), takedown_reason = $2 WHERE id = $1",
      [issueId, TAKEDOWN_REASONS[0]],
    )
    expect(
      await createSurveySendHandler({ now: () => NOW, enabled: true })({
        orgId: orgA,
        claimId,
      }),
    ).toEqual({ skipped: "taken_down" })
    const jobs = await su.query(
      "SELECT 1 FROM pgboss.job WHERE name = 'survey-send' AND data->>'claimId' = $1",
      [claimId],
    )
    expect(jobs.rows).toHaveLength(0)
  })

  test("the mail is skipped once answered or closed", async () => {
    const { issueId, claimId } = await issueWithClaim()
    await createSurveySendHandler({ now: () => NOW, enabled: true })({
      orgId: orgA,
      claimId,
    })
    await su.query(
      "UPDATE fix_surveys SET answer = 'fixed', answered_at = now() WHERE claim_id = $1 AND user_id = $2",
      [claimId, reporterOne],
    )
    const deliver = createEmailSendHandler(mailDeps())
    const mails = await surveyMails(issueId)
    const one = mails.find((row) => row.user_id === reporterOne)
    const two = mails.find((row) => row.user_id === reporterTwo)
    expect(await deliver({ orgId: orgA, notificationId: one?.id ?? "" })).toBe(
      "skipped",
    )
    await su.query(
      "UPDATE resolution_claims SET closed_at = now(), outcome = 'reopened', basis = 'survey' WHERE id = $1",
      [claimId],
    )
    expect(await deliver({ orgId: orgA, notificationId: two?.id ?? "" })).toBe(
      "skipped",
    )
    const errors = (await surveyMails(issueId)).map((row) => row.error).sort()
    expect(errors).toEqual(["answered", "claim_closed"])
    expect(sent).toHaveLength(0)
  })

  test("a late mail never links a newer round", async () => {
    const { issueId, claimId } = await issueWithClaim({
      reporters: [reporterOne],
    })
    await createSurveySendHandler({ now: () => NOW, enabled: true })({
      orgId: orgA,
      claimId,
    })
    // Reopened, then claimed again
    await su.query(
      "UPDATE resolution_claims SET closed_at = now(), outcome = 'reopened', basis = 'admin' WHERE id = $1",
      [claimId],
    )
    await su.query(
      "INSERT INTO resolution_claims (org_id, issue_id) VALUES ($1, $2)",
      [orgA, issueId],
    )
    const [mail] = await surveyMails(issueId)
    const deliver = createEmailSendHandler(mailDeps())
    expect(await deliver({ orgId: orgA, notificationId: mail?.id ?? "" })).toBe(
      "skipped",
    )
    expect((await surveyMails(issueId))[0]?.error).toBe("claim_closed")
    expect(sent).toHaveLength(0)
  })
})

describe("reply mail", () => {
  async function replyMail(status: "pending" | "rejected") {
    const { issueId, code } = await issueWithClaim({ reporters: [] })
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO agency_replies (org_id, issue_id, user_id, submission_id,
         agency, sender_role, body, status, reject_reason, decided_at)
       VALUES ($1, $2, $3, gen_random_uuid(), 'Dinas Bina Marga',
         'Kepala Bidang', 'Isi hak jawab yang cukup panjang.', $4, $5, $6)
       RETURNING id`,
      [
        orgA,
        issueId,
        reporterOne,
        status,
        status === "rejected" ? "off_topic" : null,
        status === "rejected" ? NOW : null,
      ],
    )
    const replyId = rows[0]?.id ?? ""
    const notification = await su.query<{ id: string }>(
      `INSERT INTO notifications (org_id, user_id, event_id, template, reply_id)
       VALUES ($1, $2, gen_random_uuid(), $3, $4) RETURNING id`,
      [
        orgA,
        reporterOne,
        status === "pending" ? "reply_received" : "reply_decided",
        replyId,
      ],
    )
    return { code, notificationId: notification.rows[0]?.id ?? "" }
  }

  test("receipt and decision reach the sender", async () => {
    const deliver = createEmailSendHandler(mailDeps())
    const receipt = await replyMail("pending")
    expect(
      await deliver({ orgId: orgA, notificationId: receipt.notificationId }),
    ).toBe("sent")
    const rejected = await replyMail("rejected")
    expect(
      await deliver({ orgId: orgA, notificationId: rejected.notificationId }),
    ).toBe("sent")
    expect(sent.map((mail) => mail.subject)).toEqual([
      `Hak jawab untuk isu ${receipt.code} sudah kami terima`,
      `Hak jawab untuk isu ${rejected.code} tidak diterbitkan`,
    ])
    expect(sent[1]?.text).toContain("tidak menanggapi isu ini")
  })
})
