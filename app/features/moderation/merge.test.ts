import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "../../../db/migrate.ts"
import { reports } from "../../../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import type { ReportStatus } from "../../../shared/status.ts"
import { type MergeInput, runMerge } from "./merge.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const NOW = new Date("2026-10-13T03:00:00Z")
let orgA = ""
let orgB = ""
let reporter = ""
let moderator = ""

async function seedReport(
  status: ReportStatus,
  org = orgA,
  overrides: Partial<typeof reports.$inferInsert> = {},
): Promise<string> {
  const [row] = await suDb
    .insert(reports)
    .values(
      reportValues(org, reporter, {
        status,
        verifiedAt: status === "verified" ? NOW : null,
        ...overrides,
      }),
    )
    .returning({ id: reports.id })
  if (!row) throw new Error("report not inserted")
  return row.id
}

function newIssue(reportIds: string[]): MergeInput {
  return {
    reportIds,
    target: {
      kind: "new",
      title: "Atap sekolah runtuh di Coblong",
      summary: "Beberapa laporan menyebut atap ruang kelas runtuh.",
    },
    actorId: moderator,
    campusCode: "ITB",
    now: NOW,
  }
}

function intoIssue(reportIds: string[], issueId: string): MergeInput {
  return {
    reportIds,
    target: { kind: "existing", issueId },
    actorId: moderator,
    campusCode: "ITB",
    now: NOW,
  }
}

async function issueRow(id: string) {
  const { rows } = await su.query<{
    number: number
    public_code: string
    report_count: number
    verified_report_count: number
    verification_label: string
    district_code: string | null
    version: number
    published_at: Date | null
  }>(
    `SELECT number, public_code, report_count, verified_report_count,
       verification_label, district_code, version, published_at
     FROM issues WHERE id = $1`,
    [id],
  )
  return rows[0]
}

async function statusOf(reportId: string) {
  const { rows } = await su.query<{ status: string }>(
    "SELECT status FROM reports WHERE id = $1",
    [reportId],
  )
  return rows[0]?.status
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  reporter = await insertUser(su, "pelapor.merge@contoh.id")
  moderator = await insertUser(su, "moderator.merge@contoh.id")
})

