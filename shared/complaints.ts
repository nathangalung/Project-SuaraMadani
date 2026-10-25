// Legacy rows, complaints removed
import { REJECT_REASONS, type RejectReason } from "./moderation.ts"

// Cites /pedoman standards
export const COMPLAINT_REASONS = [
  "personal_data",
  "accusation",
  "hate",
  "false_information",
  "sexual_content",
  "child_safety",
  "political",
  "other",
] as const
export type ComplaintReason = (typeof COMPLAINT_REASONS)[number]

// Exact location, DSA Art. 16(2)(b)
export const COMPLAINT_PARTS = [
  "title_summary",
  "responses",
  "timeline",
  "evidence",
  "demand_items",
  "policy_brief",
  "whole",
] as const
export type ComplaintPart = (typeof COMPLAINT_PARTS)[number]

export const COMPLAINT_STATUSES = [
  "open",
  "decided",
  "appealed",
  "appeal_decided",
] as const
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number]

export const COMPLAINT_DECISIONS = ["keep", "edit", "hide", "remove"] as const
export type ComplaintDecision = (typeof COMPLAINT_DECISIONS)[number]

const KEEP_REASONS = ["no_violation", "insufficient_detail"] as const
type KeepReason = (typeof KEEP_REASONS)[number]

export const STANDARD_REASONS = REJECT_REASONS.filter(
  (reason): reason is Exclude<RejectReason, "out_of_scope"> =>
    reason.startsWith("standard_"),
)
export type StandardReason = (typeof STANDARD_REASONS)[number]

// Takedown without a complaint
export const LEGAL_REASONS = ["komdigi_order", "data_subject_request"] as const
export type LegalReason = (typeof LEGAL_REASONS)[number]

export const TAKEDOWN_REASONS = [...STANDARD_REASONS, ...LEGAL_REASONS] as const
export type TakedownReason = StandardReason | LegalReason

export function isLegalReason(value: string): value is LegalReason {
  return (LEGAL_REASONS as readonly string[]).includes(value)
}

export type ComplaintDecisionReason = KeepReason | StandardReason

export const COMPLAINT_DECISION_REASONS: readonly ComplaintDecisionReason[] = [
  ...KEEP_REASONS,
  ...STANDARD_REASONS,
]
