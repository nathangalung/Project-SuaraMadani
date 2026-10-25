import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { Pool } from "pg"
import { migrate } from "./migrate.ts"
import { main, setSuperadmin } from "./superadmin.ts"
import { insertUser, resetData, superuserPool, testUrl } from "./testing.ts"

const su = superuserPool()
let migrator: Pool

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  migrator = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
  })
})

afterAll(async () => {
  await resetData(su)
  await migrator.end()
  await su.end()
})

const flag = async (email: string) =>
  (
    await su.query<{ superadmin: boolean }>(
      "SELECT superadmin FROM users WHERE email = $1",
      [email],
    )
  ).rows[0]?.superadmin

test("grants and revokes by email, any case", async () => {
  await insertUser(su, "root@aliansi.id")
  expect(await setSuperadmin(migrator, " ROOT@aliansi.id", true)).toBe(true)
  expect(await flag("root@aliansi.id")).toBe(true)
  expect(await setSuperadmin(migrator, "root@aliansi.id", false)).toBe(true)
  expect(await flag("root@aliansi.id")).toBe(false)
})

test("an unknown address creates no account", async () => {
  // Account needs the 18+ sign-in
  expect(await setSuperadmin(migrator, "baru@aliansi.id", true)).toBe(false)
  const { rows } = await su.query(
    "SELECT 1 FROM users WHERE email = 'baru@aliansi.id'",
  )
  expect(rows).toHaveLength(0)
})

test("the app role cannot set the flag", async () => {
  const app = new Pool({ connectionString: testUrl("TEST_DATABASE_URL") })
  try {
    const error = await app
      .query("UPDATE users SET superadmin = true")
      .catch((e: { code?: string }) => e)
    expect((error as { code?: string }).code).toBe("42501")
  } finally {
    await app.end()
  }
})

test("the app role cannot create a superadmin", async () => {
  const app = new Pool({ connectionString: testUrl("TEST_DATABASE_URL") })
  try {
    const error = await app
      .query(
        `INSERT INTO users (name, email, age_declared_at, age_consent_version, superadmin)
         VALUES ('x', 'naik@contoh.test', now(), 'v1', true)`,
      )
      .catch((e: { code?: string }) => e)
    expect((error as { code?: string }).code).toBe("42501")
    // Ordinary sign-up still works
    await app.query(
      `INSERT INTO users (name, email, age_declared_at, age_consent_version)
       VALUES ('x', 'biasa@contoh.test', now(), 'v1')`,
    )
    expect(await flag("biasa@contoh.test")).toBe(false)
    expect(await flag("naik@contoh.test")).toBeUndefined()
  } finally {
    await app.end()
  }
})

describe("bun db/superadmin.ts", () => {
  const env = { DATABASE_MIGRATOR_URL: testUrl("TEST_DATABASE_MIGRATOR_URL") }

  test("Given an account, when grant runs, then the flag is set and exit is 0", async () => {
    await insertUser(su, "cli@aliansi.id")
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      expect(await main(["grant", "cli@aliansi.id"], env)).toBe(0)
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({ msg: "superadmin updated", command: "grant" }),
      )
    } finally {
      logged.mockRestore()
    }
    expect(await flag("cli@aliansi.id")).toBe(true)
  })

  test("Given no account, when revoke runs, then exit is 1", async () => {
    const failed = spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await main(["revoke", "hantu@aliansi.id"], env)).toBe(1)
      expect(failed).toHaveBeenCalledWith(
        JSON.stringify({
          msg: "no account, sign in once first",
          command: "revoke",
        }),
      )
    } finally {
      failed.mockRestore()
    }
  })

  test("an unknown command or a missing email is a usage error", async () => {
    const failed = spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await main(["promote", "a@aliansi.id"], env)).toBe(2)
      expect(await main(["grant"], env)).toBe(2)
    } finally {
      failed.mockRestore()
    }
  })
})
