import { type SQL, sql } from "drizzle-orm"
import type { Db } from "../db/client.server.ts"
import type { JobPayloads } from "../db/jobs.server.ts"
import { dashboardSnapshots } from "../db/schema/dashboard.ts"
import { organizations } from "../db/schema/organizations.ts"
import { type Tx, withTenant } from "../db/tenant.server.ts"
import { writeLog } from "../server/log.ts"
import { CATEGORY_IDS, type CategoryId } from "../shared/categories.ts"
import {
  CATEGORY_FILTERS,
  type Count,
  type DashboardSnapshot,
  filterKey,
  MIN_PUBLIC_N,
  publicCount,
  publicShare,
  RESPONSE_DAYS,
  type ResponseSummary,
  SNAPSHOT_VERSION,
  STATUS_FILTERS,
  trendMonths,
  VERIFY_WINDOW_DAYS,
  WAIT_BUCKETS,
  type WaitBucket,
} from "../shared/dashboard.ts"
import { jakartaIsoDate } from "../shared/format.ts"
import {
  type AdvocacyStatus,
  type GovernmentStatus,
  PUBLIC_STAGES,
  type PublicStage,
  publicStage,
} from "../shared/status.ts"

// Starting Values: aggregate refresh
const REFRESH_STATEMENT_TIMEOUT = "300s"
const REFRESH_TIMEOUT_SQL = `SET LOCAL statement_timeout = '${REFRESH_STATEMENT_TIMEOUT}'`
const DECIDED = ["verified", "unverifiable", "rejected", "merged"]
const QUEUED = ["submitted", "in_review"]

type ReportRow = {
  total: number
  decided: number
  verified: number
  queue: number
  first_day: string | null
}
type VerifyRow = {
  n: number
  median: number | string | null
  p90: number | string | null
}
type IssueRow = {
  category_id: string
  advocacy_status: AdvocacyStatus
  gov_status: GovernmentStatus
  province_code: string
  n: number
  // Verified reports merged in
  verified: number
}
type MonthRow = { month: string; n: number }

async function rows<T>(tx: Tx, query: SQL): Promise<T[]> {
  const result = await tx.execute(query)
  return result.rows as T[]
}

function hours(value: number | string | null): number | null {
  if (value === null) return null
  return Math.round(Number(value) * 10) / 10
}

// First referral and first answer
type ReferredRow = {
  sent_on: string
  responded_on: string | null
  gov: GovernmentStatus
}
type AgencyRow = {
  agency: string
  issue_id: string
  deadline_on: string | null
  answered: boolean
  gov: GovernmentStatus
}

// Open, as /isu?status= lists it
const WAITING: GovernmentStatus = "awaiting_response"
// Unanswered, answer date known
const UNANSWERED: readonly GovernmentStatus[] = [WAITING, "not_followed_up"]

const DAY_MS = 86_400_000

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
}

