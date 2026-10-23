// Content complaints, PLAN §5.10
import { REJECT_REASONS, type RejectReason } from "./moderation.ts"
import {
  generateRandomCode,
  normalizeRandomCode,
  type RandomFill,
} from "./report-id.ts"
import type { VisibilityAction } from "./status.ts"

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

export const ISSUE_PARTS = [
  "title_summary",
  "responses",
  "timeline",
  "evidence",
  "whole",
] as const satisfies readonly ComplaintPart[]
// Tuntutan page sections
const DEMAND_PARTS = [
  "title_summary",
  "demand_items",
  "timeline",
  "policy_brief",
  "whole",
] as const satisfies readonly ComplaintPart[]

export type ComplaintSubjectKind = "issue" | "demand"

export function partsFor(kind: ComplaintSubjectKind): readonly ComplaintPart[] {
  return kind === "issue" ? ISSUE_PARTS : DEMAND_PARTS
}

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
export type KeepReason = (typeof KEEP_REASONS)[number]

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

export const COMPLAINT_LENGTHS = {
  explanation: { min: 20, max: 2000 },
  appeal: { min: 20, max: 2000 },
  statement: { min: 20, max: 1000 },
} as const

// Starting Values: business quotas
export const DAILY_COMPLAINTS = 10
// [proposed] internal SLA, PLAN §5.10
export const COMPLAINT_SLA_DAYS = 7
// DSA Art. 20(1): six months
export const APPEAL_WINDOW_DAYS = 180

const DAY_MS = 86_400_000
const PREFIX = "ADU-"

// Admin text: editor fixes it
const DEMAND_DECISIONS = [
  "keep",
  "hide",
] as const satisfies readonly ComplaintDecision[]

export function decisionsFor(
  kind: ComplaintSubjectKind,
): readonly ComplaintDecision[] {
  return kind === "issue" ? COMPLAINT_DECISIONS : DEMAND_DECISIONS
}

export function decisionReasons(
  decision: ComplaintDecision,
): readonly ComplaintDecisionReason[] {
  return decision === "keep" ? KEEP_REASONS : STANDARD_REASONS
}

export function isDecisionReasonFor(
  decision: ComplaintDecision,
  reason: string,
): reason is ComplaintDecisionReason {
  return (decisionReasons(decision) as readonly string[]).includes(reason)
}

const VISIBILITY: Record<ComplaintDecision, VisibilityAction | null> = {
  keep: null,
  edit: "redact",
  hide: "unpublish",
  remove: "take_down",
}

export function visibilityAction(
  decision: ComplaintDecision,
): VisibilityAction | null {
  return VISIBILITY[decision]
}

/** Which decision the row awaits. */
export function complaintStage(
  status: ComplaintStatus,
): "first" | "appeal" | null {
  if (status === "open") return "first"
  if (status === "appealed") return "appeal"
  return null
}

export function appealDeadline(decidedAt: Date): Date {
  return new Date(decidedAt.getTime() + APPEAL_WINDOW_DAYS * DAY_MS)
}

/** One appeal, inside the window. */
export function appealOpen(
  complaint: { status: ComplaintStatus; decidedAt: Date | null },
  now: Date,
): boolean {
  if (complaint.status !== "decided" || !complaint.decidedAt) return false
  return now <= appealDeadline(complaint.decidedAt)
}

/** Caller retries on collision. */
export function generateComplaintCode(
  campusCode: string,
  now: Date,
  fill?: RandomFill,
): string {
  return `${PREFIX}${generateRandomCode(campusCode, now, fill)}`
}

/** Canonical form or null. */
export function normalizeComplaintCode(input: string): string | null {
  const trimmed = input.trim().toUpperCase()
  if (!trimmed.startsWith(PREFIX)) return null
  const rest = normalizeRandomCode(trimmed.slice(PREFIX.length))
  return rest ? `${PREFIX}${rest}` : null
}
