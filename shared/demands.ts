// Tuntutan codes, limits, events
import { FULFILMENT_STATUSES, type FulfilmentStatus } from "./status.ts"

export const DEMAND_SCOPES = ["national", "regional"] as const
export type DemandScope = (typeof DEMAND_SCOPES)[number]

// Public timeline rows
export const DEMAND_EVENT_ACTIONS = [
  "publish",
  "close",
  "reopen",
  "status",
  "note",
  "brief",
  "brief_withdraw",
] as const
export type DemandEventAction = (typeof DEMAND_EVENT_ACTIONS)[number]

// Item-level timeline rows
export const ITEM_EVENT_ACTIONS = [
  "status",
  "note",
  "brief",
  "brief_withdraw",
] as const satisfies readonly DemandEventAction[]

export const BRIEF_STATUSES = ["pending", "clean", "infected"] as const
export type BriefStatus = (typeof BRIEF_STATUSES)[number]

// Form lengths, server checked
export const DEMAND_LENGTHS = {
  title: { min: 10, max: 160 },
  body: { min: 20, max: 5000 },
  summary: { min: 20, max: 600 },
  target: { min: 3, max: 200 },
  item: { min: 10, max: 1000 },
  briefSummary: { min: 0, max: 1500 },
  note: { min: 10, max: 1000 },
  source: { min: 3, max: 300 },
  closeNote: { min: 10, max: 500 },
} as const

// Starting Values: tuntutan limits
export const MAX_DEMAND_ITEMS = 12
export const MAX_DEMAND_ISSUES = 10
export const BRIEF_MAX_BYTES = 10 * 1024 * 1024

/** Checked in the browser too. */
export function briefTooLarge(file: { size: number } | undefined): boolean {
  return file !== undefined && file.size > BRIEF_MAX_BYTES
}
export const DEMAND_PAGE_SIZE = 20

// PLAN §5.4 style: TUN-ITB-26-0007
const DEMAND_CODE = /^TUN-[A-Z][A-Z0-9]{1,9}-\d{2}-\d{4,6}$/

export function formatDemandCode(
  campusCode: string,
  year: number,
  number: number,
): string {
  const yy = String(year % 100).padStart(2, "0")
  return `TUN-${campusCode}-${yy}-${String(number).padStart(4, "0")}`
}

/** Canonical code or null. */
export function normalizeDemandCode(input: string): string | null {
  const code = input.trim().toUpperCase()
  return DEMAND_CODE.test(code) ? code : null
}

export function isFulfilmentStatus(value: string): value is FulfilmentStatus {
  return (FULFILMENT_STATUSES as readonly string[]).includes(value)
}

/** Whole percent, nonzero never 0%. */
export function sharePercent(count: number, total: number): string {
  if (total <= 0 || count <= 0) return "0%"
  const percent = Math.round((count / total) * 100)
  if (percent === 0) return "<1%"
  if (percent === 100 && count < total) return ">99%"
  return `${percent}%`
}

// Theme, labels in messages
export const DEMAND_CATEGORIES = [
  "pendidikan",
  "kesehatan",
  "lingkungan_hidup",
  "ekonomi_kesejahteraan",
  "infrastruktur_transportasi",
  "hukum_ham",
  "tata_kelola_demokrasi",
  "kebencanaan",
  "bantuan_sosial",
] as const
export type DemandCategory = (typeof DEMAND_CATEGORIES)[number]

export function isDemandCategory(value: string): value is DemandCategory {
  return (DEMAND_CATEGORIES as readonly string[]).includes(value)
}

// Importance, 1 lowest to 5
export const IMPORTANCE_SCORES = [1, 2, 3, 4, 5] as const
export type ImportanceScore = (typeof IMPORTANCE_SCORES)[number]

// Starting Values: importance rating
export const IMPORTANCE_MIN_RATERS = 10
export const IMPORTANCE_ACCOUNT_DAYS = 7
export const IMPORTANCE_NAMES_SHOWN = 20

export function isImportanceScore(value: number): value is ImportanceScore {
  return (IMPORTANCE_SCORES as readonly number[]).includes(value)
}

type ImportanceCounts = Record<ImportanceScore, number>

export type Importance = {
  raters: number
  counts: ImportanceCounts
  // Null below the threshold
  mean: number | null
}

export function emptyImportance(): Importance {
  return { raters: 0, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, mean: null }
}

/** Counted rows, public summary. */
export function importanceOf(
  rows: readonly { score: number; n: number }[],
): Importance {
  const summary = emptyImportance()
  let sum = 0
  for (const row of rows) {
    if (!isImportanceScore(row.score) || row.n <= 0) continue
    summary.counts[row.score] += row.n
    summary.raters += row.n
    sum += row.score * row.n
  }
  if (summary.raters >= IMPORTANCE_MIN_RATERS) {
    // One decimal, as shown
    summary.mean = Math.round((sum / summary.raters) * 10) / 10
  }
  return summary
}
