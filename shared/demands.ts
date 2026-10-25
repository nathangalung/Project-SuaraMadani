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
// Brief link, Docs or Drive
export const BRIEF_URL_MAX = 500
export const BRIEF_MAX_BYTES = 10 * 1024 * 1024

/** Checked in the browser too. */
export function briefTooLarge(file: { size: number } | undefined): boolean {
  return file !== undefined && file.size > BRIEF_MAX_BYTES
}
export const DEMAND_PAGE_SIZE = 15

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

// Starting Values: citizen ranking
export const RANKING_MIN_RANKERS = 10
export const RANKING_ACCOUNT_DAYS = 7

/** Borda over the voter's list. */
export function rankingPoints(position: number, listLength: number): number {
  return listLength + 1 - position
}

export type RankRow = {
  demandId: string
  points: number
  rankers: number
  raisedOn: string
}

export type DemandRank = {
  // Null below threshold or unranked
  place: number | null
  rankers: number
}

export type CitizenRanking = {
  // Counted accounts with a list
  rankers: number
  shown: boolean
  places: Map<string, DemandRank>
}

export function emptyRank(): DemandRank {
  return { place: null, rankers: 0 }
}

/** Order by points, rankers, age. */
export function citizenRanking(
  rows: readonly RankRow[],
  rankers: number,
): CitizenRanking {
  const shown = rankers >= RANKING_MIN_RANKERS
  const ranked = rows
    .filter((row) => row.points > 0)
    .toSorted(
      (a, b) =>
        b.points - a.points ||
        b.rankers - a.rankers ||
        a.raisedOn.localeCompare(b.raisedOn) ||
        a.demandId.localeCompare(b.demandId),
    )
  const places = new Map<string, DemandRank>()
  ranked.forEach((row, index) => {
    places.set(row.demandId, {
      place: shown ? index + 1 : null,
      rankers: row.rankers,
    })
  })
  return { rankers, shown, places }
}