/** Linear, like percentile_cont. */
function percentile(sorted: number[], p: number): number {
  const at = (sorted.length - 1) * p
  const low = Math.floor(at)
  const high = Math.ceil(at)
  const value =
    (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (at - low)
  return Math.round(value * 10) / 10
}

/** PLAN §5.8 agency response metrics. */
export function summarizeResponses(
  referred: ReferredRow[],
  agencies: AgencyRow[],
  today: string,
  unreferred = 0,
): ResponseSummary {
  // Moved on unrecorded: date unknown
  const due = referred.filter(
    (r) =>
      daysBetween(r.sent_on, today) > RESPONSE_DAYS &&
      (r.responded_on !== null || UNANSWERED.includes(r.gov)),
  )
  const responded = due.filter(
    (r) =>
      r.responded_on !== null &&
      daysBetween(r.sent_on, r.responded_on) <= RESPONSE_DAYS,
  ).length
  const waits = referred
    .flatMap((r) =>
      r.responded_on === null ? [] : [daysBetween(r.sent_on, r.responded_on)],
    )
    .sort((a, b) => a - b)
  const enough = waits.length >= MIN_PUBLIC_N
  const waiting = Object.fromEntries(
    WAIT_BUCKETS.map((bucket) => [bucket.id, 0]),
  ) as Record<WaitBucket, number>
  for (const row of referred) {
    if (row.responded_on !== null || row.gov !== WAITING) continue
    const age = daysBetween(row.sent_on, today)
    const bucket = WAIT_BUCKETS.find((b) => age <= b.max) ?? WAIT_BUCKETS[4]
    waiting[bucket.id]++
  }
  const byAgency = new Map<
    string,
    { agency: string; referred: Set<string>; overdue: Set<string> }
  >()
  for (const row of agencies) {
    const key = row.agency.trim().toLowerCase()
    const entry = byAgency.get(key) ?? {
      agency: row.agency.trim(),
      referred: new Set<string>(),
      overdue: new Set<string>(),
    }
    entry.referred.add(row.issue_id)
    if (
      !row.answered &&
      row.gov === WAITING &&
      row.deadline_on !== null &&
      row.deadline_on < today
    ) {
      entry.overdue.add(row.issue_id)
    }
    byAgency.set(key, entry)
  }
  return {
    days: RESPONSE_DAYS,
    due: due.length,
    responded,
    share: publicShare(responded, due.length),
    firstResponse: {
      n: waits.length,
      medianDays: enough ? percentile(waits, 0.5) : null,
      p90Days: enough ? percentile(waits, 0.9) : null,
    },
    waiting,
    overdue: [...byAgency.values()]
      .filter((entry) => entry.overdue.size > 0)
      .map((entry) => ({
        agency: entry.agency,
        overdue: entry.overdue.size,
        referred: entry.referred.size,
      }))
      .sort((a, b) => a.agency.localeCompare(b.agency, "id")),
    clearAgencies: [...byAgency.values()].filter(
      (entry) => entry.overdue.size === 0,
    ).length,
    unreferred,
  }
}

function byMonth(list: MonthRow[]): Map<string, number> {
  return new Map(list.map((row) => [row.month, row.n]))
}

/** Raw groups to suppressed cells. */
export function summarizeIssues(groups: IssueRow[]) {
  const categories = Object.fromEntries(
    CATEGORY_IDS.map((id) => [id, 0]),
  ) as Record<CategoryId, number>
  const statuses = Object.fromEntries(
    PUBLIC_STAGES.map((id) => [id, 0]),
  ) as Record<PublicStage, number>
  const sums: Record<string, Record<string, number>> = {}
  for (const category of CATEGORY_FILTERS) {
    for (const status of STATUS_FILTERS) {
      sums[filterKey(category, status)] = {}
    }
  }
  for (const group of groups) {
    const category = group.category_id as CategoryId
    if (category in categories) categories[category] += group.n
    // Same stages as Jelajah
    const stage = publicStage({
      advocacy: group.advocacy_status,
      government: group.gov_status,
    })
    statuses[stage] += group.n
    for (const c of ["all", category] as const) {
      for (const s of ["all", stage] as const) {
        const cell = sums[filterKey(c, s)]
        if (!cell) continue
        cell[group.province_code] =
          (cell[group.province_code] ?? 0) + group.verified
      }
    }
  }
  // Report counts are private: suppressed
  const verifiedProvinces: Record<string, Record<string, Count>> = {}
  const verifiedProvinceTotals: Record<string, Count> = {}
  for (const [key, cell] of Object.entries(sums)) {
    const shown: Record<string, Count> = {}
    for (const [code, n] of Object.entries(cell)) {
      if (n > 0) shown[code] = publicCount(n)
    }
    verifiedProvinces[key] = shown
    verifiedProvinceTotals[key] = publicCount(
      Object.values(cell).reduce((a, n) => a + n, 0),
    )
  }
  // Done over published, one step
  const done = statuses.done
  const published = Object.values(statuses).reduce((a, n) => a + n, 0)
  // Public on /isu: exact
  return {
    categories,
    statuses,
    verifiedProvinces,
    verifiedProvinceTotals,
    resolution: { done, published, share: publicShare(done, published) },
  }
}

/** One org, inside withTenant. */
async function computeSnapshot(
  tx: Tx,
  orgId: string,
  now: Date,
): Promise<DashboardSnapshot> {
  const months = trendMonths(now)
  const trendStart = new Date(`${months[0]}-01T00:00:00+07:00`)
  const verifySince = new Date(now.getTime() - VERIFY_WINDOW_DAYS * 86_400_000)
  const [report] = await rows<ReportRow>(
    tx,
    sql`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status IN (${sql.join(
        DECIDED.map((s) => sql`${s}`),
        sql`, `,
      )}))::int AS decided,
      count(*) FILTER (WHERE verified_at IS NOT NULL)::int AS verified,
      count(*) FILTER (WHERE status IN (${sql.join(
        QUEUED.map((s) => sql`${s}`),
        sql`, `,
      )}))::int AS queue,
      to_char(min(created_at) AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS first_day
    FROM reports WHERE org_id = ${orgId}`,
  )
  const [verify] = await rows<VerifyRow>(
    tx,
    sql`SELECT count(*)::int AS n,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM verified_at - created_at)) / 3600 AS median,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM verified_at - created_at)) / 3600 AS p90
    FROM reports
    WHERE org_id = ${orgId} AND verified_at >= ${verifySince.toISOString()}`,
  )
  const [issue] = await rows<{ published: number; merged: number }>(
    tx,
    sql`SELECT count(*)::int AS published,
      coalesce(sum(report_count), 0)::int AS merged
    FROM issues WHERE org_id = ${orgId} AND published_at IS NOT NULL`,
  )
  const groups = await rows<IssueRow>(
    tx,
    sql`SELECT category_id, advocacy_status, gov_status, province_code,
      count(*)::int AS n,
      coalesce(sum(verified_report_count), 0)::int AS verified
    FROM issues WHERE org_id = ${orgId} AND published_at IS NOT NULL
    GROUP BY 1, 2, 3, 4`,
  )
  const received = await rows<MonthRow>(
    tx,
    sql`SELECT to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month,
      count(*)::int AS n
    FROM reports WHERE org_id = ${orgId} AND created_at >= ${trendStart.toISOString()}
    GROUP BY 1`,
  )
  const verified = await rows<MonthRow>(
    tx,
    sql`SELECT to_char(verified_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month,
      count(*)::int AS n
    FROM reports WHERE org_id = ${orgId} AND verified_at >= ${trendStart.toISOString()}
    GROUP BY 1`,
  )
  const referred = await rows<ReferredRow>(
    tx,
    sql`WITH first_ref AS (
      SELECT r.issue_id, min(r.sent_on) AS sent_on
      FROM referrals r
      JOIN issues i ON i.org_id = r.org_id AND i.id = r.issue_id
      WHERE r.org_id = ${orgId} AND r.kind = 'referral' AND i.published_at IS NOT NULL
      GROUP BY r.issue_id
    )
    SELECT f.sent_on::text AS sent_on, min(s.responded_on)::text AS responded_on,
      i.gov_status AS gov
    FROM first_ref f
    JOIN issues i ON i.org_id = ${orgId} AND i.id = f.issue_id
    LEFT JOIN responses s ON s.org_id = ${orgId} AND s.issue_id = f.issue_id
      AND s.responded_on >= f.sent_on
    GROUP BY f.issue_id, f.sent_on, i.gov_status`,
  )
  const agencies = await rows<AgencyRow>(
    tx,
    sql`SELECT r.agency, r.issue_id::text AS issue_id, r.deadline_on::text AS deadline_on,
      EXISTS (SELECT 1 FROM responses s
        WHERE s.org_id = r.org_id AND s.issue_id = r.issue_id
          AND lower(btrim(s.agency)) = lower(btrim(r.agency))
          AND s.responded_on >= r.sent_on) AS answered,
      i.gov_status AS gov
    FROM referrals r
    JOIN issues i ON i.org_id = r.org_id AND i.id = r.issue_id
    WHERE r.org_id = ${orgId} AND r.kind = 'referral' AND i.published_at IS NOT NULL`,
  )
  const [waitingAlone] = await rows<{ n: number }>(
    tx,
    sql`SELECT count(*)::int AS n FROM issues i
    WHERE i.org_id = ${orgId} AND i.published_at IS NOT NULL
      AND i.gov_status = ${WAITING}
      AND NOT EXISTS (SELECT 1 FROM referrals r
        WHERE r.org_id = i.org_id AND r.issue_id = i.id AND r.kind = 'referral')`,
  )
  const receivedBy = byMonth(received)
  const verifiedBy = byMonth(verified)
  const verifyN = verify?.n ?? 0
  const published = issue?.published ?? 0
  const merged = issue?.merged ?? 0
  const decided = report?.decided ?? 0
  const verifiedTotal = report?.verified ?? 0
  return {
    v: SNAPSHOT_VERSION,
    firstReportAt: report?.first_day ?? null,
    reports: {
      total: report?.total ?? 0,
      decided,
      verified: verifiedTotal,
      verifiedShare: publicShare(verifiedTotal, decided),
      queue: report?.queue ?? 0,
    },
    issues: {
      published,
      mergedReports: merged,
      reportsPerIssue:
        published < MIN_PUBLIC_N
          ? null
          : Math.round((merged / published) * 10) / 10,
    },
    verifyTime: {
      n: verifyN,
      medianHours:
        verifyN < MIN_PUBLIC_N ? null : hours(verify?.median ?? null),
      p90Hours: verifyN < MIN_PUBLIC_N ? null : hours(verify?.p90 ?? null),
    },
    trendTotal: received.reduce((sum, row) => sum + row.n, 0),
    trend: months.map((month) => ({
      month,
      received: receivedBy.get(month) ?? 0,
      verified: verifiedBy.get(month) ?? 0,
    })),
    ...summarizeIssues(groups),
    response: summarizeResponses(
      referred,
      agencies,
      jakartaIsoDate(now),
      waitingAlone?.n ?? 0,
    ),
  }
}

/** Upserts one row per org. */
export async function refreshDashboards(
  db: Db,
  options: { now?: () => Date; signal?: AbortSignal } = {},
): Promise<{ orgs: number; failed: number }> {
  const now = options.now ?? (() => new Date())
  const orgs = await db.select({ id: organizations.id }).from(organizations)
  let failed = 0
  for (const org of orgs) {
    // Expired job stops here
    options.signal?.throwIfAborted()
    try {
      await withTenant(
        org.id,
        async (tx) => {
          await tx.execute(sql.raw(REFRESH_TIMEOUT_SQL)) // sql-raw-ok: constant
          const at = now()
          const data = await computeSnapshot(tx, org.id, at)
          await tx
            .insert(dashboardSnapshots)
            .values({ orgId: org.id, data, computedAt: at })
            .onConflictDoUpdate({
              target: dashboardSnapshots.orgId,
              set: { data, computedAt: at },
              // Older run never wins
              setWhere: sql`${dashboardSnapshots.computedAt} < excluded.computed_at`,
            })
        },
        { db, isolationLevel: "repeatable read" },
      )
    } catch (error) {
      // Old row stays served
      failed++
      writeLog({
        msg: "dashboard refresh failed",
        org_id: org.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  // Independent of the snapshots
  options.signal?.throwIfAborted()
  const national = await refreshNational(db).then(
    () => true,
    (error: unknown) => {
      writeLog({
        msg: "national refresh failed",
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    },
  )
  if (failed > 0) {
    throw new Error(`dashboard refresh failed for ${failed} of ${orgs.length}`)
  }
  if (!national) throw new Error("national refresh failed")
  return { orgs: orgs.length, failed }
}

/** Runs as owner sb_aggregates. */
async function refreshNational(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(REFRESH_TIMEOUT_SQL)) // sql-raw-ok: constant
    // Plain refresh, lock lasts milliseconds
    await tx.execute(sql`REFRESH MATERIALIZED VIEW public.national_aggregates`)
  })
}

export function createAggregateHandler(deps: { db: Db }) {
  return (_data: JobPayloads["aggregate-refresh"], signal?: AbortSignal) =>
    refreshDashboards(deps.db, { signal })
}
