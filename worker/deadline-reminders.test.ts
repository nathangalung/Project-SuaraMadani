import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { schema } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import type { EmailMessage } from "../server/email.ts"
import { parseHashKey } from "../server/email-log.ts"
import { parseKeyring } from "../server/signed-link.ts"
import { EMAIL_QUOTA } from "../shared/notifications.ts"
import { createDeadlineReminderHandler } from "./deadline-reminders.ts"
import { createEmailSendHandler, type EmailSendDeps } from "./email-send.ts"

const su = superuserPool()
const DAY = 86_400_000
// 10:00 WIB, 14 October
const NOW = new Date("2026-10-14T03:00:00Z")
const keyring = parseKeyring(`1:${Buffer.alloc(32, 3).toString("base64")}`)
const key = parseHashKey(Buffer.alloc(32, 4).toString("base64"))

let orgA = ""
let orgB = ""
let adminOne = ""
let adminTwo = ""
let adminB = ""
let number = 0
let sent: EmailMessage[] = []
const codes: Record<string, string> = {}

function mailDeps(now = NOW): EmailSendDeps {
  return {
    email: {
      send: async (message) => {
        sent.push(message)
      },
    },
    keyring: () => keyring,
    hashKey: () => key,
    now: () => now,
    originFor: (host) => `https://${host}`,
  }
}

async function member(orgId: string, userId: string, role: string) {
  await su.query(
    `INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3`,
    [orgId, userId, role],
  )
}

async function issue(
  orgId: string,
  name: string,
  values: { gov?: string; published?: boolean } = {},
): Promise<string> {
  number++
  const code = `ISU-DL-26-${String(number).padStart(4, "0")}`
  codes[name] = code
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
       category_id, subcategory_id, province_code, regency_code,
       gov_status, advocacy_status, report_count, published_at)
     VALUES ($1, 2026, $2, $3, $4, 'Ringkasan isu.', 'program',
       'program.pendidikan', '32', '32.73', $5, 'referred', 1, $6)
     RETURNING id`,
    [
      orgId,
      number,
      code,
      `Isu ${name}`,
      values.gov ?? "awaiting_response",
      values.published === false ? null : NOW,
    ],
  )
  return rows[0]?.id ?? ""
}

async function referral(
  orgId: string,
  issueId: string,
  values: {
    sentOn: string
    deadlineOn: string | null
    agency?: string
    kind?: "referral" | "escalation"
  },
) {
  const kind = values.kind ?? "referral"
  await su.query(
    `INSERT INTO referrals (org_id, issue_id, kind, agency, channel, sent_on, deadline_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      orgId,
      issueId,
      kind,
      values.agency ?? "Dinas Pendidikan Kota Bandung",
      kind === "referral" ? "official_letter" : "ombudsman",
      values.sentOn,
      values.deadlineOn,
    ],
  )
}

async function digests(orgId: string) {
  const { rows } = await su.query<{
    id: string
    user_id: string
    event_id: string
    status: string
    error: string | null
  }>(
    `SELECT id, user_id, event_id, status, error FROM notifications
     WHERE org_id = $1 AND template = 'referral_deadline' ORDER BY created_at, user_id`,
    [orgId],
  )
  return rows
}

async function jobFor(notificationId: string) {
  const { rows } = await su.query<{ start_after: Date }>(
    `SELECT start_after FROM pgboss.job
     WHERE name = 'email-send' AND data->>'notificationId' = $1`,
    [notificationId],
  )
  return rows
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "dla")
  orgB = await insertOrg(su, "dlb")
  adminOne = await insertUser(su, "admin.satu@kampus.id")
  adminTwo = await insertUser(su, "admin.dua@kampus.id")
  adminB = await insertUser(su, "admin.b@kampus.id")
  const reporter = await insertUser(su, "pelapor@kampus.id")
  await member(orgA, adminOne, "admin")
  await member(orgA, adminTwo, "admin")
  await member(orgA, reporter, "reporter")
  await member(orgB, adminB, "admin")

  // Due: deadline passed, unanswered
  const late = await issue(orgA, "late")
  await referral(orgA, late, { sentOn: "2026-09-26", deadlineOn: "2026-10-10" })
  // Deadline today: not yet late
  const today = await issue(orgA, "today")
  await referral(orgA, today, {
    sentOn: "2026-09-30",
    deadlineOn: "2026-10-14",
  })
  const answered = await issue(orgA, "answered", { gov: "responded" })
  await referral(orgA, answered, {
    sentOn: "2026-09-20",
    deadlineOn: "2026-10-04",
  })
  const hidden = await issue(orgA, "hidden", { published: false })
  await referral(orgA, hidden, {
    sentOn: "2026-09-20",
    deadlineOn: "2026-10-04",
  })
  // Re-referred, new deadline ahead
  const again = await issue(orgA, "again")
  await referral(orgA, again, {
    sentOn: "2026-09-01",
    deadlineOn: "2026-09-15",
  })
  await referral(orgA, again, {
    sentOn: "2026-10-12",
    agency: "Dinas PUPR Kota Bandung",
    deadlineOn: "2026-10-26",
  })
  const escalated = await issue(orgA, "escalated")
  await referral(orgA, escalated, {
    kind: "escalation",
    sentOn: "2026-09-20",
    deadlineOn: "2026-10-04",
  })
  const other = await issue(orgB, "other")
  await referral(orgB, other, {
    sentOn: "2026-09-20",
    deadlineOn: "2026-10-04",
  })
})

