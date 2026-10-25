import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { Pool } from "pg"
import { migrate } from "../migrate.ts"
import { resetData, superuserPool, testUrl } from "../testing.ts"
import {
  assertSeedTarget,
  main,
  SEED_ORGS,
  SEED_SUPERADMIN,
  seedOrganizations,
} from "./organizations.ts"
import { seedRegions, TEST_REGIONS } from "./regions.ts"

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
  await migrator.end()
  await su.end()
})

test("region sample nests by code and is idempotent", async () => {
  await seedRegions(migrator, TEST_REGIONS)
  await seedRegions(migrator, TEST_REGIONS)
  const { rows } = await su.query<{ level: number; n: number }>(
    "SELECT level, count(*)::int AS n FROM regions GROUP BY level ORDER BY level",
  )
  expect(rows.map((r) => r.level)).toEqual([1, 2, 3, 4])
  expect(rows.find((r) => r.level === 1)?.n).toBe(2)
  for (const [code, parent] of TEST_REGIONS) {
    if (parent) expect(code.startsWith(`${parent}.`)).toBe(true)
  }
})

test("two orgs with two admins each, one superadmin", async () => {
  await seedRegions(migrator, TEST_REGIONS)
  await seedOrganizations(migrator, "localhost")
  await seedOrganizations(migrator, "localhost")
  const { rows } = await su.query<{
    host: string
    email: string
    role: string
  }>(
    `SELECT o.host, u.email, m.role FROM members m
     JOIN organizations o ON o.id = m.organization_id
     JOIN users u ON u.id = m.user_id ORDER BY o.host, u.email COLLATE "C"`,
  )
  expect(rows.map((r) => [r.host, r.email, r.role])).toEqual([
    ["itb.localhost", "admin.itb@sadarbersuara.test", "admin"],
    ["itb.localhost", "admin2.itb@sadarbersuara.test", "admin"],
    ["ugm.localhost", "admin.ugm@sadarbersuara.test", "admin"],
    ["ugm.localhost", "admin2.ugm@sadarbersuara.test", "admin"],
  ])
  expect(rows.length).toBe(SEED_ORGS.flatMap((org) => org.staff).length)
  const users = await su.query(
    "SELECT 1 FROM users WHERE age_declared_at IS NOT NULL AND email_verified",
  )
  expect(users.rowCount).toBe(5)
  const phones = await su.query(
    "SELECT 1 FROM users WHERE phone_number ~ '^\\+628[1-9][0-9]{7,10}$' AND name <> ''",
  )
  expect(phones.rowCount).toBe(5)
  const root = await su.query<{ email: string }>(
    "SELECT email FROM users WHERE superadmin",
  )
  expect(root.rows).toEqual([{ email: SEED_SUPERADMIN }])
})

test("re-seed adds the credit, keeps admin settings", async () => {
  await seedOrganizations(migrator, "localhost")
  await su.query(
    `UPDATE organizations SET settings = settings || '{"intakePaused":true}' WHERE slug = 'itb'`,
  )
  await seedOrganizations(migrator, "localhost")
  const { rows } = await su.query<{ slug: string; settings: object }>(
    "SELECT slug, settings FROM organizations ORDER BY slug",
  )
  expect(rows).toEqual([
    {
      slug: "itb",
      settings: {
        intakePaused: true,
        credit: "CSTS — Center for Science, Technology and Society, KM ITB",
      },
    },
    { slug: "ugm", settings: {} },
  ])
})

test("re-seed fills a missing contact, keeps an admin one", async () => {
  await su.query("UPDATE organizations SET contact_email = NULL")
  await su.query(
    "UPDATE organizations SET contact_email = 'pengurus@km.contoh.id' WHERE slug = 'itb'",
  )
  await seedOrganizations(migrator, "localhost")
  const { rows } = await su.query<{ slug: string; contact_email: string }>(
    "SELECT slug, contact_email FROM organizations ORDER BY slug",
  )
  expect(rows).toEqual([
    { slug: "itb", contact_email: "pengurus@km.contoh.id" },
    { slug: "ugm", contact_email: "kontak.ugm@sadarbersuara.test" },
  ])
})

test("organization seed refuses production", () => {
  expect(() => assertSeedTarget("production")).toThrow(
    "Organization seed refuses NODE_ENV=production",
  )
  expect(() => assertSeedTarget("development")).not.toThrow()
  expect(() => assertSeedTarget(undefined)).not.toThrow()
})

test("Given a region whose parent is missing, when seeding, then nothing is written and the connection stays usable", async () => {
  const single = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
    max: 1,
  })
  try {
    const orphan = [
      ["98", null, "Provinsi Uji"],
      ["99.01", "99", "Kabupaten Yatim"],
    ] as const
    const error = await seedRegions(single, orphan).catch(
      (e: { code?: string }) => e,
    )
    expect((error as { code?: string }).code).toBe("23503")
    const { rows } = await su.query(
      "SELECT code FROM regions WHERE code IN ('98', '99.01')",
    )
    expect(rows).toEqual([])
    expect(await seedRegions(single, TEST_REGIONS)).toBe(TEST_REGIONS.length)
  } finally {
    await single.end()
  }
})

test("Given a campus row held by a live request, when the seed times out, then the other campus is not half-seeded", async () => {
  await seedOrganizations(migrator, "localhost")
  await su.query("UPDATE organizations SET contact_email = NULL")
  // One connection, reused after failure
  const impatient = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
    options: "-c lock_timeout=200",
    max: 1,
  })
  const contacts = async () =>
    (
      await su.query(
        "SELECT slug, contact_email FROM organizations ORDER BY slug",
      )
    ).rows.map((row) => row.contact_email)
  const holder = await su.connect()
  try {
    await holder.query("BEGIN")
    await holder.query(
      "SELECT 1 FROM organizations WHERE slug = 'ugm' FOR UPDATE",
    )
    const error = await seedOrganizations(impatient, "localhost").catch(
      (e: { code?: string }) => e,
    )
    expect((error as { code?: string }).code).toBe("55P03")
    await holder.query("ROLLBACK")
    expect(await contacts()).toEqual([null, null])
    await seedOrganizations(impatient, "localhost")
    expect(await contacts()).toEqual([
      "kontak.itb@sadarbersuara.test",
      "kontak.ugm@sadarbersuara.test",
    ])
  } finally {
    holder.release()
    await impatient.end()
  }
})

describe("bun db/seed/organizations.ts", () => {
  const env = {
    DATABASE_MIGRATOR_URL: testUrl("TEST_DATABASE_MIGRATOR_URL"),
    APEX_HOST: "sadarbersuara.test",
  }

  test("Given a dev database, when the seed runs, then both campuses answer on the apex host", async () => {
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      await main({ ...env, NODE_ENV: "development" })
      expect(logged).toHaveBeenCalledWith(
        JSON.stringify({
          msg: "seeded organizations",
          count: SEED_ORGS.length,
        }),
      )
    } finally {
      logged.mockRestore()
    }
    const { rows } = await su.query(
      "SELECT host FROM organizations ORDER BY host",
    )
    expect(rows).toEqual([
      { host: "itb.sadarbersuara.test" },
      { host: "ugm.sadarbersuara.test" },
    ])
    await seedOrganizations(migrator, "localhost")
  })

  test("Given production, when the seed runs, then it refuses before connecting", async () => {
    await expect(main({ NODE_ENV: "production" })).rejects.toThrow(
      "Organization seed refuses NODE_ENV=production",
    )
  })
})
