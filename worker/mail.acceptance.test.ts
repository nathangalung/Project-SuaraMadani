import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import {
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  mailbox,
  queued,
  runQueued,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../e2e/app-harness.ts"
import {
  issueAction,
  publishIssue,
  referFields,
  reportToIssue,
  review,
  submitReport,
} from "../e2e/staff-flows.ts"
import { createEmailSender } from "../server/email.ts"
import { hashKey } from "../server/email-log.ts"
import { originFor } from "../server/origin.server.ts"
import { linkKeyring } from "../server/signed-link.ts"
import { jakartaIsoDate } from "../shared/format.ts"
import {
  EMAIL_QUOTA,
  jakartaDayStart,
  nextSendMorning,
} from "../shared/notifications.ts"
import { createDeadlineReminderHandler } from "./deadline-reminders.ts"
import { createEmailSendHandler } from "./email-send.ts"

const HOST = "accmail.localhost"
const su = superuserPool()
let app: FullApp
let orgId = ""
let admin: Staff
let adminEmail = ""
let restore = () => {}
let seq = 0

function person(label: string, domain = "contoh.id") {
  seq += 1
  return {
    email: `${label}.${seq}@${domain}`,
    phone: `+62813444${String(seq).padStart(5, "0")}`,
    name: "Warga Surat",
  }
}

async function notification(reportCode: string) {
  const { rows } = await su.query<{
    status: string
    error: string | null
  }>(
    `SELECT n.status, n.error FROM notifications n
     JOIN reports r ON r.id = n.report_id
     WHERE r.public_code = $1 ORDER BY n.created_at DESC LIMIT 1`,
    [reportCode],
  )
  return rows[0]
}

// Midnight splits "today", wait past
async function clearOfMidnight() {
  const left = jakartaDayStart(new Date()).getTime() + 86_400_000 - Date.now()
  if (left < 120_000) await Bun.sleep(left + 5_000)
}

async function sentLog(count: number, status: "sent" | "failed") {
  await su.query(
    `INSERT INTO email_log (kind, address_hash, status, created_at)
     SELECT 'notification', 'acc' || gen_random_uuid(), $2, now()
     FROM generate_series(1, $1)`,
    [count, status],
  )
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "accmail")
  hostsChanged([HOST])
  await su.query("DELETE FROM email_log")
  restore = stubTurnstile()
  app = await fullApp()
  const first = person("admin")
  adminEmail = first.email
  admin = await staffSession(HOST, orgId, first)
})

afterAll(async () => {
  await dropJobs(su, [HOST])
  // Later files rebuild auth
  hostsChanged([HOST])
  restore()
  await su.query("DELETE FROM email_log")
  await resetData(su)
  await su.end()
})

