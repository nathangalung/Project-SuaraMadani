import { afterAll, beforeAll, expect, test } from "bun:test"
import { Pool } from "pg"
import { migrate } from "../migrate.ts"
import { resetData, superuserPool, testUrl } from "../testing.ts"
import {
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
    ["itb.localhost", "admin.itb@suaramadani.test", "admin"],
    ["itb.localhost", "admin2.itb@suaramadani.test", "admin"],
    ["ugm.localhost", "admin.ugm@suaramadani.test", "admin"],
    ["ugm.localhost", "admin2.ugm@suaramadani.test", "admin"],
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
    { slug: "ugm", contact_email: "kontak.ugm@suaramadani.test" },
  ])
})
