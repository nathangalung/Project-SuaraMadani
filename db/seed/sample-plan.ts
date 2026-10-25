import {
  type CategoryId,
  categoryOf,
  type SubcategoryId,
} from "../../shared/categories.ts"
import {
  BOX_SCALE,
  type EvidenceDecision,
  type RedactionBox,
} from "../../shared/evidence.ts"
import {
  jakartaIsoDate,
  jakartaMonth,
  jakartaYear,
} from "../../shared/format.ts"
import {
  addDays,
  type DecisionReason,
  type EscalationChannel,
  type ReferralChannel,
  VERIFY_METHODS,
  type VerifyMethod,
} from "../../shared/moderation.ts"
import {
  AFFECTED_COUNTS,
  AFFECTED_GROUPS,
  CONSENT_TEXT_VERSION,
  OTHER_CONSENTS,
  type RELATIONS,
  STORY_LENGTH,
  TITLE_LENGTH,
} from "../../shared/report-fields.ts"
import { formatReportCode } from "../../shared/report-id.ts"
import {
  INITIAL_ISSUE_STATE,
  type IssueAction,
  type IssueState,
  isTerminalIssue,
  type ReportAction,
  type ReportStatus,
  transitionIssue,
  transitionReport,
} from "../../shared/status.ts"
import {
  ACTION_NOTES,
  DECISION_TEXTS,
  PLACES,
  type PlaceKey,
  RESPONSE_BODIES,
  type SamplePlace,
  type SampleTheme,
  THEMES,
} from "./sample-content.ts"

// Bump when the plan changes
export const SAMPLE_VERSION = 3
// Sample reporters decline contact
const SAMPLE_VERIFY_METHODS = VERIFY_METHODS.filter(
  (method) => method !== "reporter_contact",
)
export const SAMPLE_EMAIL_PATTERN = "sampel.%@contoh.test"

const HOUR = 3_600_000
const DAY = 24 * HOUR

type LooseStatus = Exclude<ReportStatus, "merged" | "forwarded" | "in_review">

type IssuePath = readonly IssueAction[]

const PATHS = {
  monitoring: [],
  referred: ["refer"],
  escalated: ["refer", "escalate"],
  responded: ["refer", "record_response"],
  inProgress: ["refer", "record_response", "mark_in_progress"],
  // Admin confirms in one step
  confirmed: ["refer", "mark_in_progress", "confirm_resolved"],
  notCompetent: ["refer", "mark_not_competent"],
  notFollowed: ["refer", "mark_not_followed_up"],
  notFollowedEscalated: ["refer", "mark_not_followed_up", "escalate"],
  closed: ["refer", "record_response", "close"],
  closedEarly: ["close"],
} as const satisfies Record<string, IssuePath>

type PathName = keyof typeof PATHS

const repeat = (name: PathName, n: number): PathName[] =>
  Array.from({ length: n }, () => name)

export type SampleProfile = {
  slug: string
  campusCode: string
  reporters: number
  places: Partial<Record<PlaceKey, number>>
  loose: Record<LooseStatus, number>
  // Published sizes, oldest first
  issueSizes: readonly number[]
  draftIssues: number
  // Most advanced first
  paths: readonly PathName[]
  evidence: number
}

const ITB_SIZES = [
  ...[8, 6, 6],
  ...Array<number>(10).fill(3),
  ...Array<number>(15).fill(2),
  ...Array<number>(12).fill(1),
]

