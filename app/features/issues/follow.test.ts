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
import { followIssue, isFollowing, unfollowIssue } from "./follow.server.ts"

const su = superuserPool()
let orgA = ""
let orgB = ""
let user = ""
let published = ""
let draft = ""

async function issue(code: string, publishedAt: Date | null, orgId = orgA) {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
       category_id, subcategory_id, province_code, regency_code, report_count, published_at)
     VALUES ($1, 2026, $2, $3, 'Judul', 'Ringkasan.', 'program', 'program.pendidikan',
       '32', '32.73', 1, $4) RETURNING id`,
    [orgId, Number(code.slice(-4)), code, publishedAt],
  )
  return rows[0]?.id ?? ""
}

async function followRows() {
  const { rows } = await su.query<{ org_id: string; issue_id: string }>(
    "SELECT org_id, issue_id FROM follows WHERE user_id = $1",
    [user],
  )
  return rows
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "fla")
  orgB = await insertOrg(su, "flb")
  user = await insertUser(su, "pengikut@contoh.id")
  published = await issue("ISU-2026-10-0001", new Date())
  draft = await issue("ISU-2026-10-0002", null)
})

beforeEach(async () => {
  await su.query("DELETE FROM follows")
  await su.query("DELETE FROM members")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("follow", () => {
  test("following a published issue adds membership once", async () => {
    expect(await followIssue(orgA, "ISU-2026-10-0001", user)).toBe(true)
    expect(await followIssue(orgA, "ISU-2026-10-0001", user)).toBe(true)
    expect(await followRows()).toEqual([{ org_id: orgA, issue_id: published }])
    expect(await isFollowing(orgA, "ISU-2026-10-0001", user)).toBe(true)
    const { rows } = await su.query(
      "SELECT role FROM members WHERE organization_id = $1 AND user_id = $2",
      [orgA, user],
    )
    expect(rows).toEqual([{ role: "reporter" }])
  })

  test("staff keep their own role", async () => {
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [orgA, user],
    )
    await followIssue(orgA, "ISU-2026-10-0001", user)
    const { rows } = await su.query(
      "SELECT role FROM members WHERE user_id = $1",
      [user],
    )
    expect(rows).toEqual([{ role: "admin" }])
  })

  test("drafts and other tenants cannot be followed", async () => {
    expect(await followIssue(orgA, "ISU-2026-10-0002", user)).toBe(false)
    expect(await followIssue(orgB, "ISU-2026-10-0001", user)).toBe(false)
    expect(await followRows()).toEqual([])
    expect(draft).not.toBe("")
  })

  test("unfollow removes the row, twice is fine", async () => {
    await followIssue(orgA, "ISU-2026-10-0001", user)
    await unfollowIssue(orgA, "ISU-2026-10-0001", user)
    await unfollowIssue(orgA, "ISU-2026-10-0001", user)
    expect(await followRows()).toEqual([])
    expect(await isFollowing(orgA, "ISU-2026-10-0001", user)).toBe(false)
  })

  test("another tenant cannot unfollow", async () => {
    await followIssue(orgA, "ISU-2026-10-0001", user)
    await unfollowIssue(orgB, "ISU-2026-10-0001", user)
    expect(await followRows()).toHaveLength(1)
  })
})