beforeEach(async () => {
  await su.query("DELETE FROM issue_reports")
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM org_counters")
  await su.query("DELETE FROM reports")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("merge into a new issue", () => {
  test("allocates a number, links the report and sets the label", async () => {
    const reportId = await seedReport("verified")
    const result = await runMerge(orgA, newIssue([reportId]))
    if (!result.ok) throw new Error(result.reason)
    expect(result.code).toBe("ISU-ITB-26-0001")
    expect(result.published).toBe(false)
    const issue = await issueRow(result.issueId)
    expect(issue).toMatchObject({
      number: 1,
      public_code: "ISU-ITB-26-0001",
      report_count: 1,
      verified_report_count: 1,
      verification_label: "verified",
      district_code: null,
      version: 1,
      published_at: null,
    })
    expect(await statusOf(reportId)).toBe("merged")
    const audit = await su.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE org_id = $1 ORDER BY action",
      [orgA],
    )
    expect(audit.rows.map((r) => r.action)).toEqual([
      "issue.create",
      "report.merge",
    ])
  })

  test("the reporter follows the issue and is told once", async () => {
    const reportId = await seedReport("verified")
    const result = await runMerge(orgA, newIssue([reportId]))
    if (!result.ok) throw new Error(result.reason)
    const follows = await su.query(
      "SELECT user_id FROM follows WHERE issue_id = $1",
      [result.issueId],
    )
    expect(follows.rows).toEqual([{ user_id: reporter }])
    const sent = await su.query(
      "SELECT template, user_id FROM notifications WHERE report_id = $1",
      [reportId],
    )
    expect(sent.rows).toEqual([
      { template: "report_merged", user_id: reporter },
    ])
  })

  test("an unverifiable report gives an unverified label", async () => {
    const reportId = await seedReport("unverifiable")
    const result = await runMerge(orgA, newIssue([reportId]))
    if (!result.ok) throw new Error(result.reason)
    expect((await issueRow(result.issueId))?.verification_label).toBe(
      "unverified",
    )
  })

  test("concurrent merges get distinct issue numbers", async () => {
    const ids = await Promise.all([
      seedReport("verified"),
      seedReport("verified"),
      seedReport("verified"),
    ])
    const results = await Promise.all(
      ids.map((id) => runMerge(orgA, newIssue([id]))),
    )
    const codes = results.map((r) => (r.ok ? r.code : r.reason)).sort()
    expect(codes).toEqual([
      "ISU-ITB-26-0001",
      "ISU-ITB-26-0002",
      "ISU-ITB-26-0003",
    ])
  })

  test("one report merged twice at once: one wins, the number stays gapless", async () => {
    const reportId = await seedReport("verified")
    const results = await Promise.all([
      runMerge(orgA, newIssue([reportId])),
      runMerge(orgA, newIssue([reportId])),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)).toEqual({
      ok: false,
      reason: "changed",
    })
    const next = await runMerge(orgA, newIssue([await seedReport("verified")]))
    expect(next.ok && next.code).toBe("ISU-ITB-26-0002")
  })

  test("a report not yet reviewed is refused and nothing is kept", async () => {
    const reportId = await seedReport("in_review")
    const result = await runMerge(orgA, newIssue([reportId]))
    expect(result).toEqual({ ok: false, reason: "changed" })
    expect(await statusOf(reportId)).toBe("in_review")
    const { rows } = await su.query("SELECT 1 FROM issues")
    expect(rows).toHaveLength(0)
  })

  test("the kecamatan is disclosed at five reports", async () => {
    const four = await Promise.all(
      [1, 2, 3, 4].map(() => seedReport("verified")),
    )
    const first = await runMerge(orgA, newIssue(four))
    if (!first.ok) throw new Error(first.reason)
    expect((await issueRow(first.issueId))?.district_code).toBeNull()
    const fifth = await seedReport("unverifiable")
    await runMerge(orgA, intoIssue([fifth], first.issueId))
    expect((await issueRow(first.issueId))?.district_code).toBe("32.73.02")
  })
})

describe("merge into an existing issue", () => {
  test("updates counts and bumps the version", async () => {
    const first = await runMerge(
      orgA,
      newIssue([await seedReport("unverifiable")]),
    )
    if (!first.ok) throw new Error(first.reason)
    const second = await runMerge(
      orgA,
      intoIssue([await seedReport("verified")], first.issueId),
    )
    expect(second).toMatchObject({ ok: true, code: first.code, version: 2 })
    expect(await issueRow(first.issueId)).toMatchObject({
      report_count: 2,
      verified_report_count: 1,
      verification_label: "verified",
      version: 2,
    })
  })

  test("another tenant's issue is not found", async () => {
    const first = await runMerge(orgA, newIssue([await seedReport("verified")]))
    if (!first.ok) throw new Error(first.reason)
    const other = await seedReport("verified", orgB)
    const result = await runMerge(orgB, {
      ...intoIssue([other], first.issueId),
      campusCode: "UGM",
    })
    expect(result).toEqual({ ok: false, reason: "not_found" })
    expect(await statusOf(other)).toBe("verified")
  })

  test("a taken-down issue takes no new reports", async () => {
    const first = await runMerge(orgA, newIssue([await seedReport("verified")]))
    if (!first.ok) throw new Error(first.reason)
    await su.query(
      "UPDATE issues SET taken_down_at = now(), takedown_reason = 'standard_8' WHERE id = $1",
      [first.issueId],
    )
    const late = await seedReport("verified")
    const result = await runMerge(orgA, intoIssue([late], first.issueId))
    expect(result).toEqual({ ok: false, reason: "not_found" })
    expect(await statusOf(late)).toBe("verified")
  })

  test("a closed or confirmed-resolved issue takes no new reports", async () => {
    for (const status of ["closed", "confirmed_resolved"]) {
      const first = await runMerge(
        orgA,
        newIssue([await seedReport("verified")]),
      )
      if (!first.ok) throw new Error(first.reason)
      await su.query("UPDATE issues SET gov_status = $2 WHERE id = $1", [
        first.issueId,
        status,
      ])
      const late = await seedReport("verified")
      const result = await runMerge(orgA, intoIssue([late], first.issueId))
      expect([status, result]).toEqual([
        status,
        { ok: false, reason: "not_found" },
      ])
      expect(await statusOf(late)).toBe("verified")
    }
  })

  test("another tenant's report cannot be merged", async () => {
    const other = await seedReport("verified", orgB)
    const result = await runMerge(orgA, newIssue([other]))
    expect(result).toEqual({ ok: false, reason: "changed" })
    expect(await statusOf(other)).toBe("verified")
  })
})
