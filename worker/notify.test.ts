import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { schema } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import { reports } from "../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import { type EmailMessage, EmailSendError } from "../server/email.ts"
import {
  parseHashKey,
  reserveInvitation,
  reserveOtp,
} from "../server/email-log.ts"
import { parseKeyring, verifyLink } from "../server/signed-link.ts"
import {
  EMAIL_QUOTA,
  jakartaDayStart,
  nextSendMorning,
} from "../shared/notifications.ts"
import { createEmailSendHandler, type EmailSendDeps } from "./email-send.ts"
import {
  createDemandNotifyHandler,
  createIssueNotifyHandler,
} from "./issue-notify.ts"

const su = superuserPool()
const suDb = drizzle({ client: su, schema })
const keyring = parseKeyring(`1:${Buffer.alloc(32, 3).toString("base64")}`)
const key = parseHashKey(Buffer.alloc(32, 4).toString("base64"))
// Mid-morning WIB, fixed
const NOW = new Date("2026-10-14T03:00:00Z")

let orgA = ""
let orgB = ""
let reporter = ""
let issueId = ""
let sent: EmailMessage[] = []

function deps(overrides: Partial<EmailSendDeps> = {}): EmailSendDeps {
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
    ...overrides,
  }
}

async function member(orgId: string, userId: string) {
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'reporter') ON CONFLICT DO NOTHING",
    [orgId, userId],
  )
}

async function addReport(userId = reporter, orgId = orgA): Promise<string> {
  const [row] = await suDb
    .insert(reports)
    .values(reportValues(orgId, userId))
    .returning({ id: reports.id })
  if (!row) throw new Error("no report")
  return row.id
}

async function notification(
  template: string,
  subject: { reportId?: string; issueId?: string },
  userId = reporter,
  orgId = orgA,
): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO notifications (org_id, user_id, event_id, template, report_id, issue_id)
     VALUES ($1, $2, uuidv7(), $3, $4, $5) RETURNING id`,
    [
      orgId,
      userId,
      template,
      subject.reportId ?? null,
      subject.issueId ?? null,
    ],
  )
  const id = rows[0]?.id
  if (!id) throw new Error("no notification")
  return id
}

async function status(id: string) {
  const { rows } = await su.query<{ status: string; error: string | null }>(
    "SELECT status, error FROM notifications WHERE id = $1",
    [id],
  )
  return rows[0]
}

async function logRows(kind: string, count: number, at = NOW) {
  await su.query(
    `INSERT INTO email_log (kind, address_hash, status, created_at)
     SELECT $1, 'h' || g, 'sent', $2 FROM generate_series(1, $3) g`,
    [kind, at, count],
  )
}

async function signUpRows(
  count: number,
  at: Date,
  client: string | null = null,
) {
  await su.query(
    `INSERT INTO email_log (kind, address_hash, status, purpose, client_hash, created_at)
     SELECT 'otp', 'su' || g, 'sent', 'sign_up', $3, $1 FROM generate_series(1, $2) g`,
    [at, count, client],
  )
}

async function deferredJob(notificationId: string) {
  const { rows } = await su.query<{ start_after: Date }>(
    `SELECT start_after FROM pgboss.job
     WHERE name = 'email-send' AND data->>'notificationId' = $1
     ORDER BY created_on DESC LIMIT 1`,
    [notificationId],
  )
  return rows[0]
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "nta")
  orgB = await insertOrg(su, "ntb")
  reporter = await insertUser(su, "pelapor@contoh.id")
  await member(orgA, reporter)
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
       category_id, subcategory_id, province_code, regency_code,
       gov_status, advocacy_status, report_count, published_at)
     VALUES ($1, 2026, 1, 'ISU-2026-10-0001', 'Atap sekolah runtuh',
       'Ringkasan isu.', 'program', 'program.pendidikan', '32', '32.73',
       'in_progress', 'referred', 1, now()) RETURNING id`,
    [orgA],
  )
  issueId = rows[0]?.id ?? ""
})

beforeEach(async () => {
  sent = []
  await su.query("DELETE FROM email_log")
  await su.query("DELETE FROM pgboss.job WHERE name = 'email-send'")
})

