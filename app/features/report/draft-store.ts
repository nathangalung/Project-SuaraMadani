import type { LatLng, ReportStep } from "../../../shared/report-fields.ts"

// Root needs only this part
export type RelationAnswer = { relation?: string; otherConsent?: string }
export type LocationAnswer = {
  provinceCode?: string
  regencyCode?: string
  districtCode?: string
  villageCode?: string
  // Device point, admin only
  point?: LatLng
  // Display only, server ignores
  label?: string
}
export type DetailsAnswer = {
  title?: string
  story?: string
  categoryId?: string
  subcategoryId?: string
  occurredOn?: string
  agency?: string
  urgency?: string
}
export type ImpactAnswer = {
  groups?: string[]
  affectedCount?: string
  ongoing?: string
}
export type EvidenceEntry = {
  name: string
  size: number
  type: string
  // Video metadata from the browser
  durationSeconds?: number
  width?: number
  height?: number
}

export type VideoMeta = Pick<
  EvidenceEntry,
  "durationSeconds" | "width" | "height"
>
// Number comes from the account
export type ContactAnswer = {
  contactable?: string
  method?: string
}

export type Draft = {
  submissionId: string
  relation?: RelationAnswer
  location?: LocationAnswer
  details?: DetailsAnswer
  impact?: ImpactAnswer
  evidence?: EvidenceEntry[]
  contact?: ContactAnswer
}

export type StepAnswers = {
  relation: RelationAnswer
  location: LocationAnswer
  details: DetailsAnswer
  impact: ImpactAnswer
  evidence: EvidenceEntry[]
  contact: ContactAnswer
}
export type DraftStep = keyof StepAnswers

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

export const STEP_PATHS: Record<ReportStep, string> = {
  relation: "/lapor",
  location: "/lapor/lokasi",
  details: "/lapor/kejadian",
  impact: "/lapor/dampak",
  evidence: "/lapor/bukti",
  contact: "/lapor/kontak",
  consent: "/lapor/periksa",
}

export const DRAFT_KEY = "sm.report-draft"
const STEPS: DraftStep[] = [
  "relation",
  "location",
  "details",
  "impact",
  "evidence",
  "contact",
]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lost on reload, never stored. */
export const memory: {
  files: File[]
  meta: WeakMap<File, VideoMeta>
} = {
  files: [],
  meta: new WeakMap(),
}

/** Null on server or blocked. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function write(storage: StorageLike | null, draft: Draft): void {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Draft is a convenience
  }
}

function parse(raw: string | null): Draft | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const id = record.submissionId
  if (typeof id !== "string" || !UUID.test(id)) return null
  const draft: Record<string, unknown> = { submissionId: id }
  for (const step of STEPS) {
    const answer = record[step]
    const ok =
      step === "evidence"
        ? Array.isArray(answer)
        : typeof answer === "object" &&
          answer !== null &&
          !Array.isArray(answer)
    if (ok) draft[step] = answer
  }
  return draft as Draft
}

export function stored(storage: StorageLike | null): Draft | null {
  try {
    return parse(storage?.getItem(DRAFT_KEY) ?? null)
  } catch {
    return null
  }
}

/** Header link: first unanswered step. */
export function resumeHref(storage: StorageLike | null): string | undefined {
  const draft = stored(storage)
  if (draft === null || !STEPS.some((step) => step in draft)) return undefined
  const next = STEPS.find((step) => !(step in draft))
  return STEP_PATHS[next ?? "consent"]
}

export function clearDraft(storage: StorageLike | null): void {
  try {
    storage?.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to clear
  }
  memory.files = []
  memory.meta = new WeakMap()
}