export const SAMPLE_PROFILES = {
  itb: {
    slug: "itb",
    campusCode: "ITB",
    reporters: 70,
    places: Object.fromEntries(
      Object.entries(PLACES)
        .filter(([key]) => !["jogja", "bantul", "gunungkidul"].includes(key))
        .map(([key, value]) => [key, value.weight]),
    ),
    loose: {
      submitted: 18,
      // Verify merges at once
      verified: 0,
      unverifiable: 12,
      rejected: 15,
    },
    issueSizes: ITB_SIZES,
    draftIssues: 0,
    paths: [
      ...repeat("confirmed", 5),
      "closed",
      "closedEarly",
      ...repeat("confirmed", 3),
      "notFollowedEscalated",
      "notFollowed",
      ...repeat("inProgress", 5),
      ...repeat("notCompetent", 2),
      ...repeat("inProgress", 6),
      ...repeat("responded", 6),
      ...repeat("escalated", 2),
      ...repeat("referred", 4),
      ...repeat("monitoring", 3),
    ],
    evidence: 6,
  },
  ugm: {
    slug: "ugm",
    campusCode: "UGM",
    reporters: 18,
    places: {
      sleman: 14,
      jogja: 10,
      bantul: 8,
      gunungkidul: 7,
      semarang: 4,
      banyumas: 3,
      malang: 2,
      bandung: 1,
    },
    loose: {
      submitted: 5,
      verified: 0,
      unverifiable: 3,
      rejected: 4,
    },
    issueSizes: [3, 3, 2, 2, 2, 1, 1, 1],
    draftIssues: 0,
    paths: [
      "confirmed",
      "inProgress",
      "inProgress",
      "responded",
      "responded",
      "referred",
      "referred",
      "monitoring",
    ],
    evidence: 2,
  },
} as const satisfies Record<string, SampleProfile>

export type PlannedStep = {
  action: ReportAction
  at: Date
  method?: VerifyMethod
  // Reject and not verifiable only
  reason?: DecisionReason
  reasonText?: string
}

export type ActionDetail =
  | {
      kind: "referral"
      agency: string
      channel: ReferralChannel | EscalationChannel
      ticket: string | null
      sentOn: string
      deadlineOn: string | null
    }
  | {
      kind: "response"
      agency: string
      body: string
      respondedOn: string
      sourceUrl: string
    }
  | { kind: "note"; note: string | null }

export type PlannedReport = {
  submissionId: string
  code: string
  reporter: number
  relation: (typeof RELATIONS)[number]
  otherConsent: (typeof OTHER_CONSENTS)[number] | null
  provinceCode: string
  regencyCode: string
  districtCode: string
  title: string
  story: string
  categoryId: CategoryId
  subcategoryId: SubcategoryId
  occurredOn: string
  agency: string | null
  urgency: "low" | "medium" | "high" | "emergency"
  affectedGroups: string[]
  affectedCount: string
  ongoing: "yes" | "no" | "unknown"
  consents: string[]
  consentTextVersion: string
  createdAt: Date
  steps: PlannedStep[]
  status: ReportStatus
  verifiedAt: Date | null
  // Set for merged reports
  issue: number | null
  mergedAt: Date | null
  evidence: number
  // Admin censor choice, PLAN §5.10
  evidenceDecision: PlannedEvidenceDecision | null
  // Editor and /lacak states
  extraFile: "pdf" | "video" | "pending" | null
}

export type PlannedEvidenceDecision = {
  decision: EvidenceDecision
  boxes: RedactionBox[]
}

export type PlannedIssue = {
  title: string
  summary: string
  // Forwarding target role name
  agency: string
  // For DPRD escalations
  area: string
  // Report indices, merge order
  reports: number[]
  createdAt: Date
  publishedAt: Date | null
  actions: { action: IssueAction; at: Date; detail: ActionDetail }[]
  state: IssueState
  verified: boolean
  lastActivityAt: Date
}

// Sample users following others' issues
export type PlannedFollow = { reporter: number; issue: number; at: Date }

export type SamplePlan = {
  reporters: { email: string; createdAt: Date }[]
  reports: PlannedReport[]
  issues: PlannedIssue[]
  follows: PlannedFollow[]
}

