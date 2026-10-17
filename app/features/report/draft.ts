// sessionStorage only, PLAN §7
import {
  CONSENT_KEYS,
  CONSENT_TEXT_VERSION,
  type ConsentKey,
} from "../../../shared/report-fields.ts"

import {
  type ContactAnswer,
  type Draft,
  type DraftStep,
  type EvidenceEntry,
  memory,
  type StepAnswers,
  type StorageLike,
  stored,
  write,
} from "./draft-store"

export {
  browserStorage,
  type ContactAnswer,
  clearDraft,
  type DetailsAnswer,
  DRAFT_KEY,
  type Draft,
  type DraftStep,
  type EvidenceEntry,
  type ImpactAnswer,
  type LocationAnswer,
  memory,
  type RelationAnswer,
  type StorageLike,
} from "./draft-store"

/** Server re-validates every value. */
export function readDraft(
  storage: StorageLike | null,
  newId: () => string = () => crypto.randomUUID(),
): Draft {
  const found = stored(storage)
  if (found) return found
  const fresh = { submissionId: newId() }
  write(storage, fresh)
  return fresh
}

/** Replaces the step wholesale. */
export function saveStep<S extends DraftStep>(
  storage: StorageLike | null,
  draft: Draft,
  step: S,
  answer: StepAnswers[S],
): Draft {
  let stored: Draft[DraftStep] = answer
  if (step === "contact") {
    // Old clients may send one
    const { contactable, method } = answer as ContactAnswer
    stored = contactable === "yes" ? { contactable, method } : { contactable }
  }
  const next = { ...draft, [step]: stored }
  write(storage, next)
  return next
}

export function entryOf(file: File): EvidenceEntry {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    ...memory.meta.get(file),
  }
}

export type ConsentAnswers = Record<ConsentKey, boolean>

export const NO_CONSENTS: ConsentAnswers = Object.fromEntries(
  CONSENT_KEYS.map((key) => [key, false]),
) as ConsentAnswers

/** Step-7 POST body. */
export function buildSubmission(
  draft: Draft,
  consents: ConsentAnswers,
  turnstileToken: string,
) {
  const contact =
    draft.contact?.contactable === "yes"
      ? { ...draft.contact }
      : { contactable: draft.contact?.contactable }
  return {
    submissionId: draft.submissionId,
    turnstileToken,
    relation: draft.relation,
    location: draft.location,
    details: draft.details,
    impact: draft.impact,
    evidence: memory.files.map(entryOf),
    contact,
    consent: { consents, consentTextVersion: CONSENT_TEXT_VERSION },
  }
}
