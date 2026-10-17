// Moderation codes and pure helpers
import { jakartaIsoDate } from "./format.ts"
import {
  DEMAND_ACTIONS,
  type GovernmentStatus,
  ISSUE_ACTIONS,
  type IssueAction,
  REPORT_ACTIONS,
  type VisibilityAction,
} from "./status.ts"

// PLAN §5.5 methods
export const VERIFY_METHODS = [
  "document",
  "site_photo",
  "second_party",
  "news_source",
  "reporter_contact",
] as const
export type VerifyMethod = (typeof VERIFY_METHODS)[number]

// Cites /pedoman standards, PLAN §5.10
export const REJECT_REASONS = [
  "standard_1",
  "standard_2",
  "standard_3",
  "standard_4",
  "standard_5",
  "standard_6",
  "standard_7",
  "standard_8",
  "standard_9",
  "standard_10",
  "standard_11",
  "standard_12",
  "standard_13",
  "out_of_scope",
] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

export const UNVERIFIABLE_REASONS = [
  "no_evidence",
  "source_unreachable",
  "conflicting_information",
  "location_unclear",
] as const
export type UnverifiableReason = (typeof UNVERIFIABLE_REASONS)[number]

export type DecisionReason = RejectReason | UnverifiableReason

export function isRejectReason(value: string): value is RejectReason {
  return (REJECT_REASONS as readonly string[]).includes(value)
}

export function isDecisionReason(value: string): value is DecisionReason {
  return (
    isRejectReason(value) ||
    (UNVERIFIABLE_REASONS as readonly string[]).includes(value)
  )
}

// Official channels, PLAN §5.4
export const REFERRAL_CHANNELS = [
  "official_letter",
  "agency_email",
  "agency_service",
  "hearing",
] as const
export type ReferralChannel = (typeof REFERRAL_CHANNELS)[number]

// Ombudsman, DPRD, media
export const ESCALATION_CHANNELS = ["ombudsman", "dprd", "media"] as const
export type EscalationChannel = (typeof ESCALATION_CHANNELS)[number]

// Public timeline rows
export const ISSUE_EVENT_ACTIONS = [...ISSUE_ACTIONS, "merge"] as const
export type IssueEventAction = IssueAction | "merge"

// Every audit_log action written
export const AUDIT_ACTIONS = [
  "report.submit",
  ...REPORT_ACTIONS.map((action) => `report.${action}` as const),
  "report.forward_in",
  "issue.create",
  "issue.publish",
  ...ISSUE_ACTIONS.map((action) => `issue.${action}` as const),
  "account.close_minor",
  "account.close",
  "report.view_contact",
  "issue.edit",
  "settings.identity",
  "evidence.decide",
  "evidence.download_original",
  "complaint.submit",
  "complaint.decide",
  "complaint.appeal",
  "complaint.appeal_decide",
  "issue.redact",
  "issue.unpublish",
  "issue.take_down",
  "member.invite",
  "member.invite_resend",
  "member.invite_cancel",
  "member.join",
  // Historical rows, one role now
  "member.role",
  "member.remove",
  "settings.theme",
  "settings.logo",
  "settings.intake_pause",
  "campus.create",
  "demand.create",
  "demand.edit",
  "demand.delete",
  ...DEMAND_ACTIONS.map((action) => `demand.${action}` as const),
  "demand.hide",
  "demand.item_add",
  "demand.item_edit",
  "demand.item_move",
  "demand.item_remove",
  "demand.item_status",
  "demand.item_note",
  "demand.brief_upload",
  "demand.brief_publish",
  "demand.brief_withdraw",
  "demand.issue_link",
  "demand.issue_unlink",
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_ENTITIES = [
  "report",
  "issue",
  "user",
  "evidence",
  "complaint",
  "invitation",
  "organization",
  "demand",
] as const
export type AuditEntity = (typeof AUDIT_ENTITIES)[number]

// Finished by the takedown job
export const TAKEDOWN_ACTIONS = [
  "redact",
  "unpublish",
  "take_down",
  "remove_on_request",
] as const satisfies readonly VisibilityAction[]
export type TakedownAction = (typeof TAKEDOWN_ACTIONS)[number]

export const PURGE_STATUSES = ["pending", "retrying", "done"] as const
export type PurgeStatus = (typeof PURGE_STATUSES)[number]

export function isReferralChannel(value: string): value is ReferralChannel {
  return (REFERRAL_CHANNELS as readonly string[]).includes(value)
}

export const REFERRAL_KINDS = ["referral", "escalation"] as const
export type ReferralKind = (typeof REFERRAL_KINDS)[number]

export const CLOSE_ACCOUNT_REASONS = [
  "self_declared",
  "report_content",
  "guardian_request",
  // Adult asks, UU PDP
  "data_subject_request",
] as const
export type CloseAccountReason = (typeof CLOSE_ACCOUNT_REASONS)[number]

// Form lengths, server checked
export const MODERATION_LENGTHS = {
  agency: { min: 3, max: 160 },
  ticket: { min: 0, max: 80 },
  responseBody: { min: 20, max: 10_000 },
  note: { min: 0, max: 500 },
  requiredNote: { min: 10, max: 500 },
  reasonText: { min: 20, max: 1000 },
} as const

const URL_MAX = 2000

/** /pedoman anchor for a reason. */
export function standardAnchor(reason: RejectReason): string {
  return reason === "out_of_scope"
    ? "cakupan"
    : `standar-${reason.slice("standard_".length)}`
}

/** http(s) only, no credentials. */
export function parseSourceUrl(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > URL_MAX) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (url.username || url.password) return null
  const href = url.href
  return href.length > URL_MAX ? null : href
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Real calendar day, YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const DAY_MS = 86_400_000

/** Read time only, never stored. */
export function referralWait(
  referral: { sentOn: string; deadlineOn: string | null },
  status: GovernmentStatus,
  now: Date,
): { days: number; overdue: boolean } | null {
  if (status !== "awaiting_response") return null
  const today = jakartaIsoDate(now)
  const days = Math.max(
    0,
    Math.round((Date.parse(today) - Date.parse(referral.sentOn)) / DAY_MS),
  )
  const overdue = referral.deadlineOn !== null && today > referral.deadlineOn
  return { days, overdue }
}