/** mulberry32, small and seedable. */
function createRng(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  const between = (min: number, max: number) => min + next() * (max - min)
  const int = (max: number) => Math.floor(next() * max)
  const pick = <T>(list: readonly T[]): T => {
    const item = list[int(list.length)]
    if (item === undefined) throw new Error("pick from empty list")
    return item
  }
  const weighted = <T>(entries: readonly (readonly [T, number])[]): T => {
    const total = entries.reduce((sum, [, w]) => sum + w, 0)
    let roll = next() * total
    for (const [value, w] of entries) {
      roll -= w
      if (roll < 0) return value
    }
    const last = entries.at(-1)
    if (!last) throw new Error("weighted pick from empty list")
    return last[0]
  }
  const shuffle = <T>(list: readonly T[]): T[] => {
    const copy = [...list]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(i + 1)
      const a = copy[i] as T
      copy[i] = copy[j] as T
      copy[j] = a
    }
    return copy
  }
  const bytes = (target: Uint8Array) => {
    for (let i = 0; i < target.length; i++) target[i] = int(256)
    return target
  }
  return { next, between, int, pick, weighted, shuffle, bytes }
}

type Rng = ReturnType<typeof createRng>

/** Seeded generator for one string. */
export function seededRandom(seed: string): () => number {
  return createRng(hash(seed)).next
}

/** FNV-1a, stable string seed. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function uuid(rng: Rng): string {
  const b = rng.bytes(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function fill(text: string, place: SamplePlace, district: string): string {
  return text
    .replaceAll("{kec}", district)
    .replaceAll("{kab}", place.label)
    .replaceAll("{area}", place.area)
}

function fits(theme: SampleTheme, key: PlaceKey): boolean {
  return !theme.places || theme.places.includes(key)
}

type Draft = Omit<
  PlannedReport,
  | "steps"
  | "status"
  | "verifiedAt"
  | "issue"
  | "mergedAt"
  | "evidence"
  | "evidenceDecision"
  | "extraFile"
  | "reporter"
>

function draftReport(
  rng: Rng,
  input: {
    theme: SampleTheme
    placeKey: PlaceKey
    district: readonly [string, string]
    variant: number
    createdAt: Date
  },
): Draft {
  const { theme, placeKey, district, createdAt } = input
  const place = PLACES[placeKey]
  const text = theme.reports[input.variant % theme.reports.length]
  if (!text) throw new Error("theme without reports")
  const categoryId = categoryOf(theme.subcategory)
  if (!categoryId) throw new Error(`unknown ${theme.subcategory}`)
  const relation = rng.weighted<(typeof RELATIONS)[number]>([
    ["self", 55],
    ["witness", 30],
    ["on_behalf", 15],
  ])
  const disaster = categoryId === "bencana"
  const groupCount = 1 + rng.int(3)
  const affectedGroups = rng.shuffle(AFFECTED_GROUPS).slice(0, groupCount)
  const consents = ["age_18_plus", "accurate", "public_issue"]
  consents.push("aggregate_processing")
  // Keep the rng sequence
  rng.next()
  const occurred = new Date(createdAt.getTime() - rng.between(1, 14) * DAY)
  const report: Draft = {
    submissionId: uuid(rng),
    // Set later, by time
    code: "",
    relation,
    otherConsent: relation === "on_behalf" ? rng.pick(OTHER_CONSENTS) : null,
    provinceCode: place.regency.split(".")[0] ?? "",
    regencyCode: place.regency,
    districtCode: district[0],
    title: fill(text.title, place, district[1]),
    story: fill(text.story, place, district[1]),
    categoryId,
    subcategoryId: theme.subcategory,
    occurredOn: jakartaIsoDate(occurred),
    agency: rng.next() < 0.35 ? fill(theme.agency, place, district[1]) : null,
    urgency: rng.weighted(
      disaster
        ? [
            ["medium", 25],
            ["high", 50],
            ["emergency", 25],
          ]
        : [
            ["low", 25],
            ["medium", 50],
            ["high", 25],
          ],
    ),
    affectedGroups,
    affectedCount: rng.weighted(
      AFFECTED_COUNTS.map((count, i) => [count, [3, 6, 5, 2, 1, 2][i] ?? 1]),
    ),
    ongoing: rng.weighted([
      ["yes", 60],
      ["no", 25],
      ["unknown", 15],
    ]),
    consents,
    consentTextVersion: CONSENT_TEXT_VERSION,
    createdAt,
  }
  if (
    report.title.length < TITLE_LENGTH.min ||
    report.title.length > TITLE_LENGTH.max ||
    report.story.length < STORY_LENGTH.min
  ) {
    throw new Error(`sample text out of range: ${report.title}`)
  }
  return report
}

/** Replays steps through the machine. */
function finalStatus(steps: PlannedStep[]): ReportStatus {
  let status: ReportStatus = "submitted"
  for (const step of steps) status = transitionReport(status, step.action).next
  return status
}

