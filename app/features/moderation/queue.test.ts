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
import { withTenant } from "../../../db/tenant.server.ts"
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
import { forwardReport } from "../report/forward.server.ts"
import { runMerge } from "./merge.server.ts"
import {
  closeImpact,
  forwardCopyCode,
  getManagedIssue,
  getReviewReport,
  listMergeTargets,
  listQueue,
} from "./queue.server.ts"
import { reviewReport } from "./verify.server.ts"

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

  test("Given a rejected report, when read for review, then the standard and text are shown", async () => {
    const report = await seedReport("in_review")
    const text = "Laporan menyebut nama pegawai. Kirim ulang tanpa nama."
    const result = await withTenant(
      orgA,
      (tx) =>
        reviewReport(
          tx,
          orgA,
          {
            reportId: report.id,
            from: "in_review",
            actorId: reporter,
            action: "reject",
            reason: "standard_4",
            reasonText: text,
          },
          { notify: false },
        ),
      { role: "admin" },
    )
    expect(result.ok).toBe(true)
    const found = await getReviewReport(orgA, "admin", report.code)
    expect(found?.decision).toEqual({
      reason: "standard_4",
      text,
      decidedAt: expect.any(Date),
    })
  })

  test("another tenant's report is not found", async () => {
    const report = await seedReport("in_review")
    expect(await getReviewReport(orgB, "admin", report.code)).toBeNull()
  })
})

describe("forwarded reports", () => {
  test("Given a report forwarded to another campus, when either side reads it, then each names the other and the copy is found", async () => {
    const report = await seedReport("in_review")
    const forwarded = await forwardReport({
      source: { id: orgA, campusCode: "ITB" },
      reportId: report.id,
      targetOrgId: orgB,
      actorId: reporter,
      notify: false,
    })
    if (!forwarded.ok) throw new Error(forwarded.reason)
    const original = await getReviewReport(orgA, "admin", report.code)
    expect(original).toMatchObject({
      status: "forwarded",
      forwardedFrom: null,
      forwardedTo: { id: orgB, name: "ugm" },
    })
    const copy = await getReviewReport(orgB, "admin", forwarded.code)
    expect(copy).toMatchObject({ forwardedFrom: "itb", forwardedTo: null })
    expect(await forwardCopyCode(orgB, report.id)).toBe(forwarded.code)
  })

  test("Given a report never forwarded, when its copy is looked up, then none", async () => {
    const report = await seedReport("in_review")
    expect(await forwardCopyCode(orgB, report.id)).toBeNull()
  })
})

describe("closeImpact", () => {
  async function reportOf(userId: string, status: ReportStatus = "verified") {
    const [row] = await suDb
      .insert(reports)
      .values(reportValues(orgA, userId, { status, verifiedAt: new Date() }))
      .returning({ id: reports.id })
    if (!row) throw new Error("report not inserted")
    return row.id
  }

  test("Given a reporter with two reports, one in an issue, when previewed, then both and the issue are counted", async () => {
    const user = await insertUser(su, `tutup.${crypto.randomUUID()}@contoh.id`)
    const first = await reportOf(user)
    await reportOf(user, "submitted")
    await reportOf(reporter)
    const merged = await runMerge(orgA, {
      reportIds: [first],
      target: {
        kind: "new",
        title: "Atap sekolah runtuh di Coblong",
        summary: "Beberapa laporan menyebut atap ruang kelas runtuh.",
      },
      actorId: reporter,
      campusCode: "ITB",
      now: new Date(),
      notify: false,
    })
    if (!merged.ok) throw new Error(merged.reason)
    expect(await closeImpact(orgA, "admin", first, reporter)).toEqual({
      reports: 2,
      issues: 1,
      staff: false,
    })
  })

  test("Given the admin's own or a colleague's report, when previewed, then it is staff", async () => {
    const editor = await insertUser(
      su,
      `editor.${crypto.randomUUID()}@contoh.id`,
    )
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'editor')",
      [orgA, editor],
    )
    const own = await reportOf(reporter, "submitted")
    expect(await closeImpact(orgA, "admin", own, reporter)).toMatchObject({
      staff: true,
    })
    const colleague = await reportOf(editor, "submitted")
    expect(await closeImpact(orgA, "admin", colleague, reporter)).toMatchObject(
      { staff: true },
    )
  })

  test("Given a report id of no report here, when previewed, then nothing", async () => {
    const report = await seedReport("submitted", orgB)
    expect(await closeImpact(orgA, "admin", report.id, reporter)).toEqual({
      reports: 0,
      issues: 0,
      staff: false,
    })
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
        `ISU-ITB-26-${String(n).padStart(4, "0")}`,
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
    expect(ranked[0]?.code).toBe("ISU-ITB-26-0001")
    const byCode = await listMergeTargets(orgA, "admin", {
      ...report,
      query: "isu-itb-26-0042",
    })
    expect(byCode.map((row) => row.code)).toEqual(["ISU-ITB-26-0042"])
    const byText = await listMergeTargets(orgA, "admin", {
      ...report,
      query: "ruas 17",
    })
    expect(byText[0]?.code).toBe("ISU-ITB-26-0017")
  })
})
