import { Pool } from "pg"
import {
  AGE_CONSENT_VERSION,
  CONSENT_TEXT_VERSION,
} from "../shared/report-fields.ts"
import type { reports } from "./schema/reports.ts"

// Test-only helpers for sadar_bersuara_test

export function testUrl(name: string): string {
  const url = process.env[name]
  if (!url) throw new Error(`${name} is not set; copy .env.example to .env`)
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error(`${name} must point at a *_test database`)
  }
  return url
}

export function superuserPool(): Pool {
  return new Pool({
    connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
    max: 4,
  })
}

/** Empties tenant and auth data. */
export async function resetData(su: Pool): Promise<void> {
  await su.query("TRUNCATE organizations, users CASCADE")
}

const SAMPLE_REGIONS = [
  ["32", null, 1, "Jawa Barat"],
  ["32.73", "32", 2, "Kota Bandung"],
  ["32.73.02", "32.73", 3, "Coblong"],
] as const

export async function insertRegions(su: Pool): Promise<void> {
  for (const [code, parent, level, name] of SAMPLE_REGIONS) {
    await su.query(
      "INSERT INTO regions (code, parent_code, level, name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [code, parent, level, name],
    )
  }
}

export async function insertOrg(su: Pool, slug: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, host, campus_code, campus_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`KM ${slug}`, slug, `${slug}.localhost`, slug.toUpperCase(), slug],
  )
  const id = rows[0]?.id
  if (!id) throw new Error("org not inserted")
  return id
}

export async function insertUser(su: Pool, email: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO users (name, email, email_verified, age_declared_at, age_consent_version)
     VALUES ('', $1, true, now(), $2) RETURNING id`,
    [email, AGE_CONSENT_VERSION],
  )
  const id = rows[0]?.id
  if (!id) throw new Error("user not inserted")
  return id
}

export function reportValues(
  orgId: string,
  userId: string,
  overrides: Partial<typeof reports.$inferInsert> = {},
): typeof reports.$inferInsert {
  return {
    orgId,
    userId,
    publicCode: `T-26-${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
    submissionId: crypto.randomUUID(),
    relation: "self",
    provinceCode: "32",
    regencyCode: "32.73",
    districtCode: "32.73.02",
    title: "Sekolah rusak di Dago",
    story:
      "Atap ruang kelas runtuh dan siswa belajar di halaman sejak sebulan lalu.",
    categoryId: "program",
    subcategoryId: "program.pendidikan",
    occurredOn: "2026-10-01",
    urgency: "medium",
    affectedGroups: ["general_public"],
    affectedCount: "11_100",
    ongoing: "yes",
    contactable: true,
    consents: [
      "age_18_plus",
      "accurate",
      "public_issue",
      "aggregate_processing",
    ],
    consentTextVersion: CONSENT_TEXT_VERSION,
    ...overrides,
  }
}

/** Polls, throws after 20 s. */
export async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 800 && !done(); i++) await Bun.sleep(25)
  if (!done()) throw new Error("until: condition never held")
}