function stepAfter(
  rng: Rng,
  from: Date,
  minHours: number,
  maxHours: number,
): Date {
  return new Date(from.getTime() + rng.between(minHours, maxHours) * HOUR)
}

/** Deterministic for profile, version, now. */
export function buildSamplePlan(profile: SampleProfile, now: Date): SamplePlan {
  const rng = createRng(hash(`${profile.slug}:${SAMPLE_VERSION}`))
  const end = now.getTime() - HOUR
  const places = Object.entries(profile.places) as [PlaceKey, number][]
  const themeOrder = rng.shuffle(THEMES)
  let themeCursor = 0
  const reports: PlannedReport[] = []
  const issues: IssueDraft[] = []

  const used = new Set<string>()
  const nextTheme = (): [SampleTheme, PlaceKey] => {
    for (let tries = 0; tries < THEMES.length; tries++) {
      const theme = themeOrder[themeCursor++ % themeOrder.length]
      if (!theme) continue
      // Unique theme and regency pairs
      const fitting = places.filter(
        ([key]) => fits(theme, key) && !used.has(`${theme.subcategory}:${key}`),
      )
      if (fitting.length === 0) continue
      const key = rng.weighted(fitting)
      used.add(`${theme.subcategory}:${key}`)
      return [theme, key]
    }
    throw new Error("no theme fits the profile")
  }

  const push = (
    draft: Draft,
    steps: PlannedStep[],
    issue: number | null = null,
    mergedAt: Date | null = null,
  ) => {
    const status = finalStatus(steps)
    const verify = steps.find((s) => s.action === "verify")
    reports.push({
      ...draft,
      reporter: rng.int(profile.reporters),
      steps,
      status,
      verifiedAt: verify?.at ?? null,
      issue,
      mergedAt,
      evidence: 0,
      evidenceDecision: null,
      extraFile: null,
    })
    return reports.length - 1
  }

  // Issues, oldest first
  const published = profile.issueSizes.length
  const bigSlots = [2, 9, 16]
  const small = rng.shuffle(profile.issueSizes.filter((n) => n < 5))
  const big = profile.issueSizes.filter((n) => n >= 5)
  const sizes = [...small]
  big.forEach((n, i) => {
    sizes.splice(Math.min(bigSlots[i] ?? 0, sizes.length), 0, n)
  })
  const paths = [...profile.paths]
  for (let i = 0; i + 1 < paths.length; i += 2) {
    if (rng.next() < 0.5) {
      const a = paths[i] as PathName
      paths[i] = paths[i + 1] as PathName
      paths[i + 1] = a
    }
  }

  const total = published + profile.draftIssues
  for (let i = 0; i < total; i++) {
    const draft = i >= published
    const size = draft ? 1 : (sizes[i] ?? 1)
    const fraction = (i + rng.next() * 0.9) / published
    const ageDays = draft ? rng.between(4, 8) : 350 - 330 * fraction ** 0.85
    const [theme, placeKey] = nextTheme()
    const place = PLACES[placeKey]
    const fixedDistrict = size >= 5 ? rng.pick(place.districts) : null
    const firstAt = now.getTime() - ageDays * DAY + rng.between(-6, 6) * HOUR
    const spread = draft ? 0 : Math.max(0, Math.min(25, ageDays - 12)) * DAY
    const index = issues.length
    const members: { report: number; mergedAt: Date }[] = []
    for (let j = 0; j < size; j++) {
      const createdAt = new Date(firstAt + (j === 0 ? 0 : rng.next() * spread))
      const review = stepAfter(rng, createdAt, 2, draft ? 18 : 48)
      const decided = stepAfter(rng, review, 2, draft ? 18 : 96)
      const mergedAt = stepAfter(rng, decided, 1, draft ? 12 : 36)
      // Only verified reports merge
      const steps: PlannedStep[] = [
        {
          action: "verify",
          at: decided,
          method: rng.pick(SAMPLE_VERIFY_METHODS),
        },
        { action: "merge", at: mergedAt },
      ]
      const report = draftReport(rng, {
        theme,
        placeKey,
        district: fixedDistrict ?? rng.pick(place.districts),
        variant: j,
        createdAt,
      })
      members.push({ report: push(report, steps, index, mergedAt), mergedAt })
    }
    members.sort((a, b) => a.mergedAt.getTime() - b.mergedAt.getTime())
    const first = members[0]
    const last = members.at(-1)
    if (!first || !last) throw new Error("issue without reports")
    const district = PLACES[placeKey].districts.find(
      ([code]) => code === reports[first.report]?.districtCode,
    )
    const label = district?.[1] ?? place.label
    const publishedAt = draft ? null : stepAfter(rng, first.mergedAt, 3, 60)
    const actions: IssueDraft["actions"] = []
    let state = INITIAL_ISSUE_STATE
    if (publishedAt) {
      const path = PATHS[paths[i] ?? "monitoring"]
      const final = path.reduce(
        (from, action) => transitionIssue(from, action).next,
        INITIAL_ISSUE_STATE,
      )
      // Closed issues take no merges
      const base = isTerminalIssue(final.government)
        ? Math.max(publishedAt.getTime(), last.mergedAt.getTime())
        : publishedAt.getTime()
      let at = base
      const offsets: number[] = []
      for (const _ of path) {
        at += rng.between(path === PATHS.closedEarly ? 1 : 2, 24) * DAY
        offsets.push(at)
      }
      const limit = end - 2 * HOUR
      const lastOffset = offsets.at(-1) ?? 0
      const scale =
        lastOffset > limit ? (limit - base) / (lastOffset - base) : 1
      path.forEach((action, k) => {
        const offset = (offsets[k] ?? 0) - base
        state = transitionIssue(state, action).next
        actions.push({ action, at: new Date(base + offset * scale) })
      })
    }
    const times = [
      last.mergedAt.getTime(),
      publishedAt?.getTime() ?? 0,
      actions.at(-1)?.at.getTime() ?? 0,
    ]
    issues.push({
      title: fill(theme.issue.title, place, label),
      summary: fill(theme.issue.summary, place, label),
      agency: fill(theme.agency, place, label),
      area: place.area,
      reports: members.map((m) => m.report),
      createdAt: first.mergedAt,
      publishedAt,
      actions,
      state,
      verified: members.some((m) => reports[m.report]?.verifiedAt),
      lastActivityAt: new Date(Math.max(...times)),
    })
  }

  // Loose reports, provinces round-robin first
  const regencyCycle = rng.shuffle(places.map(([key]) => key))
  let cycle = 0
  const looseEntries = Object.entries(profile.loose) as [LooseStatus, number][]
  for (const [status, count] of looseEntries) {
    for (let k = 0; k < count; k++) {
      const queued = status === "submitted"
      const ageDays = queued
        ? rng.between(0.2, 9)
        : 8 + 342 * (1 - rng.next() ** 0.7)
      const createdAt = new Date(now.getTime() - ageDays * DAY)
      const placeKey =
        !queued && cycle < regencyCycle.length
          ? (regencyCycle[cycle++] as PlaceKey)
          : rng.weighted(places)
      const fitting = THEMES.filter((t) => fits(t, placeKey))
      const theme = rng.pick(fitting)
      const steps = looseSteps(rng, status, createdAt)
      const report = draftReport(rng, {
        theme,
        placeKey,
        district: rng.pick(PLACES[placeKey].districts),
        variant: rng.int(theme.reports.length),
        createdAt,
      })
      push(report, steps)
      if (finalStatus(steps) !== status) throw new Error(`plan ${status}`)
    }
  }

  // Evidence on published issues
  const withEvidence = rng
    .shuffle(issues.filter((issue) => issue.publishedAt))
    .slice(0, profile.evidence)
  for (const issue of withEvidence) {
    const report = reports[issue.reports[0] ?? -1]
    if (report) report.evidence = 1
  }
  // Undecided PDF and video
  const plain = issues
    .filter((issue) => issue.publishedAt)
    .map((issue) => reports[issue.reports[0] ?? -1])
    .filter((report) => report?.evidence === 0)
  for (const [i, kind] of (["pdf", "video"] as const).entries()) {
    const report = plain[i]
    if (!report) throw new Error(`no report for the ${kind}`)
    report.extraFile = kind
  }
  // Newest submitted, upload not sent
  const pending = reports
    .filter((report) => report.status === "submitted")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
  if (!pending) throw new Error("no submitted report")
  pending.extraFile = "pending"
  pending.createdAt = new Date(
    Math.max(pending.createdAt.getTime(), now.getTime() - 3 * HOUR),
  )

  const reporters = Array.from({ length: profile.reporters }, (_, i) => {
    const own = reports.filter((r) => r.reporter === i)
    const firstAt = Math.min(
      ...own.map((r) => r.createdAt.getTime()),
      now.getTime() - rng.between(1, 300) * DAY,
    )
    return {
      email: `sampel.${profile.slug}.${String(i + 1).padStart(3, "0")}@contoh.test`,
      createdAt: new Date(firstAt - rng.between(0.1, 12) * HOUR),
    }
  })
  // LPR per month, by time
  const counts = new Map<string, number>()
  const byTime = [...reports].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )
  for (const report of byTime) {
    const year = jakartaYear(report.createdAt)
    const month = jakartaMonth(report.createdAt)
    const number = (counts.get(`${year}-${month}`) ?? 0) + 1
    counts.set(`${year}-${month}`, number)
    report.code = formatReportCode(year, month, number)
  }
  // Own streams per concern
  const detailed = planDetails(
    createRng(hash(`${profile.slug}:${SAMPLE_VERSION}:details`)),
    reports,
    issues,
  )
  planEvidenceDecisions(
    createRng(hash(`${profile.slug}:${SAMPLE_VERSION}:evidence`)),
    reports,
  )
  const follows = planFollows(
    createRng(hash(`${profile.slug}:${SAMPLE_VERSION}:follows`)),
    { reporters, reports, issues: detailed },
    end,
  )
  return { reporters, reports, issues: detailed, follows }
}