beforeEach(async () => {
  sent = []
  await su.query("DELETE FROM email_log")
})

afterAll(async () => {
  await resetData(su)
  await su.query("DELETE FROM email_log")
  await su.query("DELETE FROM pgboss.job WHERE name = 'email-send'")
  await su.end()
})

describe("deadline-reminders", () => {
  test("every admin gets one digest per day", async () => {
    const result = await createDeadlineReminderHandler({ now: () => NOW })({})
    expect(result).toEqual({ orgs: 2, digests: 3 })
    const rows = await digests(orgA)
    expect(rows.map((row) => row.user_id).sort()).toEqual(
      [adminOne, adminTwo].sort(),
    )
    // One audit event, org-day
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(1)
    const { rows: audit } = await su.query(
      `SELECT id, actor_id, action, entity_type, entity_id FROM audit_log
       WHERE org_id = $1 AND action = 'referral.remind'`,
      [orgA],
    )
    expect(audit).toEqual([
      {
        id: rows[0]?.event_id,
        actor_id: null,
        action: "referral.remind",
        entity_type: "organization",
        entity_id: orgA,
      },
    ])
    for (const row of rows) {
      expect(row.status).toBe("pending")
      const jobs = await jobFor(row.id)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]?.start_after.getTime()).toBeLessThanOrEqual(Date.now())
    }
    expect(await digests(orgB)).toHaveLength(1)
  })

  test("a second run the same day adds nothing", async () => {
    const later = new Date(NOW.getTime() + 6 * 3_600_000)
    const result = await createDeadlineReminderHandler({ now: () => later })({})
    expect(result).toEqual({ orgs: 2, digests: 0 })
    expect(await digests(orgA)).toHaveLength(2)
    const { rows } = await su.query(
      "SELECT id FROM audit_log WHERE action = 'referral.remind'",
    )
    expect(rows).toHaveLength(2)
  })

  test("the digest lists only overdue referrals", async () => {
    const row = (await digests(orgA)).find((r) => r.user_id === adminOne)
    const outcome = await createEmailSendHandler(mailDeps())({
      orgId: orgA,
      notificationId: row?.id ?? "",
    })
    expect(outcome).toBe("sent")
    const [message] = sent
    expect(message?.to).toBe("admin.satu@kampus.id")
    expect(message?.subject).toContain("1 penerusan")
    const text = message?.text ?? ""
    expect(text).toContain(codes.late ?? "?")
    expect(text).toContain("Dinas Pendidikan Kota Bandung")
    expect(text).toContain("10 Oktober 2026")
    // Days since sent, as /isu
    expect(text).toContain("18 hari")
    expect(text).toContain(
      "https://dla.localhost/kelola/isu?perlu=lewat-tenggat",
    )
    for (const name of [
      "today",
      "answered",
      "hidden",
      "again",
      "escalated",
      "other",
    ]) {
      expect(text).not.toContain(codes[name] ?? "?")
    }
    const { rows } = await su.query(
      "SELECT kind, status FROM email_log ORDER BY created_at",
    )
    expect(rows).toEqual([{ kind: "notification", status: "sent" }])
  })

  test("a demoted admin is skipped", async () => {
    await member(orgA, adminTwo, "reporter")
    const row = (await digests(orgA)).find((r) => r.user_id === adminTwo)
    const outcome = await createEmailSendHandler(mailDeps())({
      orgId: orgA,
      notificationId: row?.id ?? "",
    })
    expect(outcome).toBe("skipped")
    expect(
      (await digests(orgA)).find((r) => r.user_id === adminTwo),
    ).toMatchObject({
      status: "skipped",
      error: "not_admin",
    })
    expect(sent).toHaveLength(0)
    await member(orgA, adminTwo, "admin")
  })

  test("an answer before sending drops the digest", async () => {
    await su.query(
      "UPDATE issues SET gov_status = 'responded' WHERE public_code = $1",
      [codes.other],
    )
    const [row] = await digests(orgB)
    const outcome = await createEmailSendHandler(mailDeps())({
      orgId: orgB,
      notificationId: row?.id ?? "",
    })
    expect(outcome).toBe("skipped")
    expect((await digests(orgB))[0]).toMatchObject({
      status: "skipped",
      error: "resolved",
    })
    await su.query(
      "UPDATE issues SET gov_status = 'awaiting_response' WHERE public_code = $1",
      [codes.other],
    )
  })

  test("the full ceiling defers the digest", async () => {
    const next = new Date(NOW.getTime() + DAY)
    await createDeadlineReminderHandler({ now: () => next })({})
    const row = (await digests(orgB)).at(-1)
    await su.query(
      `INSERT INTO email_log (kind, address_hash, status, created_at)
       SELECT 'notification', 'h' || g, 'sent', $1
       FROM generate_series(1, $2) g`,
      [next, EMAIL_QUOTA.notificationCeiling],
    )
    const outcome = await createEmailSendHandler(mailDeps(next))({
      orgId: orgB,
      notificationId: row?.id ?? "",
    })
    expect(outcome).toBe("deferred")
    expect(sent).toHaveLength(0)
  })

  test("a newer digest replaces a late one", async () => {
    // adminTwo has day 2
    const [dayOne] = (await digests(orgA)).filter((r) => r.user_id === adminTwo)
    await su.query(
      "UPDATE notifications SET status = 'pending', error = NULL WHERE id = $1",
      [dayOne?.id],
    )
    const outcome = await createEmailSendHandler(
      mailDeps(new Date(NOW.getTime() + DAY)),
    )({ orgId: orgA, notificationId: dayOne?.id ?? "" })
    expect(outcome).toBe("skipped")
    expect(
      (await digests(orgA)).find((r) => r.id === dayOne?.id),
    ).toMatchObject({ status: "skipped", error: "superseded" })
  })

  test("before 07:00 WIB the mail waits for morning", async () => {
    // 05:00 WIB, 16 October
    const early = new Date("2026-10-15T22:00:00Z")
    const result = await createDeadlineReminderHandler({ now: () => early })({})
    expect(result.digests).toBe(3)
    const fresh = (await digests(orgA)).slice(-2)
    for (const row of fresh) {
      const jobs = await jobFor(row.id)
      expect(jobs[0]?.start_after).toEqual(new Date("2026-10-16T00:00:00Z"))
    }
  })

  test("an org without overdue referrals gets nothing", async () => {
    const empty = await insertOrg(su, "dlc")
    const admin = await insertUser(su, "admin.c@kampus.id")
    await member(empty, admin, "admin")
    const next = new Date(NOW.getTime() + 3 * DAY)
    const result = await createDeadlineReminderHandler({ now: () => next })({})
    expect(result.orgs).toBe(3)
    expect(await digests(empty)).toHaveLength(0)
    const { rows } = await su.query(
      "SELECT id FROM audit_log WHERE org_id = $1",
      [empty],
    )
    expect(rows).toHaveLength(0)
  })

  test("Given overdue referrals but no admin, when reminders run, then the campus gets no digest", async () => {
    const orphan = await insertOrg(su, "dld")
    const reporter = await insertUser(su, "pelapor.d@kampus.id")
    await member(orphan, reporter, "reporter")
    const late = await issue(orphan, "orphan")
    await referral(orphan, late, {
      sentOn: "2026-09-20",
      deadlineOn: "2026-10-04",
    })
    const next = new Date(NOW.getTime() + 4 * DAY)
    await createDeadlineReminderHandler({ now: () => next })({})
    expect(await digests(orphan)).toHaveLength(0)
    const { rows } = await su.query(
      "SELECT id FROM audit_log WHERE org_id = $1",
      [orphan],
    )
    expect(rows).toHaveLength(0)
  })

  test("Given one campus is locked, when reminders run, then the others still get digests and the job retries", async () => {
    const day = new Date(NOW.getTime() + 10 * DAY)
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO audit_log (org_id, action, entity_type, entity_id, created_at)
       VALUES ($1, 'referral.remind', 'organization', $1, $2) RETURNING id`,
      [orgA, day],
    )
    const eventId = rows[0]?.id
    const beforeA = (await digests(orgA)).length
    const beforeB = (await digests(orgB)).length
    // Lock waits fail fast
    const impatient = new Pool({
      connectionString: testUrl("TEST_DATABASE_URL"),
      max: 2,
      options: "-c lock_timeout=300",
    })
    const holder = await su.connect()
    try {
      await holder.query("BEGIN")
      await holder.query(
        `INSERT INTO notifications (org_id, user_id, event_id, template, created_at)
         VALUES ($1, $2, $3, 'referral_deadline', $4)`,
        [orgA, adminOne, eventId, day],
      )
      const run = createDeadlineReminderHandler({
        db: drizzle({ client: impatient, schema }),
        now: () => day,
      })({})
      await expect(run).rejects.toThrow("failed in 1 orgs")
    } finally {
      await holder.query("ROLLBACK")
      holder.release()
      await impatient.end()
    }
    expect(await digests(orgA)).toHaveLength(beforeA)
    expect(await digests(orgB)).toHaveLength(beforeB + 1)
  })
})
