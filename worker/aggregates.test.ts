import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { schema } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import { dashboardSnapshots } from "../db/schema/dashboard.ts"
import { reports } from "../db/schema/reports.ts"
import { withTenant } from "../db/tenant.server.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import type { DashboardSnapshot } from "../shared/dashboard.ts"
import type { GovernmentStatus } from "../shared/status.ts"
import {
  createAggregateHandler,
  refreshDashboards,
  summarizeIssues,
  summarizeResponses,
} from "./aggregates.ts"

const su = superuserPool()
// Runs as sm_app, real grants
const appPool = new Pool({
  connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
  max: 2,
  options: "-c role=sm_app",
})
const appDb = drizzle({ client: appPool, schema })
const suDb = drizzle({ client: su, schema })

const NOW = new Date("2026-10-14T03:00:00Z")
let orgA = ""
let orgB = ""
let issueNumber = 0
let userId = ""

async function insertIssue(
  orgId: string,
  fields: {
    category: "program" | "bencana" | "bansos"
    province: "32" | "34"
    gov?: GovernmentStatus
    reportCount?: number
    verified?: number
    published?: boolean
  },
) {
  issueNumber++
  const sub = {
    program: "program.pendidikan",
    bencana: "bencana.banjir",
    bansos: "bansos.bantuan_pangan",
  }[fields.category]
  await su.query(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
      category_id, subcategory_id, province_code, regency_code, gov_status,
      report_count, verified_report_count, published_at)
     VALUES ($1, 2026, $2, $3, 'Isu uji', 'Ringkasan', $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      orgId,
      issueNumber,
      `T-${issueNumber}`,
      fields.category,
      sub,
      fields.province,
      fields.province === "32" ? "32.73" : "34.04",
      fields.gov ?? "awaiting_response",
      fields.reportCount ?? 1,
      fields.verified ?? fields.reportCount ?? 1,
      fields.published === false ? null : NOW,
    ],
  )
}

async function snapshotOf(orgId: string): Promise<DashboardSnapshot> {
  const [row] = await suDb
    .select()
    .from(dashboardSnapshots)
    .where(eq(dashboardSnapshots.orgId, orgId))
  if (!row) throw new Error("no snapshot")
  return row.data
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  for (const [code, parent, level, name] of [
    ["34", null, 1, "Daerah Istimewa Yogyakarta"],
    ["34.04", "34", 2, "Kabupaten Sleman"],
  ] as const) {
    await su.query(
      "INSERT INTO regions (code, parent_code, level, name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [code, parent, level, name],
    )
  }
  orgA = await insertOrg(su, "agga")
  orgB = await insertOrg(su, "aggb")
  const user = await insertUser(su, "agg@example.test")
  userId = user
  // 5 verified, 2 other states
  const created = new Date("2026-10-01T03:00:00Z")
  for (let i = 0; i < 7; i++) {
    const status = i < 5 ? "merged" : i === 5 ? "rejected" : "submitted"
    await suDb.insert(reports).values(
      reportValues(orgA, user, {
        status,
        createdAt: created,
        verifiedAt:
          i < 5 ? new Date(created.getTime() + (i + 1) * 3_600_000) : null,
      }),
    )
  }
  for (let i = 0; i < 6; i++) {
    await insertIssue(orgA, {
      category: "program",
      province: "32",
      reportCount: 2,
      verified: i === 0 ? 0 : 2,
    })
  }
  for (let i = 0; i < 3; i++) {
    await insertIssue(orgA, {
      category: "bencana",
      province: "34",
      gov: "claimed_resolved",
    })
  }
  await insertIssue(orgA, {
    category: "bansos",
    province: "32",
    published: false,
  })
  await insertIssue(orgB, { category: "bansos", province: "34" })
})

afterAll(async () => {
  await resetData(su)
  await appPool.end()
  await su.end()
})