// Covers every choice in order
const DECISION_CYCLE: readonly EvidenceDecision[] = [
  "redact",
  "no_redaction",
  "withhold",
  "redact",
  "no_redaction",
  "no_redaction",
]

/** One censor decision per file. */
function planEvidenceDecisions(rng: Rng, reports: PlannedReport[]): void {
  let n = 0
  for (const report of reports) {
    if (report.evidence === 0) continue
    const decision = DECISION_CYCLE[n % DECISION_CYCLE.length] ?? "withhold"
    const boxes: RedactionBox[] =
      decision === "redact"
        ? Array.from({ length: 1 + rng.int(2) }, (_, i) => {
            const w = 1500 + rng.int(2000)
            const h = 1500 + rng.int(2000)
            return {
              page: 0,
              x: rng.int(BOX_SCALE - w),
              y: rng.int(BOX_SCALE - h),
              w,
              h,
              // Both styles across the set
              style: (n + i) % 2 === 0 ? "fill" : "pixelate",
            }
          })
        : []
    report.evidenceDecision = { decision, boxes }
    n++
  }
}

type IssueDraft = Omit<PlannedIssue, "actions"> & {
  actions: { action: IssueAction; at: Date }[]
}

// Service twice keeps the stream
const REFERRAL_CYCLE: readonly ReferralChannel[] = [
  "agency_service",
  "official_letter",
  "agency_email",
  "agency_service",
]