afterAll(async () => {
  await resetData(su)
  await su.query("DELETE FROM email_log")
  await su.end()
})

describe("email-send", () => {
  test("the receipt goes out with a signed /lacak link", async () => {
    const reportId = await addReport()
    const id = await notification("report_submitted", { reportId })
    const outcome = await createEmailSendHandler(deps())({
      orgId: orgA,
      notificationId: id,
    })
    expect(outcome).toBe("sent")
    expect(sent).toHaveLength(1)
    const [message] = sent
    expect(message?.to).toBe("pelapor@contoh.id")
    expect(message?.idempotencyKey).toBe(id)
    expect(message?.subject).toContain("sudah kami terima")
    const token = /lacak\?t=([\w.-]+)/.exec(message?.text ?? "")?.[1] ?? ""
    expect(
      verifyLink(keyring, token, { purpose: "lacak", orgId: orgA, now: NOW }),
    ).toEqual({ subjectId: reportId, userId: reporter })
    // Expires after 30 days
    const late = new Date(NOW.getTime() + 30 * 86_400_000)
    expect(
      verifyLink(keyring, token, { purpose: "lacak", orgId: orgA, now: late }),
    ).toBe(null)
    expect(await status(id)).toEqual({ status: "sent", error: null })
    const { rows } = await su.query(
      "SELECT kind, status, address_hash FROM email_log",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: "notification", status: "sent" })
    expect(rows[0]?.address_hash).not.toContain("pelapor")
  })

  test("a rejection email carries the stored reason", async () => {
    const reportId = await addReport()
    await su.query(
      `INSERT INTO moderation_decisions (org_id, report_id, action, reason_code, reason_text)
       VALUES ($1, $2, 'reject', 'standard_11', 'Hapus nomor telepon tetangga, lalu kirim ulang.')`,
      [orgA, reportId],
    )
    const id = await notification("report_rejected", { reportId })
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("sent")
    const text = sent[0]?.text ?? ""
    expect(text).toContain("Standar 11")
    expect(text).toContain("Hapus nomor telepon tetangga, lalu kirim ulang.")
    expect(text).toContain("/pedoman#standar-11")
  })

  test("a complaint decision mails reason and appeal date", async () => {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO content_complaints (org_id, issue_id, public_code, user_id,
         submission_id, reason, part, explanation, status, decision,
         decision_reason, decision_text, decided_by, decided_at)
       VALUES ($1, $2, 'ADU-NTA-26-7K3QX', $3, gen_random_uuid(),
         'personal_data', 'title_summary', 'Ringkasan menyebut alamat warga.',
         'decided', 'edit', 'standard_11',
         'Alamat warga kami hapus dari ringkasan.', $3, $4)
       RETURNING id`,
      [orgA, issueId, reporter, NOW],
    )
    const complaintId = rows[0]?.id ?? ""
    const { rows: notes } = await su.query<{ id: string }>(
      `INSERT INTO notifications (org_id, user_id, event_id, template, complaint_id)
       VALUES ($1, $2, uuidv7(), 'complaint_decided', $3) RETURNING id`,
      [orgA, reporter, complaintId],
    )
    const id = notes[0]?.id ?? ""
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("sent")
    const text = sent[0]?.text ?? ""
    expect(sent[0]?.subject).toContain("ADU-NTA-26-7K3QX")
    expect(text).toContain("Standar 11")
    expect(text).toContain("Alamat warga kami hapus dari ringkasan.")
    expect(text).toContain("https://nta.localhost/aduan/ADU-NTA-26-7K3QX")
    // 180 days after decision
    expect(text).toContain("12 April 2027")
    await su.query("DELETE FROM content_complaints WHERE id = $1", [
      complaintId,
    ])
  })

  test("a sent notification is never sent twice", async () => {
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    const run = createEmailSendHandler(deps())
    expect(await run({ orgId: orgA, notificationId: id })).toBe("sent")
    expect(await run({ orgId: orgA, notificationId: id })).toBe("done")
    expect(sent).toHaveLength(1)
  })

  test("a missing or foreign notification is skipped", async () => {
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    const run = createEmailSendHandler(deps())
    expect(await run({ orgId: orgB, notificationId: id })).toBe("skipped")
    expect(await status(id)).toEqual({ status: "pending", error: null })
    expect(
      await run({ orgId: orgA, notificationId: crypto.randomUUID() }),
    ).toBe("skipped")
    expect(sent).toHaveLength(0)
  })

  test("a merged report mail leaves out a removed issue", async () => {
    const reportId = await addReport()
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary,
         category_id, subcategory_id, province_code, regency_code,
         gov_status, advocacy_status, report_count, taken_down_at, takedown_reason)
       VALUES ($1, 2026, 90, 'ISU-2026-10-0090', 'Judul yang diturunkan',
         'Ringkasan.', 'program', 'program.pendidikan', '32', '32.73',
         'awaiting_response', 'monitoring', 1, now(), 'standard_1') RETURNING id`,
      [orgA],
    )
    await su.query(
      "INSERT INTO issue_reports (org_id, issue_id, report_id) VALUES ($1, $2, $3)",
      [orgA, rows[0]?.id, reportId],
    )
    const id = await notification("report_merged", { reportId })
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("sent")
    const text = sent[0]?.text ?? ""
    expect(text).not.toContain("Judul yang diturunkan")
    expect(text).not.toContain("/isu/ISU-2026-10-0090")
    expect(text).not.toContain("setelah moderator menerbitkannya")
  })

  test("the ceiling defers to 07:00 WIB the next day", async () => {
    await logRows("notification", EMAIL_QUOTA.notificationCeiling)
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    const outcome = await createEmailSendHandler(deps())({
      orgId: orgA,
      notificationId: id,
    })
    expect(outcome).toBe("deferred")
    expect(sent).toHaveLength(0)
    expect(await status(id)).toEqual({ status: "pending", error: null })
    expect((await deferredJob(id))?.start_after).toEqual(nextSendMorning(NOW))
  })

  test("invitations share the ceiling, keeping the reserve", async () => {
    await logRows("invitation", 1)
    await logRows("notification", EMAIL_QUOTA.notificationCeiling - 1)
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("deferred")
  })

  test("OTP sends never use up the notification ceiling", async () => {
    // The OTP reserve is full
    await logRows("otp", EMAIL_QUOTA.otpReserve)
    await logRows("notification", EMAIL_QUOTA.notificationCeiling - 1)
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("sent")
  })

  test("a provider day used up by OTP defers notifications", async () => {
    await logRows("otp", EMAIL_QUOTA.providerDaily)
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("deferred")
    expect(sent).toHaveLength(0)
    expect((await deferredJob(id))?.start_after).toEqual(nextSendMorning(NOW))
  })

  test("a provider day used up refuses invitations", async () => {
    await logRows("otp", EMAIL_QUOTA.providerDaily - 1)
    await logRows("notification", 1)
    expect(await reserveInvitation(suDb, "h-invite", NOW)).toEqual({
      ok: false,
      reason: "quota",
    })
  })

  test("an unproven address gets fewer codes a day", async () => {
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)
    for (const minutes of [0, 2, 4]) {
      expect(
        (await reserveOtp(suDb, "h-new", at(minutes), { unproven: true })).ok,
      ).toBe(true)
    }
    expect(await reserveOtp(suDb, "h-new", at(6), { unproven: true })).toEqual({
      ok: false,
      reason: "daily",
    })
    // A proven address keeps eight
    expect((await reserveOtp(suDb, "h-new", at(8))).ok).toBe(true)
  })

  test("a full Daftar share keeps proven sign-ins open", async () => {
    await signUpRows(
      EMAIL_QUOTA.signUpPerDay,
      new Date(NOW.getTime() - 7_200_000),
    )
    expect(await reserveOtp(suDb, "h-spam", NOW, { unproven: true })).toEqual({
      ok: false,
      reason: "busy",
    })
    expect((await reserveOtp(suDb, "h-admin", NOW)).ok).toBe(true)
  })

  test("the Daftar share is paced per hour", async () => {
    await signUpRows(
      EMAIL_QUOTA.signUpPerHour,
      new Date(NOW.getTime() - 600_000),
    )
    expect(await reserveOtp(suDb, "h-new", NOW, { unproven: true })).toEqual({
      ok: false,
      reason: "busy",
    })
    const later = new Date(NOW.getTime() + 3_600_000)
    expect(
      (await reserveOtp(suDb, "h-new", later, { unproven: true })).ok,
    ).toBe(true)
  })

  test("one client gets few Daftar codes a day", async () => {
    const earlier = new Date(NOW.getTime() - 7_200_000)
    await signUpRows(EMAIL_QUOTA.signUpPerClientDay, earlier, "client-a")
    const from = (client: string | null) =>
      reserveOtp(suDb, `h-${client}`, NOW, { unproven: true, client })
    expect(await from("client-a")).toEqual({ ok: false, reason: "busy" })
    expect((await from("client-b")).ok).toBe(true)
    expect((await from(null)).ok).toBe(true)
  })

  test("a Daftar code records its purpose and client", async () => {
    await reserveOtp(suDb, "h-new", NOW, { unproven: true, client: "client-a" })
    await reserveOtp(suDb, "h-old", NOW, { client: "client-a" })
    const { rows } = await su.query(
      "SELECT address_hash, purpose, client_hash FROM email_log ORDER BY address_hash",
    )
    expect(rows).toEqual([
      { address_hash: "h-new", purpose: "sign_up", client_hash: "client-a" },
      { address_hash: "h-old", purpose: "sign_in", client_hash: null },
    ])
  })

  test("yesterday's sends do not count", async () => {
    const yesterday = new Date(jakartaDayStart(NOW).getTime() - 1000)
    await logRows("notification", EMAIL_QUOTA.notificationCeiling, yesterday)
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("sent")
  })

  test("concurrent sends never pass the ceiling", async () => {
    await logRows("notification", EMAIL_QUOTA.notificationCeiling - 2)
    const ids = await Promise.all(
      [1, 2, 3, 4, 5].map(async () =>
        notification("report_verified", { reportId: await addReport() }),
      ),
    )
    const run = createEmailSendHandler(deps())
    const outcomes = await Promise.all(
      ids.map((id) => run({ orgId: orgA, notificationId: id })),
    )
    expect(outcomes.filter((o) => o === "sent")).toHaveLength(2)
    expect(outcomes.filter((o) => o === "deferred")).toHaveLength(3)
  })

  test("a closed account gets no email", async () => {
    const closed = await insertUser(su, "ditutup@contoh.id")
    const reportId = await addReport(closed)
    // Membership removed on close
    const id = await notification("report_verified", { reportId }, closed)
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("skipped")
    expect(sent).toHaveLength(0)
    expect(await status(id)).toEqual({ status: "skipped", error: "closed" })
    const { rows } = await su.query("SELECT 1 FROM email_log")
    expect(rows).toHaveLength(0)
  })

  test("a deleted account gets no email", async () => {
    const gone = await insertUser(su, "hapus@contoh.id")
    await member(orgA, gone)
    const id = await notification("issue_close", { issueId }, gone)
    await su.query("DELETE FROM members WHERE user_id = $1", [gone])
    await su.query("DELETE FROM users WHERE id = $1", [gone])
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("skipped")
    expect(sent).toHaveLength(0)
  })

  test("reserved test domains are skipped", async () => {
    const sample = await insertUser(su, "sampel.nta.001@contoh.test")
    await member(orgA, sample)
    const id = await notification(
      "report_verified",
      { reportId: await addReport(sample) },
      sample,
    )
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("skipped")
    expect(await status(id)).toEqual({
      status: "skipped",
      error: "undeliverable",
    })
  })

  test("an unproven email gets no email", async () => {
    const typed = await insertUser(su, "orang.lain@contoh.id")
    await su.query("UPDATE users SET email_verified = false WHERE id = $1", [
      typed,
    ])
    await member(orgA, typed)
    const id = await notification(
      "report_submitted",
      { reportId: await addReport(typed) },
      typed,
    )
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId: id }),
    ).toBe("skipped")
    expect(sent).toHaveLength(0)
    expect(await status(id)).toEqual({ status: "skipped", error: "unverified" })
    const { rows } = await su.query("SELECT 1 FROM email_log")
    expect(rows).toHaveLength(0)
  })

  test("a permanent provider error fails the row and frees the slot", async () => {
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    const outcome = await createEmailSendHandler(
      deps({
        email: {
          send: async () => {
            throw new EmailSendError("brevo", 400, null)
          },
        },
      }),
    )({ orgId: orgA, notificationId: id })
    expect(outcome).toBe("failed")
    expect(await status(id)).toEqual({ status: "failed", error: "http_400" })
    const { rows } = await su.query("SELECT status FROM email_log")
    expect(rows).toEqual([{ status: "failed" }])
  })

  test("an account error throws so the job reaches the DLQ", async () => {
    for (const code of [401, 402, 403]) {
      const id = await notification("report_verified", {
        reportId: await addReport(),
      })
      await expect(
        createEmailSendHandler(
          deps({
            email: {
              send: async () => {
                throw new EmailSendError("brevo", code, null)
              },
            },
          }),
        )({ orgId: orgA, notificationId: id }),
      ).rejects.toThrow(String(code))
      expect(await status(id)).toEqual({ status: "pending", error: null })
    }
  })

  test("an outage throws so pg-boss retries", async () => {
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    await expect(
      createEmailSendHandler(
        deps({
          email: {
            send: async () => {
              throw new EmailSendError("brevo", 503, null)
            },
          },
        }),
      )({ orgId: orgA, notificationId: id }),
    ).rejects.toThrow("503")
    expect(await status(id)).toEqual({ status: "pending", error: null })
  })

  test("a timeout keeps one slot across every retry", async () => {
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    let clock = NOW.getTime()
    const run = createEmailSendHandler(
      deps({
        email: {
          send: async () => {
            throw new DOMException("The operation timed out.", "TimeoutError")
          },
        },
        now: () => new Date(clock),
      }),
    )
    for (let attempt = 0; attempt < 15; attempt++) {
      await expect(run({ orgId: orgA, notificationId: id })).rejects.toThrow()
      clock += 120_000
    }
    const { rows } = await su.query(
      "SELECT status, count(*)::int AS n FROM email_log GROUP BY status",
    )
    expect(rows).toEqual([{ status: "reserved", n: 1 }])
    expect(await status(id)).toEqual({ status: "pending", error: null })
  })

  test("a refused connection frees the slot", async () => {
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    const refused = Object.assign(new TypeError("Unable to connect"), {
      code: "ECONNREFUSED",
    })
    let fail = true
    const run = createEmailSendHandler(
      deps({
        email: {
          send: async (message) => {
            if (fail) throw refused
            sent.push(message)
          },
        },
      }),
    )
    await expect(run({ orgId: orgA, notificationId: id })).rejects.toThrow()
    const used = await su.query(
      "SELECT count(*)::int AS n FROM email_log WHERE status IN ('reserved', 'sent')",
    )
    expect(used.rows).toEqual([{ n: 0 }])
    fail = false
    expect(await run({ orgId: orgA, notificationId: id })).toBe("sent")
    const { rows } = await su.query(
      "SELECT status, count(*)::int AS n FROM email_log GROUP BY status ORDER BY status",
    )
    expect(rows).toEqual([
      { status: "failed", n: 1 },
      { status: "sent", n: 1 },
    ])
  })

  test("a 429 re-sends after Retry-After, capped", async () => {
    const id = await notification("report_verified", {
      reportId: await addReport(),
    })
    const limited = createEmailSendHandler(
      deps({
        email: {
          send: async () => {
            throw new EmailSendError("brevo", 429, "120")
          },
        },
      }),
    )
    expect(await limited({ orgId: orgA, notificationId: id })).toBe("deferred")
    expect((await deferredJob(id))?.start_after).toEqual(
      new Date(NOW.getTime() + 120_000),
    )
    await expect(
      limited({ orgId: orgA, notificationId: id, deferrals: 24 }),
    ).rejects.toThrow("429")
  })
})

