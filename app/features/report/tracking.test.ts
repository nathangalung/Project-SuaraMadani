import { afterAll, beforeAll, describe, expect, test } from "bun:test"
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
import {
  linkedReport,
  listOwnReports,
  reportCodeExists,
} from "./tracking.server.ts"

const su = superuserPool()
let orgA = ""
let orgB = ""
let userA = ""
let userB = ""
let mineId = ""

async function addReport(org: string, user: string, title: string) {
  const [row] = await withTenant(org, (tx) =>
    tx
      .insert(reports)
      .values(reportValues(org, user, { title }))
      .returning({ id: reports.id }),
  )
  return row?.id ?? ""
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "tra")
  orgB = await insertOrg(su, "trb")
  userA = await insertUser(su, "lacak.a@contoh.id")
  userB = await insertUser(su, "lacak.b@contoh.id")
  const mine = await addReport(orgA, userA, "Laporan milik A")
  mineId = mine
  await addReport(orgA, userB, "Laporan milik B")
  await addReport(orgB, userA, "Laporan A di kampus lain")
  await withTenant(orgA, (tx) =>
    tx.insert(evidence).values([
      {
        orgId: orgA,
        reportId: mine,
        position: 0,
        kind: "image",
        declaredName: "a.png",
        declaredType: "image/png",
        declaredSize: 10,
        status: "ready",
      },
      {
        orgId: orgA,
        reportId: mine,
        position: 1,
        kind: "image",
        declaredName: "b.png",
        declaredType: "image/png",
        declaredSize: 10,
      },
    ]),
  )
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("linkedReport", () => {
  test("a signed link shows that one report", async () => {
    const found = await linkedReport(orgA, mineId, userA)
    expect(found?.title).toBe("Laporan milik A")
    expect(found?.evidence).toEqual(["ready", "awaiting_upload"])
  })

  test("another user or campus sees nothing", async () => {
    expect(await linkedReport(orgA, mineId, userB)).toBe(null)
    expect(await linkedReport(orgB, mineId, userA)).toBe(null)
  })
})