describe("aggregate refresh as sm_app", () => {
  test("writes one snapshot per org", async () => {
    const result = await refreshDashboards(appDb, { now: () => NOW })
    expect(result).toEqual({ orgs: 2, failed: 0 })
    const { rows } = await su.query(
      "SELECT org_id FROM dashboard_snapshots ORDER BY org_id",
    )
    expect(rows).toHaveLength(2)
  })

  test("then refreshes the national view", async () => {
    const { rows } = await su.query<{ issues: number | null }>(
      "SELECT issues FROM national_aggregates WHERE dimension = 'campus' AND key = $1",
      [orgA],
    )
    expect(rows).toEqual([{ issues: 9 }])
  })

  test("counts only the org's own rows", async () => {
    const a = await snapshotOf(orgA)
    const b = await snapshotOf(orgB)
    expect(a.reports).toEqual({
      total: 7,
      decided: 6,
      verified: 5,
      verifiedShare: 5 / 6,
      queue: 1,
    })
    expect(a.issues.published).toBe(9)
    expect(a.issues.mergedReports).toBe(15)
    expect(b.reports.total).toBe(0)
    expect(b.issues.published).toBe(1)
  })

  test("unreferred waiting issues complete the /isu set", async () => {
    // Default state, never referred
    expect((await snapshotOf(orgA)).response.unreferred).toBe(6)
    expect((await snapshotOf(orgB)).response.unreferred).toBe(1)
  })

  test("issue cells are exact, zero kept", async () => {
    const a = await snapshotOf(orgA)
    expect(a.categories).toEqual({ program: 6, bencana: 3, bansos: 0 })
    expect(a.statuses.awaiting_response).toBe(6)
    expect(a.statuses.claimed_resolved).toBe(3)
    expect(a.statuses.confirmed_resolved).toBe(0)
    expect(a.resolution.confirmedShare).toBeNull()
  })

  test("map cells count verified reports, 1–4 hidden", async () => {
    const a = await snapshotOf(orgA)
    // Unverified merged reports excluded
    expect(a.verifiedProvinces["all|all"]).toEqual({ "32": 10, "34": null })
    expect(a.verifiedProvinces["program|awaiting_response"]).toEqual({
      "32": 10,
    })
    expect(a.verifiedProvinceTotals["all|all"]).toBe(13)
    expect(a.verifiedProvinceTotals["bencana|all"]).toBeNull()
    // Unpublished issue never counted
    expect(a.verifiedProvinces["bansos|all"]).toEqual({})
    expect(a.verifiedProvinceTotals["bansos|all"]).toBe(0)
  })

  test("verification time from n of 5", async () => {
    const a = await snapshotOf(orgA)
    expect(a.verifyTime).toEqual({ n: 5, medianHours: 3, p90Hours: 4.6 })
    expect((await snapshotOf(orgB)).verifyTime.medianHours).toBeNull()
  })

  test("trend buckets Jakarta months", async () => {
    const a = await snapshotOf(orgA)
    expect(a.trend).toHaveLength(12)
    expect(a.trend.at(-1)).toEqual({
      month: "2026-10",
      received: 7,
      verified: 5,
    })
    expect(a.trend[0]?.received).toBe(0)
    expect(a.trendTotal).toBe(7)
  })

  test("months, total and first day are exact", async () => {
    // September 2 reports, 00:30 WIB
    const orgC = await insertOrg(su, "aggc")
    await suDb.insert(reports).values(
      [0, 1].map(() =>
        reportValues(orgC, userId, {
          status: "submitted",
          createdAt: new Date("2026-09-09T17:30:00Z"),
        }),
      ),
    )
    for (let i = 0; i < 7; i++) {
      await suDb.insert(reports).values(
        reportValues(orgC, userId, {
          status: "submitted",
          createdAt: new Date("2026-10-02T03:00:00Z"),
        }),
      )
    }
    await refreshDashboards(appDb, { now: () => NOW })
    const c = await snapshotOf(orgC)
    const received = c.trend.map((point) => point.received)
    expect(received.slice(-2)).toEqual([2, 7])
    expect(received.reduce((sum, n) => sum + n, 0)).toBe(c.trendTotal)
    expect(c.trendTotal).toBe(c.reports.total)
    // Jakarta day, no time
    expect(c.firstReportAt).toBe("2026-09-10")
  })

  test("another tenant cannot read the snapshot", async () => {
    const seen = await withTenant(
      orgB,
      (tx) =>
        tx.select({ org: dashboardSnapshots.orgId }).from(dashboardSnapshots),
      { db: appDb },
    )
    expect(seen).toEqual([{ org: orgB }])
  })

  test("a refresh replaces the row in place", async () => {
    const later = new Date(NOW.getTime() + 900_000)
    await refreshDashboards(appDb, { now: () => later })
    const { rows } = await su.query<{ computed_at: Date }>(
      "SELECT computed_at FROM dashboard_snapshots WHERE org_id = $1",
      [orgA],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.computed_at.getTime()).toBe(later.getTime())
  })

  test("an older run never replaces a newer row", async () => {
    await refreshDashboards(appDb, { now: () => NOW })
    const { rows } = await su.query<{ computed_at: Date }>(
      "SELECT computed_at FROM dashboard_snapshots",
    )
    for (const row of rows) {
      expect(row.computed_at.getTime()).toBeGreaterThan(NOW.getTime())
    }
  })

  test("an aborted job stops before the next org", async () => {
    const handler = createAggregateHandler({ db: appDb })
    const controller = new AbortController()
    controller.abort()
    await su.query("DELETE FROM dashboard_snapshots WHERE org_id = $1", [orgB])
    await expect(handler({}, controller.signal)).rejects.toThrow()
    const { rows } = await su.query(
      "SELECT 1 FROM dashboard_snapshots WHERE org_id = $1",
      [orgB],
    )
    expect(rows).toHaveLength(0)
  })

  test("one snapshot per org, commits mid-run unseen", async () => {
    // Blocks the issue query
    const blocker = await su.connect()
    const blockerDb = drizzle({ client: blocker, schema })
    const orgIds = (
      await su.query<{ id: string }>("SELECT id FROM organizations")
    ).rows
    try {
      await blocker.query("BEGIN")
      await blocker.query("LOCK TABLE issues IN ACCESS EXCLUSIVE MODE")
      const run = refreshDashboards(appDb, {
        now: () => new Date(NOW.getTime() + 1_800_000),
      })
      for (let waited = 0; ; waited++) {
        const { rows } = await su.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM issues%'",
        )
        if (rows.length > 0) break
        if (waited > 200) throw new Error("refresh never blocked")
        await Bun.sleep(25)
      }
      for (const { id } of orgIds) {
        await blockerDb.insert(reports).values(
          reportValues(id, userId, {
            status: "submitted",
            createdAt: new Date("2026-10-03T03:00:00Z"),
          }),
        )
      }
      await blocker.query("COMMIT")
      await run
    } finally {
      blocker.release()
    }
    for (const { id } of orgIds) {
      const snapshot = await snapshotOf(id)
      expect(snapshot.trendTotal).toBe(snapshot.reports.total)
    }
  })
})