describe("issue-notify", () => {
  async function follower(email: string): Promise<string> {
    const id = await insertUser(su, email)
    await member(orgA, id)
    await su.query(
      "INSERT INTO follows (org_id, issue_id, user_id) VALUES ($1, $2, $3)",
      [orgA, issueId, id],
    )
    return id
  }

  test("one notification per follower per update, redrive safe", async () => {
    const followers = await Promise.all(
      [1, 2, 3].map((n) => follower(`ikut${n}@contoh.id`)),
    )
    // Closed: membership gone
    const closed = await follower("ikut-tutup@contoh.id")
    await su.query("DELETE FROM members WHERE user_id = $1", [closed])
    const eventId = crypto.randomUUID()
    const event = {
      orgId: orgA,
      issueId,
      eventId,
      template: "issue_mark_in_progress" as const,
    }
    const fanOut = createIssueNotifyHandler({ batchSize: 2 })
    expect(await fanOut(event)).toBe(3)
    // Redrive inserts nothing new
    expect(await fanOut(event)).toBe(0)
    const { rows } = await su.query<{ user_id: string }>(
      "SELECT user_id FROM notifications WHERE event_id = $1",
      [eventId],
    )
    expect(rows.map((r) => r.user_id).sort()).toEqual([...followers].sort())
    const jobs = await su.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'email-send'
       AND data->>'notificationId' IN (SELECT id::text FROM notifications WHERE event_id = $1)`,
      [eventId],
    )
    expect(jobs.rows).toHaveLength(3)
  })

  test("the follower email carries a working unfollow link", async () => {
    const id = await follower("ikut-link@contoh.id")
    const notificationId = await notification("issue_close", { issueId }, id)
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId }),
    ).toBe("sent")
    const text = sent[0]?.text ?? ""
    expect(text).toContain("https://nta.localhost/isu/ISU-2026-10-0001")
    const token = /berhenti\?t=([\w.-]+)/.exec(text)?.[1] ?? ""
    expect(
      verifyLink(keyring, token, {
        purpose: "berhenti",
        orgId: orgA,
        now: NOW,
      }),
    ).toEqual({ subjectId: issueId, userId: id })
  })

  test("a hidden issue sends followers nothing", async () => {
    const id = await follower("ikut-sembunyi@contoh.id")
    const notificationId = await notification("issue_close", { issueId }, id)
    await su.query("UPDATE issues SET published_at = NULL WHERE id = $1", [
      issueId,
    ])
    try {
      expect(
        await createEmailSendHandler(deps())({ orgId: orgA, notificationId }),
      ).toBe("skipped")
      expect(await status(notificationId)).toEqual({
        status: "skipped",
        error: "unpublished",
      })
      expect(sent).toHaveLength(0)
    } finally {
      await su.query("UPDATE issues SET published_at = now() WHERE id = $1", [
        issueId,
      ])
    }
  })

  test("an unfollowed issue sends nothing", async () => {
    const id = await follower("ikut-lepas@contoh.id")
    const notificationId = await notification("issue_close", { issueId }, id)
    await su.query("DELETE FROM follows WHERE user_id = $1", [id])
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId }),
    ).toBe("skipped")
  })

  test("a wrong orgId throws", async () => {
    await expect(
      createIssueNotifyHandler()({
        orgId: orgB,
        issueId,
        eventId: crypto.randomUUID(),
        template: "issue_close",
      }),
    ).rejects.toThrow("not found")
  })
})

describe("demand-notify", () => {
  let demandId = ""

  beforeAll(async () => {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO demands (org_id, year, number, public_code, scope, title,
         body, summary, target, raised_on, state, published_at)
       VALUES ($1, 2026, 1, 'TUN-NTA-26-0001', 'national',
         'Data bantuan dibuka', 'Teks tuntutan apa adanya.',
         'Ringkasan tuntutan.', 'Kementerian Sosial', '2026-09-01',
         'published', now()) RETURNING id`,
      [orgA],
    )
    demandId = rows[0]?.id ?? ""
    await su.query(
      `INSERT INTO demand_items (org_id, demand_id, position, body,
         response_status, fulfilment_status)
       VALUES ($1, $2, 0, 'Daftar penerima dibuka', 'responded', 'fulfilled'),
              ($1, $2, 1, 'Jadwal penyaluran dibuka', 'not_responded', 'not_fulfilled')`,
      [orgA, demandId],
    )
  })

  async function demandFollower(email: string): Promise<string> {
    const id = await insertUser(su, email)
    await member(orgA, id)
    await su.query(
      "INSERT INTO demand_follows (org_id, demand_id, user_id) VALUES ($1, $2, $3)",
      [orgA, demandId, id],
    )
    return id
  }

  async function demandNotification(userId: string): Promise<string> {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO notifications (org_id, user_id, event_id, template, demand_id)
       VALUES ($1, $2, uuidv7(), 'demand_update', $3) RETURNING id`,
      [orgA, userId, demandId],
    )
    return rows[0]?.id ?? ""
  }

  test("one notification per demand follower, redrive safe", async () => {
    const followers = await Promise.all(
      [1, 2].map((n) => demandFollower(`tuntut${n}@contoh.id`)),
    )
    const event = {
      orgId: orgA,
      demandId,
      eventId: crypto.randomUUID(),
      template: "demand_update" as const,
    }
    const fanOut = createDemandNotifyHandler({ batchSize: 1 })
    expect(await fanOut(event)).toBe(2)
    expect(await fanOut(event)).toBe(0)
    const { rows } = await su.query<{ user_id: string }>(
      "SELECT user_id FROM notifications WHERE event_id = $1 AND demand_id = $2",
      [event.eventId, demandId],
    )
    expect(rows.map((r) => r.user_id).sort()).toEqual([...followers].sort())
  })

  test("the email names progress and a demand unfollow link", async () => {
    const id = await demandFollower("tuntut-link@contoh.id")
    const notificationId = await demandNotification(id)
    expect(
      await createEmailSendHandler(deps())({ orgId: orgA, notificationId }),
    ).toBe("sent")
    const text = sent[0]?.text ?? ""
    expect(sent[0]?.subject).toContain("TUN-NTA-26-0001")
    expect(text).toContain("https://nta.localhost/tuntutan/TUN-NTA-26-0001")
    expect(text).toContain("1 dari 2 subtuntutan dipenuhi")
    expect(text).toContain("Berhenti mengikuti tuntutan ini:")
    expect(text).not.toContain("isu ini")
    const token = /berhenti\?t=([\w.-]+)/.exec(text)?.[1] ?? ""
    expect(
      verifyLink(keyring, token, {
        purpose: "berhenti-tuntutan",
        orgId: orgA,
        now: NOW,
      }),
    ).toEqual({ subjectId: demandId, userId: id })
  })

  test("a draft or unfollowed demand sends nothing", async () => {
    const id = await demandFollower("tuntut-draf@contoh.id")
    const notificationId = await demandNotification(id)
    await su.query("UPDATE demands SET state = 'draft' WHERE id = $1", [
      demandId,
    ])
    try {
      expect(
        await createEmailSendHandler(deps())({ orgId: orgA, notificationId }),
      ).toBe("skipped")
      expect(await status(notificationId)).toEqual({
        status: "skipped",
        error: "unpublished",
      })
    } finally {
      await su.query("UPDATE demands SET state = 'published' WHERE id = $1", [
        demandId,
      ])
    }
    const other = await demandFollower("tuntut-lepas@contoh.id")
    const second = await demandNotification(other)
    await su.query("DELETE FROM demand_follows WHERE user_id = $1", [other])
    expect(
      await createEmailSendHandler(deps())({
        orgId: orgA,
        notificationId: second,
      }),
    ).toBe("skipped")
  })

  test("a draft demand fans out to nobody", async () => {
    await su.query("UPDATE demands SET state = 'draft' WHERE id = $1", [
      demandId,
    ])
    try {
      expect(
        await createDemandNotifyHandler()({
          orgId: orgA,
          demandId,
          eventId: crypto.randomUUID(),
          template: "demand_update",
        }),
      ).toBe(0)
    } finally {
      await su.query("UPDATE demands SET state = 'published' WHERE id = $1", [
        demandId,
      ])
    }
  })
})
