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
import {
  insertOrg,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "./testing.ts"
import { main, resetTotp } from "./totp-reset.ts"

const su = superuserPool()
let migrator: Pool

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  migrator = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
  })
})

beforeEach(async () => {
  await resetData(su)
})

afterAll(async () => {
  await resetData(su)
  await migrator.end()
  await su.end()
})

test("lost authenticator: factor, sessions gone, audited", async () => {
  // ASVS V6.4.4: then re-enrol
  const orgId = await insertOrg(su, "hp")
  const userId = await insertUser(su, "staf.hilang@contoh.id")
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
    [orgId, userId],
  )
  await su.query(
    "UPDATE users SET two_factor_enabled = true, updated_at = now() - interval '1 day' WHERE id = $1",
    [userId],
  )
  await su.query(
    "INSERT INTO two_factors (secret, backup_codes, user_id) VALUES ('s', 'c', $1)",
    [userId],
  )
  await su.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ('t', $1, now() + interval '1 day')",
    [userId],
  )
  expect(await resetTotp(migrator, "STAF.hilang@contoh.id")).toEqual({
    ok: true,
  })
  const { rows } = await su.query<{ enabled: boolean; recent: boolean }>(
    `SELECT two_factor_enabled AS enabled, updated_at > now() - interval '1 minute' AS recent
     FROM users WHERE id = $1`,
    [userId],
  )
  expect(rows).toEqual([{ enabled: false, recent: true }])
  expect((await su.query("SELECT 1 FROM two_factors")).rowCount).toBe(0)
  expect((await su.query("SELECT 1 FROM sessions")).rowCount).toBe(0)
  const audit = await su.query(
    "SELECT org_id, action, entity_id FROM audit_log WHERE action = 'member.totp_reset'",
  )
  expect(audit.rows).toEqual([
    { org_id: orgId, action: "member.totp_reset", entity_id: userId },
  ])
})

test("only staff with a factor", async () => {
  await insertUser(su, "warga@contoh.id")
  expect(await resetTotp(migrator, "warga@contoh.id")).toEqual({
    ok: false,
    reason: "not_enrolled",
  })
  expect(await resetTotp(migrator, "hantu@contoh.id")).toEqual({
    ok: false,
    reason: "no_account",
  })
})

async function enrolledStaff(email: string): Promise<string> {
  const userId = await insertUser(su, email)
  await su.query("UPDATE users SET two_factor_enabled = true WHERE id = $1", [
    userId,
  ])
  await su.query(
    "INSERT INTO two_factors (secret, backup_codes, user_id) VALUES ('s', 'c', $1)",
    [userId],
  )
  await su.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
    [crypto.randomUUID(), userId],
  )
  return userId
}

test("Given a session row held by a live request, when the reset times out, then nothing changes and a retry succeeds", async () => {
  const userId = await enrolledStaff("sibuk@contoh.id")
  // One connection, reused after failure
  const impatient = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
    options: "-c lock_timeout=200",
    max: 1,
  })
  const state = async () =>
    (
      await su.query(
        `SELECT u.two_factor_enabled AS enabled, count(t.id)::int AS factors
         FROM users u LEFT JOIN two_factors t ON t.user_id = u.id
         WHERE u.id = $1 GROUP BY u.id`,
        [userId],
      )
    ).rows
  const holder = await su.connect()
  try {
    await holder.query("BEGIN")
    await holder.query("SELECT 1 FROM sessions WHERE user_id = $1 FOR UPDATE", [
      userId,
    ])
    const error = await resetTotp(impatient, "sibuk@contoh.id").catch(
      (e: { code?: string }) => e,
    )
    expect((error as { code?: string }).code).toBe("55P03")
    await holder.query("ROLLBACK")
    expect(await state()).toEqual([{ enabled: true, factors: 1 }])
    expect(await resetTotp(impatient, "sibuk@contoh.id")).toEqual({ ok: true })
    expect(await state()).toEqual([{ enabled: false, factors: 0 }])
  } finally {
    holder.release()
    await impatient.end()
  }
})

describe("bun db/totp-reset.ts", () => {
  const env = { DATABASE_MIGRATOR_URL: testUrl("TEST_DATABASE_MIGRATOR_URL") }

  test("Given enrolled staff, when the runbook resets them, then exit is 0", async () => {
    await enrolledStaff("staf@contoh.id")
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      expect(await main(["staf@contoh.id"], env)).toBe(0)
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({ msg: "totp reset", ok: true }),
      )
    } finally {
      logged.mockRestore()
    }
    expect((await su.query("SELECT 1 FROM two_factors")).rowCount).toBe(0)
  })

  test("Given no account, when the runbook resets it, then exit is 1", async () => {
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      expect(await main(["hantu@contoh.id"], env)).toBe(1)
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({ msg: "totp reset", ok: false, reason: "no_account" }),
      )
    } finally {
      logged.mockRestore()
    }
  })

  test("no email is a usage error", async () => {
    const failed = spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await main([], env)).toBe(2)
    } finally {
      failed.mockRestore()
    }
  })
})