describe("summarizeIssues", () => {
  test("resolution share needs 5 claims", () => {
    const groups = (gov: GovernmentStatus, n: number) => ({
      category_id: "program",
      gov_status: gov,
      province_code: "32",
      n,
      verified: n,
    })
    const few = summarizeIssues([groups("confirmed_resolved", 4)])
    expect(few.resolution.confirmedShare).toBeNull()
    const enough = summarizeIssues([
      groups("confirmed_resolved", 6),
      groups("claimed_resolved", 2),
    ])
    // Issue counts are public, exact
    expect(enough.resolution).toEqual({
      pending: 2,
      confirmed: 6,
      reopened: 0,
      claimTotal: 8,
      checked: 6,
      confirmedShare: 1,
    })
    expect(enough.verifiedProvinces["program|confirmed_resolved"]).toEqual({
      "32": 6,
    })
  })

  test("breakdowns are exact, like /isu", () => {
    const { statuses, categories, verifiedProvinces, verifiedProvinceTotals } =
      summarizeIssues([
        {
          category_id: "program",
          gov_status: "claimed_resolved",
          province_code: "32",
          n: 2,
          verified: 7,
        },
      ])
    expect(statuses.claimed_resolved).toBe(2)
    expect(categories.program).toBe(2)
    // Report cells, not issue counts
    expect(verifiedProvinces["all|all"]).toEqual({ "32": 7 })
    expect(verifiedProvinceTotals["all|all"]).toBe(7)
  })

  test("reopened claims lower the confirmed share", () => {
    const group = (gov: GovernmentStatus, n: number) => ({
      category_id: "program",
      gov_status: gov,
      province_code: "32",
      n,
      verified: n,
    })
    const { resolution } = summarizeIssues([
      group("confirmed_resolved", 6),
      group("reopened", 3),
      group("claimed_resolved", 2),
    ])
    expect(resolution).toEqual({
      pending: 2,
      confirmed: 6,
      reopened: 3,
      claimTotal: 11,
      checked: 9,
      confirmedShare: 6 / 9,
    })
  })
})

