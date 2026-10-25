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
import { main, revokeAllSessions, revokeUserSessions } from "./sessions.ts"
import { insertUser, resetData, superuserPool, testUrl } from "./testing.ts"

const su = superuserPool()
let migrator: Pool

async function sessionFor(userId: string): Promise<void> {
  await su.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
    [crypto.randomUUID(), userId],
  )
}

const count = async () =>
  (await su.query("SELECT 1 FROM sessions")).rowCount ?? 0

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

test("ends one user's sessions, keeps their data", async () => {
  // ASVS V7.4.5: one user
  const target = await insertUser(su, "dicuri@contoh.id")
  const other = await insertUser(su, "aman@contoh.id")
  await sessionFor(target)
  await sessionFor(target)
  await sessionFor(other)
  expect(await revokeUserSessions(migrator, " DICURI@contoh.id")).toBe(2)
  expect(await count()).toBe(1)
  const users = await su.query("SELECT 1 FROM users")
  expect(users.rowCount).toBe(2)
  expect(await revokeUserSessions(migrator, "hantu@contoh.id")).toBeNull()
})

test("ends every session after a compromise", async () => {
  // ASVS V7.4.5: all users
  await sessionFor(await insertUser(su, "a@contoh.id"))
  await sessionFor(await insertUser(su, "b@contoh.id"))
  expect(await revokeAllSessions(migrator)).toBe(2)
  expect(await count()).toBe(0)
})

describe("bun db/sessions.ts", () => {
  const env = { DATABASE_MIGRATOR_URL: testUrl("TEST_DATABASE_MIGRATOR_URL") }

  test("Given a stolen account, when revoke <email> runs, then only its sessions end", async () => {
    const target = await insertUser(su, "dicuri@contoh.id")
    await sessionFor(target)
    await sessionFor(await insertUser(su, "aman@contoh.id"))
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      expect(await main(["revoke", "dicuri@contoh.id"], env)).toBe(0)
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({ msg: "sessions revoked", all: false, ended: 1 }),
      )
    } finally {
      logged.mockRestore()
    }
    expect(await count()).toBe(1)
  })

  test("Given a compromise, when revoke --all runs, then every session ends", async () => {
    await sessionFor(await insertUser(su, "a@contoh.id"))
    await sessionFor(await insertUser(su, "b@contoh.id"))
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      expect(await main(["revoke", "--all"], env)).toBe(0)
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({ msg: "sessions revoked", all: true, ended: 2 }),
      )
    } finally {
      logged.mockRestore()
    }
    expect(await count()).toBe(0)
  })

  test("Given no account, when revoke runs, then exit is 1 and nothing ends", async () => {
    await sessionFor(await insertUser(su, "a@contoh.id"))
    const failed = spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await main(["revoke", "hantu@contoh.id"], env)).toBe(1)
      expect(await main(["revoke"], env)).toBe(2)
      expect(await main(["drop", "a@contoh.id"], env)).toBe(2)
    } finally {
      failed.mockRestore()
    }
    expect(await count()).toBe(1)
  })
})