function referralDetail(
  rng: Rng,
  issue: IssueDraft,
  action: "refer" | "escalate",
  at: Date,
): ActionDetail {
  const sentOn = jakartaIsoDate(at)
  if (action === "escalate") {
    const dprd = rng.next() < 0.5
    return {
      kind: "referral",
      agency: dprd ? `DPRD ${issue.area}` : "Ombudsman Republik Indonesia",
      channel: dprd ? "dprd" : "ombudsman",
      ticket: null,
      sentOn,
      deadlineOn: dprd ? null : addDays(sentOn, 30),
    }
  }
  const channel = rng.pick(REFERRAL_CYCLE)
  const ticketed = channel === "agency_service"
  return {
    kind: "referral",
    agency: issue.agency,
    channel,
    // Visibly sample, never real
    ticket: ticketed
      ? `SAMPEL-${sentOn.slice(2, 7).replace("-", "")}-${String(1000 + rng.int(9000))}`
      : null,
    sentOn,
    deadlineOn: addDays(sentOn, channel === "official_letter" ? 30 : 14),
  }
}

/** Reasons, referrals, responses, notes. */
function planDetails(
  rng: Rng,
  reports: PlannedReport[],
  issues: IssueDraft[],
): PlannedIssue[] {
  for (const report of reports) {
    for (const step of report.steps) {
      if (step.action !== "reject" && step.action !== "mark_unverifiable") {
        continue
      }
      const options: readonly (readonly [DecisionReason, string])[] =
        DECISION_TEXTS[step.action]
      const [reason, text] = rng.pick(options)
      step.reason = reason
      step.reasonText = text
    }
  }
  return issues.map((issue, index) => ({
    ...issue,
    actions: issue.actions.map(({ action, at }) => {
      if (action === "refer" || action === "escalate") {
        return { action, at, detail: referralDetail(rng, issue, action, at) }
      }
      if (action === "record_response") {
        const body = rng
          .pick(RESPONSE_BODIES)
          .replaceAll("{agency}", issue.agency)
        return {
          action,
          at,
          detail: {
            kind: "response" as const,
            agency: issue.agency,
            body,
            respondedOn: jakartaIsoDate(at),
            // Reserved TLD, never resolves
            sourceUrl: `https://tanggapan.contoh.test/sampel/${index + 1}`,
          },
        }
      }
      const notes = ACTION_NOTES[action]
      return {
        action,
        at,
        detail: {
          kind: "note" as const,
          note: notes ? rng.pick(notes) : null,
        },
      }
    }),
  }))
}

