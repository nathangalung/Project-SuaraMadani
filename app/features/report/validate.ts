// Client checks, server runs Zod

import {
  categoryOf,
  isCategoryId,
  isSubcategoryId,
  URGENCIES,
} from "../../../shared/categories.ts"
import { videoLimitError } from "../../../shared/evidence.ts"
import {
  AFFECTED_COUNTS,
  AFFECTED_GROUPS,
  AGENCY_MAX_LENGTH,
  CONTACT_METHODS,
  EVIDENCE_LIMITS,
  evidenceKind,
  MAX_EVIDENCE_FILES,
  OCCURRED_ON_MIN_YEAR,
  ONGOING,
  OTHER_CONSENTS,
  RELATIONS,
  type ReportErrorKey,
  type ReportStep,
  STORY_LENGTH,
  TITLE_LENGTH,
} from "../../../shared/report-fields.ts"
import type {
  ContactAnswer,
  DetailsAnswer,
  Draft,
  DraftStep,
  EvidenceEntry,
  ImpactAnswer,
  LocationAnswer,
  RelationAnswer,
} from "./draft"

export type StepError = { field: string; key: ReportErrorKey }

export const OCCURRED_ON_FIELD = "occurredOn"

function isOneOf(values: readonly string[], value: string | undefined) {
  return value !== undefined && values.includes(value)
}

export function validateRelation(answer: RelationAnswer): StepError[] {
  if (!isOneOf(RELATIONS, answer.relation)) {
    return [{ field: "relation", key: "error_relation_required" }]
  }
  if (
    answer.relation === "on_behalf" &&
    !isOneOf(OTHER_CONSENTS, answer.otherConsent)
  ) {
    return [{ field: "otherConsent", key: "error_other_consent_required" }]
  }
  return []
}

// Lower selects stay disabled
export function validateLocation(answer: LocationAnswer): StepError[] {
  if (!answer.provinceCode) {
    return [{ field: "provinceCode", key: "error_province_required" }]
  }
  if (!answer.regencyCode) {
    return [{ field: "regencyCode", key: "error_regency_required" }]
  }
  if (!answer.districtCode) {
    return [{ field: "districtCode", key: "error_district_required" }]
  }
  return []
}

function lengthError(
  value: string | undefined,
  limits: { min: number; max: number },
  keys: [ReportErrorKey, ReportErrorKey, ReportErrorKey],
): ReportErrorKey | null {
  const length = value?.trim().length ?? 0
  if (length === 0) return keys[0]
  if (length < limits.min) return keys[1]
  if (length > limits.max) return keys[2]
  return null
}

export function validateDetails(
  answer: DetailsAnswer,
  today: string,
): StepError[] {
  const errors: StepError[] = []
  const title = lengthError(answer.title, TITLE_LENGTH, [
    "error_title_required",
    "error_title_too_short",
    "error_title_too_long",
  ])
  if (title) errors.push({ field: "title", key: title })
  const story = lengthError(answer.story, STORY_LENGTH, [
    "error_story_required",
    "error_story_too_short",
    "error_story_too_long",
  ])
  if (story) errors.push({ field: "story", key: story })
  const category = answer.categoryId ?? ""
  const subcategory = answer.subcategoryId ?? ""
  if (!isCategoryId(category)) {
    errors.push({ field: "categoryId", key: "error_category_required" })
  } else if (!isSubcategoryId(subcategory)) {
    errors.push({ field: "subcategoryId", key: "error_subcategory_required" })
  } else if (categoryOf(subcategory) !== category) {
    errors.push({ field: "subcategoryId", key: "error_subcategory_mismatch" })
  }
  if (!answer.occurredOn) {
    errors.push({ field: OCCURRED_ON_FIELD, key: "error_occurred_on_invalid" })
  } else if (answer.occurredOn > today) {
    errors.push({ field: OCCURRED_ON_FIELD, key: "error_occurred_on_future" })
  } else if (Number(answer.occurredOn.slice(0, 4)) < OCCURRED_ON_MIN_YEAR) {
    errors.push({ field: OCCURRED_ON_FIELD, key: "error_occurred_on_too_old" })
  }
  if ((answer.agency?.trim().length ?? 0) > AGENCY_MAX_LENGTH) {
    errors.push({ field: "agency", key: "error_agency_too_long" })
  }
  if (!isOneOf(URGENCIES, answer.urgency)) {
    errors.push({ field: "urgency", key: "error_urgency_required" })
  }
  return errors
}

