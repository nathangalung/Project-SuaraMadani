import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { schema } from "../../../db/client.server.ts"
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
import type { PurgeClient } from "../../../server/purge.server.ts"
import { refreshDashboards } from "../../../worker/aggregates.ts"
import { readDashboard } from "../data/dashboard.server.ts"
import { listPublishedDemands } from "../demands/demands.server.ts"
import { runMerge } from "../moderation/merge.server.ts"
import {
  getIssuePage,
  getPublishedIssue,
  listIssueRanking,
  listLatestIssues,
  listPublishedIssues,
} from "./issues.server.ts"
import { runPublish } from "./publish.server.ts"

// wf8 item 3: verify first
const su = superuserPool()
const suDb = drizzle({ client: su, schema })
const appPool = new Pool({
  connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
  max: 2,
  options: "-c role=sb_app",
})
const appDb = drizzle({ client: appPool, schema })
const NOW = new Date("2026-10-14T03:00:00Z")
const SECRET = "Lelucon tiang listrik terbang"
const NO_PURGE: PurgeClient = {
  purgeUrls: async () => ({ skipped: true }),
  purgeHosts: async () => ({ skipped: true }),
}
let orgId = ""
let admin = ""
let pending: string[] = []

async function report(
  overrides: Partial<typeof reports.$inferInsert>,
): Promise<string> {
  const user = await insertUser(su, `w${crypto.randomUUID()}@contoh.id`)
  const [row] = await suDb
    .insert(reports)
    .values(reportValues(orgId, user, overrides))
    .returning({ id: reports.id })
  if (!row) throw new Error("no report")
  return row.id
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  await su.query(
    `INSERT INTO regions (code, parent_code, level, name) VALUES
       ('34', NULL, 1, 'DI Yogyakarta'), ('34.71', '34', 2, 'Kota Yogyakarta'),
       ('34.71.01', '34.71', 3, 'Mantrijeron')
     ON CONFLICT DO NOTHING`,
  )
  orgId = await insertOrg(su, "vfa")
  admin = await insertUser(su, "admin.verifikasi@contoh.id")
  // Unchecked: submitted, reviewing, rejected
  pending = [
    await report({
      title: SECRET,
      story: `${SECRET}, katanya terbang ke rumah tetangga.`,
      provinceCode: "34",
      regencyCode: "34.71",
      districtCode: "34.71.01",
    }),
    await report({ title: `${SECRET} kedua`, status: "in_review" }),
    await report({ title: `${SECRET} ketiga`, status: "rejected" }),
  ]
  const verified = await report({ status: "verified", verifiedAt: NOW })
  const merged = await runMerge(orgId, {
    reportIds: [verified],
    target: {
      kind: "new",
      title: "Atap sekolah runtuh di Coblong",
      summary: "Atap ruang kelas runtuh dan siswa belajar di halaman.",
    },
    actorId: admin,
    campusCode: "VFA",
    now: NOW,
  })
  if (!merged.ok) throw new Error(merged.reason)
  await runPublish(
    { id: orgId, host: "vfa.localhost" },
    { issueId: merged.issueId, actorId: admin, notify: false },
    { purge: NO_PURGE },
  )
  await refreshDashboards(appDb, { now: () => NOW })
})

afterAll(async () => {
  await resetData(su)
  await appPool.end()
  await su.end()
})

describe("verify first", () => {
  test("an unchecked report cannot be merged", async () => {
    const result = await runMerge(orgId, {
      reportIds: [pending[0] ?? ""],
      target: {
        kind: "new",
        title: "Tiang listrik terbang di Yogyakarta",
        summary: "Laporan yang belum diperiksa admin.",
      },
      actorId: admin,
      campusCode: "VFA",
      now: NOW,
    })
    expect(result.ok).toBe(false)
  })

  test("lists, search and showcases hold no unchecked text", async () => {
    const all = await listPublishedIssues(orgId, {})
    const search = await listPublishedIssues(orgId, { q: "tiang listrik" })
    const showcases = await listLatestIssues(orgId)
    const ranking = await listIssueRanking(orgId, "laporan", NOW)
    const text = JSON.stringify([all, search, showcases, ranking])
    expect(text).not.toContain(SECRET)
    expect(search).toMatchObject({ kind: "results", issues: [] })
    if (all.kind !== "results") throw new Error(all.kind)
    expect(all.issues.map((issue) => issue.reportCount)).toEqual([1])
  })

  test("detail and OG reads exist only for published issues", async () => {
    expect(await getIssuePage(orgId, "ISU-VFA-26-0002")).toBeNull()
    expect(await getPublishedIssue(orgId, "ISU-VFA-26-0002")).toBeNull()
    const page = await getIssuePage(orgId, "ISU-VFA-26-0001")
    expect(JSON.stringify(page)).not.toContain(SECRET)
  })

  test("the map counts only verified reports in issues", async () => {
    const dashboard = await readDashboard(orgId, {})
    if (dashboard.kind !== "ready") throw new Error(dashboard.kind)
    expect(JSON.stringify(dashboard)).not.toContain(SECRET)
    const cell = (code: string) =>
      dashboard.map.regions.find((region) => region.code === code)?.count
    // Unchecked report sat in 34
    expect(cell("34") ?? 0).toBe(0)
  })

  test("received counts may include it, text never", async () => {
    const dashboard = await readDashboard(orgId, {})
    if (dashboard.kind !== "ready") throw new Error(dashboard.kind)
    // PLAN §5.8: received total public
    expect(JSON.stringify(dashboard.summary)).not.toContain(SECRET)
  })

  test("tuntutan never come from reports", async () => {
    const demands = await listPublishedDemands(orgId, {})
    expect(demands).toMatchObject({ kind: "results", demands: [] })
  })
})
