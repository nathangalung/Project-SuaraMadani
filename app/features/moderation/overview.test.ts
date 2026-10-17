import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { listManagedIssues, readManageSummary } from "./overview.server.ts"

const su = superuserPool()
const NOW = new Date("2026-10-15T03:00:00Z")
let orgA = ""
let orgB = ""
let reporter = ""
let number = 0

async function report(org: string, status: string, forwarded = false) {
  await su.query(
    `INSERT INTO reports (org_id, user_id, public_code, submission_id, status, relation,
       province_code, regency_code, district_code, title, story, category_id,
       subcategory_id, occurred_on, urgency, affected_groups, affected_count,
       ongoing, contactable, consents, consent_text_version, created_at,
       forwarded_from_org_id, forwarded_from_report_id)
     VALUES ($1, $2, 'T-' || gen_random_uuid(), gen_random_uuid(), $3, 'self', '32', '32.73',
       '32.73.02', 'Judul laporan uji', 'Cerita laporan uji yang cukup panjang untuk lolos.',
       'program', 'program.pendidikan', '2026-10-01', 'medium', '{general_public}', '11_100',
       'yes', false, '{age_18_plus,accurate,public_issue,aggregate_processing}', 'v1',
       $4, $5, $6)`,
    [
      org,
      reporter,
      status,
      new Date(NOW.getTime() - 3 * 86_400_000),
      forwarded ? orgB : null,
      forwarded ? crypto.randomUUID() : null,
    ],
  )
}

async function issue(
  org: string,
  values: {
    published?: boolean
    takenDown?: boolean
    advocacy?: string
    gov?: string
    deadline?: string
  },
) {
  number++
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary, category_id,
       subcategory_id, province_code, regency_code, advocacy_status, gov_status,
       report_count, published_at, taken_down_at, takedown_reason)
     VALUES ($1, 2026, $2::int, 'ISU-T-26-' || $2::text, 'Judul isu uji', 'Ringkasan isu uji.',
       'program', 'program.pendidikan', '32', '32.73', $3, $4, 1, $5, $6, $7) RETURNING id`,
    [
      org,
      number,
      values.advocacy ?? "monitoring",
      values.gov ?? "awaiting_response",
      values.published === false || values.takenDown ? null : NOW,
      values.takenDown ? NOW : null,
      values.takenDown ? "standard_8" : null,
    ],
  )
  const id = rows[0]?.id
  if (values.deadline) {
    await su.query(
      `INSERT INTO referrals (org_id, issue_id, kind, agency, channel, sent_on, deadline_on)
       VALUES ($1, $2, 'referral', 'Dinas Uji', 'agency_service', '2026-09-01', $3)`,
      [org, id, values.deadline],
    )
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "ova")
  orgB = await insertOrg(su, "ovb")
  reporter = await insertUser(su, "pelapor.overview@contoh.id")
})

beforeEach(async () => {
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM reports")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("readManageSummary", () => {
  test("counts the queue and what needs action, this campus only", async () => {
    await report(orgA, "submitted")
    await report(orgA, "in_review", true)
    await report(orgA, "verified")
    await report(orgA, "rejected")
    await report(orgB, "submitted")
    await issue(orgA, { published: false })
    // Removed, never a draft
    await issue(orgA, { takenDown: true })
    await issue(orgA, {})
    await issue(orgA, { advocacy: "referred", deadline: "2026-10-14" })
    await issue(orgA, { advocacy: "referred", deadline: "2026-10-15" })
    await issue(orgA, { advocacy: "referred", gov: "claimed_resolved" })
    await issue(orgB, {})

    const summary = await readManageSummary(orgA, "admin", NOW)

    expect(summary.counts).toEqual({
      submitted: 1,
      in_review: 1,
      verified: 1,
      unverifiable: 0,
    })
    expect(summary.forwardedIn).toBe(1)
    expect(summary.oldestWaiting).toBeInstanceOf(Date)
    expect(summary.needs).toEqual({
      draf: 1,
      "belum-diteruskan": 1,
      "lewat-tenggat": 1,
      klaim: 1,
    })
  })
})

describe("listManagedIssues", () => {
  test("filters by need and includes drafts", async () => {
    await issue(orgA, { published: false })
    await issue(orgA, { takenDown: true })
    await issue(orgA, { advocacy: "referred", deadline: "2026-10-01" })
    await issue(orgB, { published: false })
    const all = await listManagedIssues(orgA, "admin", null, NOW)
    expect(all).toHaveLength(3)
    expect(all.filter((row) => row.takenDown)).toHaveLength(1)
    const drafts = await listManagedIssues(orgA, "admin", "draf", NOW)
    expect(drafts.map((row) => [row.published, row.takenDown])).toEqual([
      [false, false],
    ])
    const late = await listManagedIssues(orgA, "admin", "lewat-tenggat", NOW)
    expect(late).toHaveLength(1)
  })
})