describe("listOwnReports", () => {
  test("shows only this user's reports at this campus", async () => {
    const { reports: rows, pageCount } = await listOwnReports(orgA, userA)
    expect(pageCount).toBe(1)
    expect(rows.map((r) => r.title)).toEqual(["Laporan milik A"])
    expect(rows[0]?.status).toBe("submitted")
    expect(rows[0]?.evidence).toEqual(["ready", "awaiting_upload"])
  })

  test("empty for a user without reports", async () => {
    expect(await listOwnReports(orgB, userB)).toEqual({
      reports: [],
      page: 1,
      pageCount: 1,
    })
  })

  test("a merge shows the issue code only once public", async () => {
    const user = await insertUser(su, "lacak.gabung@contoh.id")
    const shown = await addReport(orgB, user, "Digabung ke isu terbit")
    const hidden = await addReport(orgB, user, "Digabung ke isu draf")
    const { rows } = await su.query<{ id: string; public_code: string }>(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary, category_id, subcategory_id, province_code, regency_code, published_at)
       VALUES ($1, 2026, 1, 'ISU-2026-10-0001', 'Terbit', 'Ringkasan isu terbit.', 'program', 'program.infrastruktur', '32', '32.73', now()),
              ($1, 2026, 2, 'ISU-2026-10-0002', 'Draf', 'Ringkasan isu draf.', 'program', 'program.infrastruktur', '32', '32.73', NULL)
       RETURNING id, public_code`,
      [orgB],
    )
    const issueOf = (code: string) =>
      rows.find((row) => row.public_code === code)?.id
    await su.query(
      "INSERT INTO issue_reports (org_id, issue_id, report_id) VALUES ($1, $2, $3), ($1, $4, $5)",
      [
        orgB,
        issueOf("ISU-2026-10-0001"),
        shown,
        issueOf("ISU-2026-10-0002"),
        hidden,
      ],
    )
    const { reports: list } = await listOwnReports(orgB, user)
    const byTitle = new Map(list.map((r) => [r.title, r.merged]))
    expect(byTitle.get("Digabung ke isu terbit")?.code).toBe("ISU-2026-10-0001")
    expect(byTitle.get("Digabung ke isu draf")?.code).toBeNull()
    expect(byTitle.get("Digabung ke isu draf")?.at).toBeInstanceOf(Date)
    const [plain] = (await listOwnReports(orgA, userA)).reports
    expect(plain?.merged).toBeNull()
  })

  test("three per page, newest first", async () => {
    const user = await insertUser(su, "lacak.banyak@contoh.id")
    await withTenant(orgA, (tx) =>
      tx.insert(reports).values(
        Array.from({ length: 7 }, (_, i) =>
          reportValues(orgA, user, {
            title: `Laporan ke-${i}`,
            createdAt: new Date(Date.UTC(2026, 9, 1 + i)),
          }),
        ),
      ),
    )
    const first = await listOwnReports(orgA, user)
    expect(first.pageCount).toBe(3)
    expect(first.reports.map((r) => r.title)).toEqual([
      "Laporan ke-6",
      "Laporan ke-5",
      "Laporan ke-4",
    ])
    const last = await listOwnReports(orgA, user, 3)
    expect(last.reports.map((r) => r.title)).toEqual(["Laporan ke-0"])
    const past = await listOwnReports(orgA, user, 4)
    expect(past.reports).toEqual([])
  })
})

describe("reportCodeExists", () => {
  test("finds a sent code at its own campus only", async () => {
    const code = "TRA-26-7K3QX"
    await withTenant(orgA, (tx) =>
      tx
        .insert(reports)
        .values(reportValues(orgA, userA, { publicCode: code })),
    )
    expect(await reportCodeExists(orgA, code)).toBe(true)
    expect(await reportCodeExists(orgA, "TRA-26-ZZZZZ")).toBe(false)
    expect(await reportCodeExists(orgB, code)).toBe(false)
  })
})

describe("decisions and forwards", () => {
  test("a decided report shows its latest text to the reporter", async () => {
    const id = await addReport(orgA, userA, "Laporan yang ditolak")
    await su.query("UPDATE reports SET status = 'rejected' WHERE id = $1", [id])
    // Free text, no code
    await su.query(
      `INSERT INTO moderation_decisions (org_id, report_id, action, reason_code, reason_text)
       VALUES ($1, $2, 'reject', NULL, 'Sudah ada laporan yang sama.')`,
      [orgA, id],
    )
    const found = await linkedReport(orgA, id, userA)
    expect(found?.decision).toEqual({ text: "Sudah ada laporan yang sama." })
  })
})

describe("pending uploads", () => {
  test("lists files still awaiting upload inside the window", async () => {
    const { reports: own } = await listOwnReports(orgA, userA)
    const mine = own.find((r) => r.title === "Laporan milik A")
    expect(mine?.pendingUploads).toEqual([
      {
        id: expect.any(String),
        position: 1,
        name: "b.png",
        kind: "image",
        size: 10,
      },
    ])
    expect(mine?.uploadUntil?.getTime()).toBe(
      (mine?.createdAt.getTime() ?? 0) + 24 * 60 * 60 * 1000,
    )
  })

  test("a forwarded report asks for nothing here", async () => {
    await su.query(
      "UPDATE reports SET status = 'forwarded', forwarded_to_org_id = $2 WHERE id = $1",
      [mineId, orgB],
    )
    try {
      const { reports: own } = await listOwnReports(orgA, userA)
      const mine = own.find((r) => r.title === "Laporan milik A")
      expect(mine?.pendingUploads).toEqual([])
      expect(mine?.uploadUntil).toBeNull()
    } finally {
      await su.query(
        "UPDATE reports SET status = 'submitted', forwarded_to_org_id = NULL WHERE id = $1",
        [mineId],
      )
    }
  })

  test("after 24 hours nothing can be sent", async () => {
    await su.query(
      "UPDATE reports SET created_at = now() - interval '25 hours' WHERE id = $1",
      [mineId],
    )
    try {
      const { reports: own } = await listOwnReports(orgA, userA)
      const mine = own.find((r) => r.title === "Laporan milik A")
      expect(mine?.pendingUploads).toEqual([])
      expect(mine?.uploadUntil).toBeNull()
    } finally {
      await su.query("UPDATE reports SET created_at = now() WHERE id = $1", [
        mineId,
      ])
    }
  })
})
