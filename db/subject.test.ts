import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test"
import { Pool } from "pg"
import { migrate } from "./migrate.ts"
import { deleteSubject, exportSubject, main } from "./subject.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "./testing.ts"

const su = superuserPool()
let migrator: Pool
let orgA = ""
let orgB = ""
let subject = ""
let other = ""
const EMAIL = "Subjek.Data@contoh.id"
const PHONE = "+6281234500077"

async function report(orgId: string, userId: string, code: string) {
  const values = reportValues(orgId, userId, { publicCode: code })
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO reports (org_id, user_id, public_code, submission_id, relation,
       province_code, regency_code, district_code, title, story, category_id,
       subcategory_id, occurred_on, urgency, affected_groups, affected_count,
       ongoing, contactable, consents, consent_text_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20) RETURNING id`,
    [
      orgId,
      userId,
      code,
      values.submissionId,
      values.relation,
      values.provinceCode,
      values.regencyCode,
      values.districtCode,
      values.title,
      values.story,
      values.categoryId,
      values.subcategoryId,
      values.occurredOn,
      values.urgency,
      values.affectedGroups,
      values.affectedCount,
      values.ongoing,
      values.contactable,
      values.consents,
      values.consentTextVersion,
    ],
  )
  return rows[0]?.id ?? ""
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  migrator = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
  })
})

beforeEach(async () => {
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "sja")
  orgB = await insertOrg(su, "sjb")
  subject = await insertUser(su, EMAIL.toLowerCase())
  other = await insertUser(su, "orang.lain@contoh.id")
  await su.query(
    "UPDATE users SET name = 'Subjek Data', phone_number = $2 WHERE id = $1",
    [subject, PHONE],
  )
  await su.query(
    `INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent)
     VALUES ('rahasia-token-subjek', $1, now() + interval '1 day', '10.0.0.9', 'UA subjek')`,
    [subject],
  )
})

afterAll(async () => {
  await resetData(su)
  await migrator.end()
  await su.end()
})

// CMP-04: UU PDP Pasal 7
test("export: every campus, only the subject, no secrets", async () => {
  const mine = await report(orgA, subject, "SJA-26-AAAAA")
  await report(orgB, subject, "SJB-26-BBBBB")
  await report(orgA, other, "SJA-26-OTHER")
  await su.query(
    "INSERT INTO report_contacts (org_id, report_id, phone, method) VALUES ($1, $2, $3, 'whatsapp')",
    [orgA, mine, PHONE],
  )
  for (const lookup of [EMAIL, PHONE]) {
    const result = await exportSubject(migrator, lookup)
    if (!result.ok) throw new Error(result.reason)
    const { data } = result
    expect(data.account.users).toEqual([
      expect.objectContaining({
        id: subject,
        name: "Subjek Data",
        email: EMAIL.toLowerCase(),
        phone_number: PHONE,
      }),
    ])
    expect(data.account.sessions).toEqual([
      expect.objectContaining({
        ip_address: "10.0.0.9",
        user_agent: "UA subjek",
      }),
    ])
    const codes = Object.values(data.campuses).flatMap((tables) =>
      (tables.reports ?? []).map((row) => row.public_code),
    )
    expect(codes.sort()).toEqual(["SJA-26-AAAAA", "SJB-26-BBBBB"])
    expect(data.campuses.sja?.report_contacts).toEqual([
      expect.objectContaining({ phone: PHONE, method: "whatsapp" }),
    ])
    const text = JSON.stringify(data)
    expect(text).not.toContain("SJA-26-OTHER")
    expect(text).not.toContain("orang.lain@contoh.id")
    expect(text).not.toContain("rahasia-token-subjek")
  }
  expect(await exportSubject(migrator, "tidak.ada@contoh.id")).toEqual({
    ok: false,
    reason: "no_account",
  })
})

// CMP-06, PRIV-18: global erasure
test("delete: refused while reports, staff or superadmin", async () => {
  await report(orgB, subject, "SJB-26-BBBBB")
  expect(await deleteSubject(migrator, EMAIL)).toEqual({
    ok: false,
    reason: "has_reports",
    campuses: ["sjb"],
  })
  await su.query("DELETE FROM reports WHERE user_id = $1", [subject])
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'editor')",
    [orgA, subject],
  )
  expect(await deleteSubject(migrator, EMAIL)).toEqual({
    ok: false,
    reason: "staff",
    campuses: ["sja"],
  })
  await su.query("DELETE FROM members WHERE user_id = $1", [subject])
  await su.query("UPDATE users SET superadmin = true WHERE id = $1", [subject])
  expect(await deleteSubject(migrator, EMAIL)).toEqual({
    ok: false,
    reason: "superadmin",
  })
})

test("delete: the account goes, history stays, audited", async () => {
  const kept = await report(orgA, other, "SJA-26-OTHER")
  // Followers and reporters are members
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'reporter')",
    [orgB, subject],
  )
  // SET NULL keeps the row
  await su.query(
    `INSERT INTO notifications (org_id, event_id, template, user_id, status)
     VALUES ($1, gen_random_uuid(), 'referral_deadline', $2, 'sent')`,
    [orgA, subject],
  )
  const result = await deleteSubject(migrator, PHONE)
  expect(result).toMatchObject({ ok: true, userId: subject })
  const { rows } = await su.query(
    "SELECT count(*)::int AS n FROM users WHERE id = $1",
    [subject],
  )
  expect(rows[0]?.n).toBe(0)
  const sessions = await su.query(
    "SELECT count(*)::int AS n FROM sessions WHERE user_id = $1",
    [subject],
  )
  expect(sessions.rows[0]?.n).toBe(0)
  const others = await su.query("SELECT id FROM reports WHERE id = $1", [kept])
  expect(others.rows).toHaveLength(1)
  const memberships = await su.query(
    "SELECT count(*)::int AS n FROM members WHERE user_id = $1",
    [subject],
  )
  expect(memberships.rows[0]?.n).toBe(0)
  const notice = await su.query(
    "SELECT user_id FROM notifications WHERE org_id = $1",
    [orgA],
  )
  expect(notice.rows).toEqual([{ user_id: null }])
  const audit = await su.query(
    "SELECT org_id, entity_type, entity_id FROM audit_log WHERE action = 'account.delete'",
  )
  expect(audit.rows).toEqual(
    expect.arrayContaining([
      { org_id: orgA, entity_type: "user", entity_id: subject },
      { org_id: orgB, entity_type: "user", entity_id: subject },
    ]),
  )
  expect(audit.rows).toHaveLength(2)
  expect(JSON.stringify(result)).not.toContain(PHONE)
})

test("Given a live request holding the subject's session, when the delete times out, then the account and audit trail are unchanged", async () => {
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'reporter')",
    [orgA, subject],
  )
  // One connection, reused after failure
  const impatient = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
    options: "-c lock_timeout=200",
    max: 1,
  })
  const holder = await su.connect()
  try {
    await holder.query("BEGIN")
    await holder.query("SELECT 1 FROM sessions WHERE user_id = $1 FOR UPDATE", [
      subject,
    ])
    const error = await deleteSubject(impatient, EMAIL).catch(
      (e: { code?: string }) => e,
    )
    expect((error as { code?: string }).code).toBe("55P03")
    await holder.query("ROLLBACK")
    const users = await su.query("SELECT 1 FROM users WHERE id = $1", [subject])
    expect(users.rowCount).toBe(1)
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'account.delete'",
    )
    expect(audit.rowCount).toBe(0)
    expect(await deleteSubject(impatient, EMAIL)).toMatchObject({ ok: true })
  } finally {
    holder.release()
    await impatient.end()
  }
})

describe("bun db/subject.ts", () => {
  const env = { DATABASE_MIGRATOR_URL: testUrl("TEST_DATABASE_MIGRATOR_URL") }

  async function run(argv: string[]) {
    const logged = spyOn(console, "log").mockImplementation(() => {})
    const failed = spyOn(console, "error").mockImplementation(() => {})
    try {
      const code = await main(argv, env)
      const out = logged.mock.calls.map(([line]) => String(line))
      const err = failed.mock.calls.map(([line]) => String(line))
      return { code, out, err }
    } finally {
      logged.mockRestore()
      failed.mockRestore()
    }
  }

  test("Given a DPO access request, when export runs, then the subject's data is printed", async () => {
    const { code, out } = await run(["export", PHONE])
    expect(code).toBe(0)
    const data = JSON.parse(out[0] ?? "{}")
    expect(data.account.users[0]).toMatchObject({
      id: subject,
      phone_number: PHONE,
    })
    expect(out[0]).not.toContain("rahasia-token-subjek")
  })

  test("Given no account, when export runs, then exit is 1 and nothing is printed to stdout", async () => {
    const { code, out, err } = await run(["export", "tidak.ada@contoh.id"])
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(JSON.parse(err[0] ?? "{}")).toEqual({
      msg: "subject export",
      ok: false,
      reason: "no_account",
    })
  })

  test("Given an erasure request with --confirm, when delete runs, then the account is gone and a receipt is printed", async () => {
    const { code, out } = await run(["delete", EMAIL, "--confirm"])
    expect(code).toBe(0)
    expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
      msg: "subject delete",
      ok: true,
      userId: subject,
    })
    const users = await su.query("SELECT 1 FROM users WHERE id = $1", [subject])
    expect(users.rowCount).toBe(0)
  })

  test("Given reports remain, when delete runs, then exit is 1 and the account stays", async () => {
    await report(orgA, subject, "SJA-26-AAAAA")
    const { code, out } = await run(["delete", EMAIL, "--confirm"])
    expect(code).toBe(1)
    expect(JSON.parse(out[0] ?? "{}")).toMatchObject({ reason: "has_reports" })
    const users = await su.query("SELECT 1 FROM users WHERE id = $1", [subject])
    expect(users.rowCount).toBe(1)
  })

  test("delete without --confirm and unknown commands change nothing", async () => {
    for (const argv of [["delete", EMAIL], ["purge", EMAIL], ["export"]]) {
      expect((await run(argv)).code).toBe(2)
    }
    const users = await su.query("SELECT 1 FROM users WHERE id = $1", [subject])
    expect(users.rowCount).toBe(1)
  })
})
