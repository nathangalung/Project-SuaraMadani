import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { passkey } from "@better-auth/passkey"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization, twoFactor } from "better-auth/plugins"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { accountOtp } from "../server/account-otp.server.ts"
import { migrate } from "./migrate.ts"
import {
  authSchema,
  organizationAdditionalFields,
  userAdditionalFields,
} from "./schema/auth.ts"
import { parseEwkbPoint } from "./schema/columns.ts"
import { insertUser, superuserPool, testUrl } from "./testing.ts"

describe("Better Auth schema", () => {
  test("matches the plugins the slice uses", async () => {
    // Pool never connects here
    const db = drizzle({ client: new Pool(), schema: authSchema })
    const auth = betterAuth({
      secret: "test-secret-test-secret-test-secret",
      baseURL: "http://localhost",
      database: drizzleAdapter(db, {
        provider: "pg",
        schema: authSchema,
        usePlural: true,
      }),
      advanced: { database: { generateId: "uuid" } },
      user: { additionalFields: userAdditionalFields },
      plugins: [
        accountOtp({
          sendEmail: async () => () => {},
          whatsapp: {
            ready: async () => false,
            sendCode: async () => ({ ok: false, reason: "unavailable" }),
            status: async () => null,
          },
        }),
        twoFactor(),
        passkey(),
        organization({
          schema: {
            organization: { additionalFields: organizationAdditionalFields },
          },
        }),
      ],
    })
    const context = await auth.$context
    expect(context.explicitSchemaCheck).toBeFunction()
    await context.explicitSchemaCheck?.()
  })
})

describe("parseEwkbPoint", () => {
  test("reads a little-endian EWKB point with SRID", () => {
    // SELECT ST_SetSRID(ST_MakePoint(107.6, -6.9), 4326)
    const hex = "0101000020E61000006666666666E65A409A99999999991BC0"
    expect(parseEwkbPoint(hex)).toEqual({ lng: 107.6, lat: -6.9 })
  })
})

describe("two_factors", () => {
  const su = superuserPool()
  const email = `totp-${crypto.randomUUID()}@example.test`

  beforeAll(async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  })

  afterAll(async () => {
    await su.query("DELETE FROM users WHERE email = $1", [email])
    await su.end()
  })

  test("holds one TOTP secret per user", async () => {
    // Concurrent enrollments race here
    const userId = await insertUser(su, email)
    const add = () =>
      su.query(
        "INSERT INTO two_factors (secret, backup_codes, user_id, verified) VALUES ('s', 'b', $1, false)",
        [userId],
      )
    await add()
    const second = await add().catch((e: unknown) => e)
    expect(second).toMatchObject({
      code: "23505",
      constraint: "two_factors_user_id_key",
    })
  })
})

describe("users.phone_number", () => {
  const su = superuserPool()
  const emails = [1, 2, 3].map(
    (n) => `hp-${n}-${crypto.randomUUID()}@example.test`,
  )

  beforeAll(async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  })

  afterAll(async () => {
    await su.query("DELETE FROM users WHERE email = ANY($1)", [emails])
    await su.end()
  })

  const setPhone = (email: string, phone: string) =>
    su.query("UPDATE users SET phone_number = $2 WHERE email = $1", [
      email,
      phone,
    ])

  test("one account per number, E.164 mobile only", async () => {
    const [a = "", b = "", c = ""] = emails
    for (const email of emails) await insertUser(su, email)
    await setPhone(a, "+6281234500001")
    expect(
      await setPhone(b, "+6281234500001").catch((e: unknown) => e),
    ).toMatchObject({
      code: "23505",
      constraint: "users_phone_number_key",
    })
    for (const bad of ["081234500002", "+62221234567", "+6281"]) {
      expect(await setPhone(c, bad).catch((e: unknown) => e)).toMatchObject({
        code: "23514",
        constraint: "users_phone_number_check",
      })
    }
    const { rows } = await su.query<{ phone_verified: boolean }>(
      "SELECT phone_verified FROM users WHERE email = $1",
      [a],
    )
    expect(rows[0]?.phone_verified).toBe(false)
  })
})

describe("issues.search", () => {
  const su = superuserPool()

  beforeAll(async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  })

  afterAll(async () => {
    await su.end()
  })

  test("is a stored Indonesian tsvector", async () => {
    // PG 18 defaults to VIRTUAL
    const { rows } = await su.query<{ generated: string; expr: string }>(
      `SELECT a.attgenerated AS generated, pg_get_expr(d.adbin, d.adrelid) AS expr
       FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'issues'::regclass AND a.attname = 'search'`,
    )
    expect(rows).toEqual([
      {
        generated: "s",
        expr: "to_tsvector('indonesian'::regconfig, ((title || ' '::text) || summary))",
      },
    ])
  })
})
