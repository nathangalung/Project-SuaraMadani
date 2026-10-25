import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { database } from "../../../db/client.server.ts"
import { migrate } from "../../../db/migrate.ts"
import { insertUser, superuserPool, testUrl } from "../../../db/testing.ts"
import { addPhone } from "./add-phone.server.ts"

const su = superuserPool()
let released = ""

/** Session created this long ago. */
async function sessionFor(userId: string, ageSeconds: number) {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO sessions (token, user_id, expires_at, created_at)
     VALUES ($1, $2, now() + interval '1 day', now() - make_interval(secs => $3))
     RETURNING id`,
    [crypto.randomUUID(), userId, ageSeconds],
  )
  return rows[0]?.id ?? ""
}

/** Polls until a lock wait. */
async function waitForLock(sql: string) {
  for (let tries = 0; tries < 500; tries++) {
    const { rows } = await su.query(
      `SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query ILIKE $1`,
      [`${sql}%`],
    )
    if (rows.length > 0) return
    await Bun.sleep(10)
  }
  throw new Error(`no statement waited: ${sql}`)
}

async function sessionCount(userId: string) {
  const { rows } = await su.query("SELECT 1 FROM sessions WHERE user_id = $1", [
    userId,
  ])
  return rows.length
}

async function phoneOf(id: string) {
  const { rows } = await su.query<{
    phone_number: string | null
    phone_verified: boolean
    updated_at: Date
  }>(
    "SELECT phone_number, phone_verified, updated_at FROM users WHERE id = $1",
    [id],
  )
  return rows[0]
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await su.query("DELETE FROM users WHERE email LIKE '%@nomor.test'")
  released = await insertUser(su, "dilepas@nomor.test")
  await sessionFor(released, 10)
})

afterAll(async () => {
  await su.query("DELETE FROM users WHERE email LIKE '%@nomor.test'")
  await su.end()
})

describe("addPhone", () => {
  test("an account without a number gets one, unproven", async () => {
    const before = (await phoneOf(released))?.updated_at
    expect(await addPhone(released, "0812 9000 1111", database().db)).toEqual({
      ok: true,
    })
    expect(await phoneOf(released)).toEqual({
      phone_number: "+6281290001111",
      phone_verified: false,
      // Staff sessions stay valid
      updated_at: before as Date,
    })
  })

  test("never replaces a number, never takes one", async () => {
    const other = await insertUser(su, "pemilik@nomor.test")
    await sessionFor(other, 10)
    await su.query(
      "UPDATE users SET phone_number = '+6281290002222', phone_verified = true WHERE id = $1",
      [other],
    )
    const pending = await insertUser(su, "tunggu@nomor.test")
    await su.query(
      "UPDATE users SET phone_number = '+6281290003333' WHERE id = $1",
      [pending],
    )
    const db = database().db
    expect(await addPhone(released, "12345", db)).toEqual({
      ok: false,
      error: "format",
    })
    expect(await addPhone(released, "081290002222", db)).toEqual({
      ok: false,
      error: "taken",
    })
    expect(await addPhone(released, "081290003333", db)).toEqual({
      ok: false,
      error: "pending",
    })
    expect(await addPhone(other, "081290004444", db)).toEqual({
      ok: false,
      error: "exists",
    })
    expect((await phoneOf(released))?.phone_number).toBeNull()
  })

  test("Given another account takes the number after the check, when the write lands, then it is refused as taken", async () => {
    const other = await insertUser(su, "balapan@nomor.test")
    const rival = await su.connect()
    try {
      await rival.query("BEGIN")
      await rival.query(
        "UPDATE users SET phone_number = '+6281290005555' WHERE id = $1",
        [other],
      )
      // Check passes, write waits
      const adding = addPhone(released, "081290005555", database().db)
      await waitForLock('update "users"')
      await rival.query("COMMIT")
      expect(await adding).toEqual({ ok: false, error: "taken" })
    } finally {
      await rival.query("ROLLBACK").catch(() => {})
      rival.release()
    }
    expect((await phoneOf(released))?.phone_number).toBeNull()
    expect((await phoneOf(other))?.phone_number).toBe("+6281290005555")
  })

  test("a stale session signs in again first", async () => {
    // ASVS V7.5.1: full re-authentication
    await su.query("DELETE FROM sessions WHERE user_id = $1", [released])
    await sessionFor(released, 600)
    await sessionFor(released, 3600)
    const refused = await addPhone(released, "081290005555").catch(
      (error: unknown) => error,
    )
    expect(refused).toBeInstanceOf(Response)
    expect((refused as Response).headers.get("location")).toBe("/masuk")
    expect(await sessionCount(released)).toBe(0)
    expect((await phoneOf(released))?.phone_number).toBeNull()
  })

  test("a given session must itself be fresh", async () => {
    const stale = await sessionFor(released, 600)
    const refused = await addPhone(
      released,
      "081290006666",
      database().db,
      stale,
    ).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(Response)
    const fresh = await sessionFor(released, 5)
    expect(
      await addPhone(released, "081290006666", database().db, fresh),
    ).toEqual({ ok: true })
  })
})