export function validateImpact(answer: ImpactAnswer): StepError[] {
  const errors: StepError[] = []
  const groups = answer.groups ?? []
  if (
    groups.length === 0 ||
    !groups.every((g) => isOneOf(AFFECTED_GROUPS, g))
  ) {
    errors.push({ field: "groups", key: "error_groups_required" })
  }
  if (!isOneOf(AFFECTED_COUNTS, answer.affectedCount)) {
    errors.push({
      field: "affectedCount",
      key: "error_affected_count_required",
    })
  }
  if (!isOneOf(ONGOING, answer.ongoing)) {
    errors.push({ field: "ongoing", key: "error_ongoing_required" })
  }
  return errors
}

export function validateEvidence(files: EvidenceEntry[]): StepError[] {
  const fail = (key: ReportErrorKey) => [{ field: "evidence", key }]
  if (files.length > MAX_EVIDENCE_FILES) return fail("error_evidence_too_many")
  for (const file of files) {
    const kind = evidenceKind(file)
    if (!kind) return fail("error_evidence_type")
    if (file.size > EVIDENCE_LIMITS[kind]) {
      return fail("error_evidence_too_large")
    }
    const video = kind === "video" ? videoLimitError(file) : null
    if (video) return fail(video)
  }
  return []
}

export function validateContact(answer: ContactAnswer): StepError[] {
  if (answer.contactable === "no") return []
  if (answer.contactable !== "yes") {
    return [{ field: "contactable", key: "error_contactable_required" }]
  }
  if (!isOneOf(CONTACT_METHODS, answer.method)) {
    return [{ field: "method", key: "error_contact_method_required" }]
  }
  return []
}

type InMemory = { files: EvidenceEntry[] }

/** Manifest entries without a file. */
export function missingEntries(
  manifest: EvidenceEntry[] | undefined,
  files: Pick<EvidenceEntry, "name" | "size">[],
): EvidenceEntry[] {
  const left = [...files]
  return (manifest ?? []).filter((entry) => {
    const index = left.findIndex(
      (file) => file.name === entry.name && file.size === entry.size,
    )
    if (index === -1) return true
    left.splice(index, 1)
    return false
  })
}

/** First problem per step. */
export function stepProblems(
  draft: Draft,
  today: string,
  held: InMemory,
): Partial<Record<DraftStep, StepError>> {
  const checks: Record<DraftStep, StepError[]> = {
    relation: validateRelation(draft.relation ?? {}),
    location: validateLocation(draft.location ?? {}),
    details: validateDetails(draft.details ?? {}, today),
    impact: validateImpact(draft.impact ?? {}),
    evidence: validateEvidence(held.files),
    contact: validateContact(draft.contact ?? {}),
  }
  const problems: Partial<Record<DraftStep, StepError>> = {}
  for (const [step, errors] of Object.entries(checks)) {
    if (errors[0]) problems[step as DraftStep] = errors[0]
  }
  return problems
}

/** Answered steps without problems. */
export function completedSteps(
  draft: Draft,
  today: string,
  held: InMemory,
): Set<ReportStep> {
  const problems = stepProblems(draft, today, held)
  const steps: DraftStep[] = [
    "relation",
    "location",
    "details",
    "impact",
    "evidence",
    "contact",
  ]
  // Lost photos reopen evidence
  const lost = missingEntries(draft.evidence, held.files).length > 0
  return new Set(
    steps.filter(
      (step) =>
        draft[step] !== undefined &&
        !problems[step] &&
        !(step === "evidence" && lost),
    ),
  )
}