describe("notification mail", () => {
  test("[AC-MAIL-01] Given 200 notifications already sent today, when another status mail is due, then it waits for 07:00 WIB the next day, and failed sends never count toward the ceiling", async () => {
    await clearOfMidnight()
    await mailbox().deliver(su, orgId)
    await su.query("DELETE FROM email_log")
    const reporter = await signedIn(HOST, person("plafon"))
    await sentLog(EMAIL_QUOTA.notificationCeiling - 1, "sent")
    await sentLog(5, "failed")
    const { code } = await submitReport(app, HOST, reporter.cookie)
    const box = mailbox()
    await box.deliver(su, orgId)
    expect(box.sent.filter((m) => m.text.includes(code))).toHaveLength(1)
    expect((await notification(code))?.status).toBe("sent")
    const before = new Date()
    await review(app, su, HOST, admin.cookie, code, { intent: "start_review" })
    const full = mailbox()
    await full.deliver(su, orgId)
    expect(full.sent.filter((m) => m.text.includes(code))).toEqual([])
    expect((await notification(code))?.status).toBe("pending")
    const waiting = await queued<{ orgId: string; notificationId: string }>(
      su,
      "email-send",
      orgId,
    )
    expect(waiting).toHaveLength(1)
    expect(waiting[0]?.startAfter.getTime()).toBe(
      nextSendMorning(before).getTime(),
    )
    await su.query("DELETE FROM email_log")
  }, 180_000)

  test("[AC-MAIL-02] Given recipients email must not reach, when their mail is due, then it is skipped with a reason: an unproven address, a reserved domain, and an account no longer a member", async () => {
    await su.query("DELETE FROM email_log")
    const unproven = await signedIn(HOST, person("belumbukti"))
    await su.query("UPDATE users SET email_verified = false WHERE id = $1", [
      unproven.userId,
    ])
    const reserved = await signedIn(HOST, person("cadangan", "contoh.test"))
    const leaver = await signedIn(HOST, person("keluar"))
    const codes = {
      unproven: (await submitReport(app, HOST, unproven.cookie)).code,
      reserved: (await submitReport(app, HOST, reserved.cookie)).code,
      leaver: (await submitReport(app, HOST, leaver.cookie)).code,
    }
    await su.query(
      "DELETE FROM members WHERE user_id = $1 AND organization_id = $2",
      [leaver.userId, orgId],
    )
    const box = mailbox()
    await box.deliver(su, orgId)
    for (const code of Object.values(codes)) {
      expect(box.sent.filter((m) => m.text.includes(code))).toEqual([])
    }
    expect(await notification(codes.unproven)).toEqual({
      status: "skipped",
      error: "unverified",
    })
    expect(await notification(codes.reserved)).toEqual({
      status: "skipped",
      error: "undeliverable",
    })
    expect(await notification(codes.leaver)).toEqual({
      status: "skipped",
      error: "closed",
    })
  })

  test("[AC-MAIL-03] Given a referral past its deadline without a response, when the 07:00 deadline job runs, then each of two admins gets one digest that day listing it, a rerun adds nothing, and a run before 07:00 waits for 07:00", async () => {
    await clearOfMidnight()
    await su.query("DELETE FROM email_log")
    const second = person("admin")
    await staffSession(HOST, orgId, second)
    const admins = [second.email, adminEmail].sort()
    const reporter = await signedIn(HOST, person("tenggat"))
    const { code: report } = await submitReport(app, HOST, reporter.cookie)
    const issue = await reportToIssue(app, su, HOST, admin.cookie, report)
    await publishIssue(app, su, HOST, admin.cookie, issue)
    const day = (offset: number) =>
      jakartaIsoDate(new Date(Date.now() + offset * 86_400_000))
    await issueAction(
      app,
      su,
      HOST,
      admin.cookie,
      issue,
      referFields(day(-20), day(-6)),
    )
    await mailbox().deliver(su, orgId)
    const morning = new Date(
      jakartaDayStart(new Date()).getTime() + 7.5 * 3_600_000,
    )
    const run = createDeadlineReminderHandler({ now: () => morning })
    await run({})
    const box = mailbox(() => morning)
    await box.deliver(su, orgId)
    const digests = box.sent.filter((m) =>
      m.subject.startsWith("Pengingat tenggat"),
    )
    expect(digests.map((m) => m.to).sort()).toEqual(admins)
    for (const digest of digests) {
      expect(digest.text).toContain(issue)
      expect(digest.text).toContain("/kelola/isu?perlu=lewat-tenggat")
    }
    await run({})
    expect(
      await queued<{ orgId: string }>(su, "email-send", orgId),
    ).toHaveLength(0)
    const early = new Date(morning.getTime() + 86_400_000 - 2.5 * 3_600_000)
    await createDeadlineReminderHandler({ now: () => early })({})
    const waiting = await queued<{ orgId: string }>(su, "email-send", orgId)
    expect(waiting.map((job) => job.startAfter.getTime())).toEqual(
      admins.map(() => jakartaDayStart(early).getTime() + 7 * 3_600_000),
    )
    await su.query(
      "UPDATE pgboss.job SET state = 'completed' WHERE id = ANY($1::uuid[])",
      [waiting.map((job) => job.id)],
    )
  }, 180_000)

  test("[AC-MAIL-04] Given Amazon SES as provider, when a mail is sent, then the request is SigV4-signed UTF-8 JSON, throttling defers the job by Retry-After and a rejected message fails the notification", async () => {
    await su.query("DELETE FROM email_log")
    const seen: Request[] = []
    let answer = (): Response =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    const real = globalThis.fetch
    const fake = async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const request = new Request(input, init)
      if (
        !request.url.startsWith("https://email.ap-southeast-3.amazonaws.com/")
      ) {
        return real(input, init)
      }
      seen.push(request.clone())
      return answer()
    }
    globalThis.fetch = Object.assign(fake, { preconnect: real.preconnect })
    try {
      const ses = createEmailSender({
        EMAIL_PROVIDER: "ses",
        EMAIL_FROM: "Sadar Bersuara <no-reply@contoh.id>",
        SES_REGION: "ap-southeast-3",
        SES_ACCESS_KEY_ID: "AKIDEXAMPLE",
        SES_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      })
      const handler = createEmailSendHandler({
        email: ses,
        keyring: linkKeyring,
        hashKey,
        now: () => new Date(),
        originFor,
      })
      const reporter = await signedIn(HOST, person("ses"))
      const first = await submitReport(app, HOST, reporter.cookie)
      expect(await runQueued(su, "email-send", orgId, handler)).toContain(
        "sent",
      )
      const request = seen.at(-1)
      expect(request?.headers.get("authorization")).toStartWith(
        "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/",
      )
      const body = (await request?.json()) as {
        Content: { Simple: { Subject: { Charset: string } } }
      }
      expect(body.Content.Simple.Subject.Charset).toBe("UTF-8")
      expect((await notification(first.code))?.status).toBe("sent")

      answer = () =>
        new Response(JSON.stringify({ message: "rate" }), {
          status: 400,
          headers: {
            "x-amzn-errortype": "ThrottlingException",
            "retry-after": "120",
          },
        })
      const before = Date.now()
      const second = await submitReport(app, HOST, reporter.cookie)
      expect(await runQueued(su, "email-send", orgId, handler)).toEqual([
        "deferred",
      ])
      expect((await notification(second.code))?.status).toBe("pending")
      const retry = await queued<{ orgId: string }>(su, "email-send", orgId)
      const wait = (retry[0]?.startAfter.getTime() ?? 0) - before
      expect(wait).toBeGreaterThanOrEqual(119_000)
      expect(wait).toBeLessThan(125_000)
      await su.query(
        "UPDATE pgboss.job SET state = 'completed' WHERE id = $1",
        [retry[0]?.id],
      )

      answer = () =>
        new Response(JSON.stringify({ message: "no" }), {
          status: 400,
          headers: { "x-amzn-errortype": "MessageRejected" },
        })
      const third = await submitReport(app, HOST, reporter.cookie)
      expect(await runQueued(su, "email-send", orgId, handler)).toEqual([
        "failed",
      ])
      expect(await notification(third.code)).toEqual({
        status: "failed",
        error: "http_400",
      })
    } finally {
      globalThis.fetch = real
    }
  })
})
