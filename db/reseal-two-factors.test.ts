import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test"
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto"
import { Pool } from "pg"
import { migrate } from "./migrate.ts"
import { main, resealTwoFactors, secretConfig } from "./reseal-two-factors.ts"
import { insertUser, resetData, superuserPool, testUrl } from "./testing.ts"

const su = superuserPool()
let migrator: Pool
const v1 = { version: 1, value: Buffer.alloc(32, 1).toString("base64") }
const v2 = { version: 2, value: Buffer.alloc(32, 2).toString("base64") }

async function enrol(email: string, secrets: (typeof v1)[]) {
  const key = secretConfig(secrets)
  const userId = await insertUser(su, email)
  await su.query(
    "INSERT INTO two_factors (secret, backup_codes, user_id) VALUES ($1, $2, $3)",
    [
      await symmetricEncrypt({ key, data: "JBSWY3DPEHPK3PXP" }),
      await symmetricEncrypt({ key, data: '["ab12C-3dE45"]' }),
      userId,
    ],
  )
}

async function rows() {
  const { rows } = await su.query<{ secret: string; backup_codes: string }>(
    "SELECT secret, backup_codes FROM two_factors ORDER BY secret",
  )
  return rows
}

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

test("reseals old envelopes under the current version", async () => {
  await enrol("staf@contoh.id", [v1])
  expect(await resealTwoFactors(migrator, [v2, v1])).toEqual({
    resealed: 1,
    stale: 0,
  })
  const [row] = await rows()
  expect(row?.secret.startsWith("$ba$2$")).toBe(true)
  expect(row?.backup_codes.startsWith("$ba$2$")).toBe(true)
  // Version 1 can now retire
  const only2 = secretConfig([v2])
  expect(await symmetricDecrypt({ key: only2, data: row?.secret ?? "" })).toBe(
    "JBSWY3DPEHPK3PXP",
  )
  expect(await resealTwoFactors(migrator, [v2, v1])).toEqual({
    resealed: 0,
    stale: 0,
  })
})

test("a version missing from the keyring stays and counts", async () => {
  await enrol("hilang@contoh.id", [{ version: 3, value: v1.value }])
  await enrol("baru@contoh.id", [v2])
  const before = await rows()
  expect(await resealTwoFactors(migrator, [v2, v1])).toEqual({
    resealed: 0,
    stale: 1,
  })
  expect(await rows()).toEqual(before)
})

test("Given a row sealed under a different v1 value, when resealing, then nothing changes and the connection stays usable", async () => {
  await enrol("a@contoh.id", [v1])
  await enrol("b@contoh.id", [{ version: 1, value: v2.value }])
  const before = await rows()
  const single = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
    max: 1,
  })
  try {
    await expect(resealTwoFactors(single, [v2, v1])).rejects.toThrow()
    expect(await rows()).toEqual(before)
    // Leaked lock fails fast
    const fix = await su.connect()
    try {
      await fix.query("BEGIN")
      await fix.query("SET LOCAL lock_timeout = '2s'")
      await fix.query(
        "DELETE FROM two_factors WHERE user_id = (SELECT id FROM users WHERE email = 'b@contoh.id')",
      )
      await fix.query("COMMIT")
    } finally {
      fix.release()
    }
    expect(await resealTwoFactors(single, [v2, v1])).toEqual({
      resealed: 1,
      stale: 0,
    })
  } finally {
    await single.end()
  }
})

describe("bun db/reseal-two-factors.ts", () => {
  const url = testUrl("TEST_DATABASE_MIGRATOR_URL")
  const keyring = (...keys: (typeof v1)[]) =>
    keys.map((k) => `${k.version}:${k.value}`).join(",")

  test("Given readable rows, when run before retiring v1, then exit is 0", async () => {
    await enrol("staf@contoh.id", [v1])
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      const env = {
        DATABASE_MIGRATOR_URL: url,
        BETTER_AUTH_SECRETS: keyring(v2, v1),
      }
      expect(await main(env)).toBe(0)
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({ msg: "two_factors resealed", resealed: 1, stale: 0 }),
      )
    } finally {
      logged.mockRestore()
    }
  })

  test("Given a row no key can read, when run, then exit is 1 and retirement is blocked", async () => {
    await enrol("hilang@contoh.id", [{ version: 3, value: v1.value }])
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      const env = {
        DATABASE_MIGRATOR_URL: url,
        BETTER_AUTH_SECRETS: keyring(v2, v1),
      }
      expect(await main(env)).toBe(1)
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({ msg: "two_factors resealed", resealed: 0, stale: 1 }),
      )
    } finally {
      logged.mockRestore()
    }
  })

  test("a missing keyring refuses to run", async () => {
    await expect(main({ DATABASE_MIGRATOR_URL: url })).rejects.toThrow(
      "BETTER_AUTH_SECRETS is not set",
    )
  })
})
