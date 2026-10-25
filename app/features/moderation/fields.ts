import type { ReportStatus } from "../../../shared/status.ts"

// Client-safe form constants
export const ISSUE_TITLE_LENGTH = { min: 10, max: 120 } as const
export const ISSUE_SUMMARY_LENGTH = { min: 20, max: 2000 } as const

// PLAN §5.10 pre-publication checklist
export const PUBLISH_CHECKLIST = [
  "no_personal_data",
  "region_matches",
  "category_complete",
  "label_checked",
] as const

export type ReviewErrorKey =
  | "verify_method"
  | "verify_contact"
  | "issue_title"
  | "issue_summary"
  | "merge_issue"
  | "checklist"
  | "reject_reason"
  | "reject_text"
  | "unverifiable_reason"
  | "unverifiable_text"

export type IssueErrorKey =
  | "agency"
  | "channel"
  | "ticket"
  | "sent_on"
  | "deadline_on"
  | "response_agency"
  | "response_body"
  | "responded_on"
  | "source_url"
  | "note"

export type CloseErrorKey = "close_reason" | "close_confirm"

export const QUEUE_STATUSES = [
  "submitted",
  "unverifiable",
] as const satisfies readonly ReportStatus[]
export type QueueStatus = (typeof QUEUE_STATUSES)[number]

// Issue filter URL values
export const ISSUE_NEEDS = ["belum-diteruskan", "lewat-tenggat"] as const
export type IssueNeed = (typeof ISSUE_NEEDS)[number]
