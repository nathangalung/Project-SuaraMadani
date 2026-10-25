import { CATEGORY_IDS, type CategoryId } from "./categories.ts"
import type { RejectReason, UnverifiableReason } from "./moderation.ts"
import { PUBLIC_STAGES, type PublicStage } from "./status.ts"

// Starting Values: public suppression
export const MIN_PUBLIC_N = 5
export const LOW_DATA_REPORTS = 100
export const REFRESH_MINUTES = 15
export const STALE_AFTER_MINUTES = 60
export const VERIFY_WINDOW_DAYS = 90
// PLAN §5.10 queue banner
export const QUEUE_SLOW_AT = 50
const TREND_MONTHS = 12
export const SNAPSHOT_VERSION = 8

/** Null hides 1 to 4. */
export type Count = number | null

export function publicCount(n: number): Count {
  return n > 0 && n < MIN_PUBLIC_N ? null : n
}

/** Share needs n of 5. */
export function publicShare(part: number, whole: number): number | null {
  return whole < MIN_PUBLIC_N ? null : part / whole
}

export type CategoryFilter = CategoryId | "all"
// Public stages, like Jelajah
export type StatusFilter = PublicStage | "all"

export const CATEGORY_FILTERS: readonly CategoryFilter[] = [
  "all",
  ...CATEGORY_IDS,
]
export const STATUS_FILTERS: readonly StatusFilter[] = ["all", ...PUBLIC_STAGES]

export function filterKey(
  category: CategoryFilter,
  status: StatusFilter,
): string {
  return `${category}|${status}`
}

// Shared fixed classes, PLAN §5.9
export const MAP_CLASSES = [
  { id: "zero", min: 0 },
  // 1 to 4 issues
  { id: "few", min: 1 },
  { id: "low", min: MIN_PUBLIC_N },
  { id: "mid", min: 20 },
  { id: "high", min: 50 },
] as const
export type MapClass = (typeof MAP_CLASSES)[number]["id"] | "none"

// Exact public counts, small numbers
export const DEMAND_MAP_CLASSES = [
  { id: "zero", min: 0 },
  { id: "few", min: 1 },
  { id: "low", min: 2 },
  { id: "mid", min: 3 },
  { id: "high", min: 5 },
] as const satisfies readonly { id: MapClass; min: number }[]

export type MapClasses = typeof MAP_CLASSES | typeof DEMAND_MAP_CLASSES

/** Undefined means no data. */
export function mapClass(
  count: Count | undefined,
  classes: MapClasses = MAP_CLASSES,
): MapClass {
  if (count === undefined) return "none"
  if (count === null) return "few"
  let found: MapClass = "zero"
  for (const step of classes) {
    if (count >= step.min) found = step.id
  }
  return found
}

// Exact, totals disclose them anyway
export type TrendPoint = {
  month: string
  received: number
  verified: number
}

type ProvinceCounts = Record<string, Count>

// PLAN §5.8 N, deadline +14
export const RESPONSE_DAYS = 14
// Days waiting since first referral
export const WAIT_BUCKETS = [
  { id: "d0_7", max: 7 },
  { id: "d8_14", max: 14 },
  { id: "d15_30", max: 30 },
  { id: "d31_90", max: 90 },
  { id: "d91", max: Number.POSITIVE_INFINITY },
] as const
export type WaitBucket = (typeof WAIT_BUCKETS)[number]["id"]

// Issue counts are public, exact
export type ResponseSummary = {
  days: number
  // Referred over N days ago
  due: number
  responded: number
  share: number | null
  firstResponse: {
    n: number
    medianDays: number | null
    p90Days: number | null
  }
  waiting: Record<WaitBucket, number>
  // Overdue only, alphabetical, never ranked
  overdue: { agency: string; overdue: number; referred: number }[]
  // Referred, none overdue
  clearAgencies: number
  // Awaiting, never referred
  unreferred: number
}

// Reports are private: suppressed
export type ReasonCounts = {
  rejected: Record<RejectReason, Count>
  unverifiable: Record<UnverifiableReason, Count>
}

export type DashboardSnapshot = {
  v: typeof SNAPSHOT_VERSION
  // Jakarta day, YYYY-MM-DD
  firstReportAt: string | null
  reports: {
    total: number
    decided: number
    verified: number
    verifiedShare: number | null
    queue: number
  }
  issues: {
    published: number
    mergedReports: number
    reportsPerIssue: number | null
  }
  verifyTime: { n: number; medianHours: number | null; p90Hours: number | null }
  // Current status, no history
  // Done issues over published
  resolution: { done: Count; published: Count; share: number | null }
  trend: TrendPoint[]
  // Reports in the trend window
  trendTotal: number
  categories: Record<CategoryId, Count>
  statuses: Record<PublicStage, Count>
  // Verified reports in published issues
  verifiedProvinces: Record<string, ProvinceCounts>
  verifiedProvinceTotals: Record<string, Count>
  response: ResponseSummary
  reasons: ReasonCounts
}

/** Jakarta month keys, oldest first. */
export function trendMonths(now: Date, count = TREND_MONTHS): string[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === "year")?.value)
  const month = Number(parts.find((p) => p.type === "month")?.value)
  return Array.from({ length: count }, (_, i) => {
    const total = year * 12 + (month - 1) - (count - 1 - i)
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    return `${y}-${String(m).padStart(2, "0")}`
  })
}
