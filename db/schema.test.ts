import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { passkey } from "@better-auth/passkey"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { organization, twoFactor } from "better-auth/plugins"
import { is, type SQL } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core"
import { Pool } from "pg"
import { accountOtp } from "../server/account-otp.server.ts"
import { schema } from "./client.server.ts"
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

describe("drizzle schema", () => {
  const su = superuserPool()

  beforeAll(async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  })

  afterAll(async () => {
    await su.end()
  })

  // pg_constraint.confdeltype codes
  const ON_DELETE: Record<string, string> = {
    a: "no action",
    r: "restrict",
    c: "cascade",
    n: "set null",
    d: "set default",
  }

  function declared(): Map<string, string[]> {
    const tables = new Map<string, string[]>()
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue
      const config = getTableConfig(value)
      const names = [
        ...config.foreignKeys.map((fk) => {
          const target = getTableConfig(fk.reference().foreignTable).name
          return `fk ${fk.getName()} ${target} ${fk.onDelete ?? "no action"}`
        }),
        ...config.indexes.map((index) => `index ${index.config.name}`),
        ...config.checks.map((check) => `check ${check.name}`),
        ...config.uniqueConstraints.map((u) => `unique ${u.getName()}`),
        ...config.columns.flatMap((column) =>
          column.isUnique ? [`unique ${column.uniqueName}`] : [],
        ),
      ]
      if (names.length > 0) tables.set(config.name, names.sort())
    }
    return tables
  }

  test("declares exactly the keys, checks and indexes the migrations create", async () => {
    // drizzle-kit generate diffs against this
    const { rows } = await su.query<{ table: string; name: string }>(
      `SELECT conrelid::regclass::text AS table,
         CASE contype
           WHEN 'f' THEN 'fk ' || conname || ' ' || confrelid::regclass::text || ' ' || confdeltype::text
           WHEN 'c' THEN 'check ' || conname
           ELSE 'unique ' || conname
         END AS name
       FROM pg_constraint
       WHERE connamespace = 'public'::regnamespace AND contype IN ('f', 'c', 'u')
       UNION ALL
       SELECT tablename, 'index ' || indexname FROM pg_indexes i
       WHERE schemaname = 'public' AND NOT EXISTS (
         SELECT 1 FROM pg_constraint c
         WHERE c.conname = i.indexname AND c.connamespace = 'public'::regnamespace)`,
    )
    const actual = new Map<string, string[]>()
    for (const row of rows) {
      const name = row.name.startsWith("fk ")
        ? row.name.replace(/ (\w)$/, (_, code: string) => ` ${ON_DELETE[code]}`)
        : row.name
      actual.set(row.table, [...(actual.get(row.table) ?? []), name])
    }
    // PostGIS owns this one
    actual.delete("spatial_ref_sys")
    for (const names of actual.values()) names.sort()
    // Unexported tables fail here too
    expect(Object.fromEntries(declared())).toEqual(Object.fromEntries(actual))
  })

  test("declares the generated columns the database stores", async () => {
    const dialect = new PgDialect()
    const generated: { table: string; column: string; expr: string }[] = []
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue
      const config = getTableConfig(value)
      for (const column of config.columns) {
        const as = column.generated?.as
        if (as === undefined) continue
        const sql = (typeof as === "function" ? as() : as) as SQL
        generated.push({
          table: config.name,
          column: column.name,
          expr: dialect.sqlToQuery(sql).sql,
        })
      }
    }
    expect(generated.map((one) => `${one.table}.${one.column}`).sort()).toEqual(
      ["demands.search", "issues.search"],
    )
    // Postgres normalises both sides
    const client = await su.connect()
    try {
      for (const one of generated) {
        let rows: { name: string; expr: string }[] = []
        await client.query("BEGIN")
        try {
          await client.query(
            `ALTER TABLE "${one.table}" ADD COLUMN sb_drift tsvector GENERATED ALWAYS AS (${one.expr}) STORED`,
          )
          const found = await client.query<{ name: string; expr: string }>(
            `SELECT a.attname AS name, pg_get_expr(d.adbin, d.adrelid) AS expr
             FROM pg_attribute a
             JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE a.attrelid = $1::regclass AND a.attname IN ($2, 'sb_drift')
             ORDER BY a.attname = 'sb_drift'`,
            [one.table, one.column],
          )
          rows = found.rows
        } finally {
          await client.query("ROLLBACK")
        }
        expect(rows.map((row) => row.name)).toEqual([one.column, "sb_drift"])
        expect(rows[1]?.expr).toBe(rows[0]?.expr)
      }
    } finally {
      client.release()
    }
  })
})
