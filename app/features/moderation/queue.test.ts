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
import { evidence, reports } from "../../../db/schema/reports.ts"
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
import { runMerge } from "./merge.server.ts"
import {
  getManagedIssue,
  getReviewReport,
  listMergeTargets,
  listQueue,
} from "./queue.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
let orgA = ""
let orgB = ""
let reporter = ""

async function seedReport(status: ReportStatus, org = orgA) {
  const values = reportValues(org, reporter, {
    status,
    verifiedAt: status === "verified" ? new Date() : null,
  })
  const [row] = await suDb
    .insert(reports)
    .values(values)
    .returning({ id: reports.id, code: reports.publicCode })
  if (!row) throw new Error("report not inserted")
  return row
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  reporter = await insertUser(su, "pelapor.queue@contoh.id")
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

describe("listQueue", () => {
  test("lists open reports of this tenant, oldest first", async () => {
    const first = await seedReport("submitted")
    const second = await seedReport("verified")
    await seedReport("rejected")
    await seedReport("submitted", orgB)
    const rows = await listQueue(orgA, "admin")
    expect(rows.map((r) => r.code)).toEqual([first.code, second.code])
  })

  test("counts files and ready previews", async () => {
    const report = await seedReport("submitted")
    await suDb.insert(evidence).values([
      { ...file(report.id, 0), status: "ready" },
      { ...file(report.id, 1), status: "awaiting_upload" },
    ])
    const [row] = await listQueue(orgA, "admin")
    expect(row).toMatchObject({ files: 2, ready: 1 })
  })
})

function file(reportId: string, position: number) {
  return {
    orgId: orgA,
    reportId,
    position,
    kind: "image" as const,
    declaredName: `foto-${position}.jpg`,
    declaredType: "image/jpeg",
    declaredSize: 1000,
  }
}

describe("getReviewReport", () => {
  test("returns the report with region names and evidence", async () => {
    const report = await seedReport("in_review")
    await suDb
      .insert(evidence)
      .values({ ...file(report.id, 0), status: "ready" })
    const found = await getReviewReport(orgA, "admin", report.code)
    expect(found).toMatchObject({
      id: report.id,
      code: report.code,
      status: "in_review",
      regencyName: "Kota Bandung",
      districtName: "Coblong",
      issue: null,
    })
    expect(found?.evidence).toEqual([
      expect.objectContaining({ position: 0, status: "ready" }),
    ])
  })

  test("names the issue a merged report belongs to", async () => {
    const report = await seedReport("verified")
    const merged = await runMerge(orgA, {
      reportIds: [report.id],
      target: {
        kind: "new",
        title: "Atap sekolah runtuh di Coblong",
        summary: "Beberapa laporan menyebut atap ruang kelas runtuh.",
      },
      actorId: reporter,
      campusCode: "ITB",
      now: new Date(),
    })
    if (!merged.ok) throw new Error(merged.reason)
    const found = await getReviewReport(orgA, "admin", report.code)
    expect(found?.issue?.code).toBe(merged.code)
    const near = { regencyCode: "32.73", title: "Sekolah rusak di Dago" }
    const targets = await listMergeTargets(orgA, "admin", near)
    expect(targets.map((t) => t.code)).toEqual([merged.code])
    expect(await listMergeTargets(orgB, "admin", near)).toEqual([])
    // Removed issues stay down
    await su.query(
      "UPDATE issues SET taken_down_at = now(), takedown_reason = 'standard_8' WHERE public_code = $1",
      [merged.code],
    )
    expect(await listMergeTargets(orgA, "admin", near)).toEqual([])
    await su.query(
      "UPDATE issues SET taken_down_at = NULL, takedown_reason = NULL WHERE public_code = $1",
      [merged.code],
    )
    // Terminal issues take no reports
    await su.query(
      "UPDATE issues SET gov_status = 'closed' WHERE public_code = $1",
      [merged.code],
    )
    expect(await listMergeTargets(orgA, "admin", near)).toEqual([])
    await su.query(
      "UPDATE issues SET gov_status = 'awaiting_response' WHERE public_code = $1",
      [merged.code],
    )
    const issue = await getManagedIssue(orgA, "admin", merged.code)
    expect(issue).toMatchObject({
      code: merged.code,
      publishedAt: null,
      reportCount: 1,
      reports: [{ code: report.code, title: "Sekolah rusak di Dago" }],
    })
    expect(await getManagedIssue(orgB, "admin", merged.code)).toBeNull()
  })

  test("another tenant's report is not found", async () => {
    const report = await seedReport("in_review")
    expect(await getReviewReport(orgB, "admin", report.code)).toBeNull()
  })
})

describe("listMergeTargets", () => {
  async function issue(
    n: number,
    title: string,
    regency: string,
    daysAgo: number,
  ) {
    await su.query(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary,
         category_id, subcategory_id, province_code, regency_code,
         gov_status, advocacy_status, report_count, last_activity_at)
       VALUES ($1, 2026, $2, $3, $4, 'Ringkasan.', 'program', 'program.pendidikan',
         '32', $5, 'awaiting_response', 'monitoring', 1, now() - make_interval(days => $6))`,
      [
        orgA,
        n,
        `ISU-2026-10-${String(n).padStart(4, "0")}`,
        title,
        regency,
        daysAgo,
      ],
    )
  }

  test("ranks same regency and similar title above recency", async () => {
    await su.query(
      "INSERT INTO regions (code, parent_code, level, name) VALUES ('32.04', '32', 2, 'Kabupaten Bandung') ON CONFLICT DO NOTHING",
    )
    await issue(1, "Sekolah rusak di Dago, atap bocor", "32.73", 400)
    for (let n = 2; n <= 61; n++) {
      await issue(n, `Jalan berlubang ruas ${n}`, "32.04", 1)
    }
    const report = { regencyCode: "32.73", title: "Sekolah rusak di Dago" }
    const ranked = await listMergeTargets(orgA, "admin", report)
    expect(ranked).toHaveLength(50)
    expect(ranked[0]?.code).toBe("ISU-2026-10-0001")
    const byCode = await listMergeTargets(orgA, "admin", {
      ...report,
      query: "isu-2026-10-0042",
    })
    expect(byCode.map((row) => row.code)).toEqual(["ISU-2026-10-0042"])
    const byText = await listMergeTargets(orgA, "admin", {
      ...report,
      query: "ruas 17",
    })
    expect(byText[0]?.code).toBe("ISU-2026-10-0017")
  })
})