describe("summarizeResponses, PLAN §5.8", () => {
  const today = "2026-10-16"
  test("rate counts issues past N days, exact parts", () => {
    const issues: Parameters<typeof summarizeResponses>[0] = [
      // Answered on day 3
      { sent_on: "2026-09-01", responded_on: "2026-09-04", gov: "responded" },
      // Answered on day 20, late
      { sent_on: "2026-09-01", responded_on: "2026-09-21", gov: "responded" },
      // Never answered, due
      { sent_on: "2026-09-10", responded_on: null, gov: "awaiting_response" },
      // Sent 5 days ago
      { sent_on: "2026-10-11", responded_on: null, gov: "awaiting_response" },
    ]
    const summary = summarizeResponses(issues, [], today)
    expect(summary).toMatchObject({
      days: 14,
      due: 3,
      responded: 1,
      share: null,
      firstResponse: { n: 2, medianDays: null, p90Days: null },
    })
    expect(summary.waiting).toEqual({
      d0_7: 1,
      d8_14: 0,
      d15_30: 0,
      d31_90: 1,
      d91: 0,
    })
  })

  test("share, median and P90 from five", () => {
    const issues = [1, 2, 3, 4, 10].map((day) => ({
      sent_on: "2026-08-01",
      responded_on: `2026-08-${String(1 + day).padStart(2, "0")}`,
      gov: "responded" as const,
    }))
    const summary = summarizeResponses(issues, [], today)
    expect(summary.share).toBe(1)
    expect(summary.firstResponse).toEqual({ n: 5, medianDays: 3, p90Days: 7.6 })
  })

  test("overdue per agency, alphabetical, case folded", () => {
    const summary = summarizeResponses(
      [],
      [
        {
          agency: "Dinas PU",
          issue_id: "a",
          deadline_on: "2026-10-01",
          answered: false,
          gov: "awaiting_response",
        },
        {
          agency: "dinas pu ",
          issue_id: "b",
          deadline_on: "2026-10-30",
          answered: false,
          gov: "awaiting_response",
        },
        {
          agency: "Dinas PU",
          issue_id: "c",
          deadline_on: "2026-09-01",
          answered: true,
          gov: "responded",
        },
        {
          agency: "BPBD",
          issue_id: "a",
          deadline_on: "2026-10-02",
          answered: false,
          gov: "awaiting_response",
        },
      ],
      today,
    )
    expect(summary.overdue).toEqual([
      { agency: "BPBD", overdue: 1, referred: 1 },
      { agency: "Dinas PU", overdue: 1, referred: 3 },
    ])
  })

  test("closed or resolved issues never wait", () => {
    const summary = summarizeResponses(
      [
        {
          sent_on: "2026-06-01",
          responded_on: null,
          gov: "confirmed_resolved",
        },
        { sent_on: "2026-06-01", responded_on: null, gov: "not_competent" },
        { sent_on: "2026-06-01", responded_on: null, gov: "not_followed_up" },
        { sent_on: "2026-06-01", responded_on: null, gov: "awaiting_response" },
      ],
      [
        {
          agency: "Dinas PU",
          issue_id: "a",
          deadline_on: "2026-06-15",
          answered: false,
          gov: "confirmed_resolved",
        },
        {
          agency: "BPBD",
          issue_id: "b",
          deadline_on: "2026-06-15",
          answered: false,
          gov: "awaiting_response",
        },
      ],
      today,
    )
    // Same set as ?status=awaiting_response
    expect(summary.waiting.d91).toBe(1)
    expect(Object.values(summary.waiting).reduce((a, n) => a + n)).toBe(1)
    // Unknown answer date, left out
    expect(summary.due).toBe(2)
    expect(summary.responded).toBe(0)
    expect(summary.overdue).toEqual([
      { agency: "BPBD", overdue: 1, referred: 1 },
    ])
    expect(summary.clearAgencies).toBe(1)
  })
})