/** Few followers per issue. */
function planFollows(
  rng: Rng,
  plan: Omit<SamplePlan, "follows">,
  end: number,
): PlannedFollow[] {
  const follows: PlannedFollow[] = []
  plan.issues.forEach((issue, index) => {
    const published = issue.publishedAt?.getTime()
    if (published === undefined) return
    const own = new Set(issue.reports.map((r) => plan.reports[r]?.reporter))
    const others = plan.reporters.map((_, i) => i).filter((i) => !own.has(i))
    const wanted = rng.int(issue.reports.length + 3)
    for (const reporter of rng.shuffle(others).slice(0, wanted)) {
      const joined = plan.reporters[reporter]?.createdAt.getTime() ?? end
      const from = Math.max(published, joined)
      if (from >= end - HOUR) continue
      const at = from + rng.between(0.1, 1) * Math.min(end - from, 30 * DAY)
      follows.push({ reporter, issue: index, at: new Date(at) })
    }
  })
  return follows
}

function looseSteps(
  rng: Rng,
  status: LooseStatus,
  createdAt: Date,
): PlannedStep[] {
  if (status === "submitted") return []
  const review = stepAfter(rng, createdAt, 2, 48)
  const decided = stepAfter(rng, review, 2, 96)
  if (status === "rejected" && rng.next() < 0.3) {
    return [{ action: "reject", at: review }]
  }
  const action: Record<Exclude<LooseStatus, "submitted">, ReportAction> = {
    verified: "verify",
    unverifiable: "mark_unverifiable",
    rejected: "reject",
  }
  const last: PlannedStep =
    status === "verified"
      ? {
          action: "verify",
          at: decided,
          method: rng.pick(SAMPLE_VERIFY_METHODS),
        }
      : { action: action[status], at: decided }
  return [last]
}
