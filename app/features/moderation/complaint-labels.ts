// Worker mail reuses these, relative

import type {
  ComplaintDecision,
  ComplaintDecisionReason,
  ComplaintPart,
  ComplaintReason,
  ComplaintStatus,
  ComplaintSubjectKind,
  KeepReason,
} from "../../../shared/complaints.ts"
import { m } from "../../paraglide/messages.js"
import { rejectReasonText } from "./reason-labels.ts"

type Text = () => string

export const COMPLAINT_REASON_TEXT: Record<ComplaintReason, Text> = {
  personal_data: m.complaint_reason_personal_data,
  accusation: m.complaint_reason_accusation,
  hate: m.complaint_reason_hate,
  false_information: m.complaint_reason_false_information,
  sexual_content: m.complaint_reason_sexual_content,
  child_safety: m.complaint_reason_child_safety,
  political: m.complaint_reason_political,
  other: m.complaint_reason_other,
}

const PART_TEXT: Record<ComplaintPart, Text> = {
  title_summary: m.complaint_part_title_summary,
  responses: m.complaint_part_responses,
  timeline: m.complaint_part_timeline,
  evidence: m.complaint_part_evidence,
  demand_items: m.complaint_part_demand_items,
  policy_brief: m.complaint_part_policy_brief,
  whole: m.complaint_part_whole,
}

/** Whole page names its kind. */
export function complaintPartText(
  part: ComplaintPart,
  kind: ComplaintSubjectKind = "issue",
): string {
  if (part === "whole" && kind === "demand") {
    return m.complaint_part_whole_demand()
  }
  return PART_TEXT[part]()
}

export const COMPLAINT_STATUS_TEXT: Record<ComplaintStatus, Text> = {
  open: m.complaint_status_open,
  decided: m.complaint_status_decided,
  appealed: m.complaint_status_appealed,
  appeal_decided: m.complaint_status_appeal_decided,
}

// Complainant's view of outcomes
const OUTCOME_TEXT: Record<
  ComplaintSubjectKind,
  Partial<Record<ComplaintDecision, Text>>
> = {
  issue: {
    keep: m.complaint_outcome_keep,
    edit: m.complaint_outcome_edit,
    hide: m.complaint_outcome_hide,
    remove: m.complaint_outcome_remove,
  },
  demand: {
    keep: m.complaint_outcome_keep_demand,
    hide: m.complaint_outcome_hide_demand,
  },
}

export function complaintOutcomeText(
  decision: ComplaintDecision,
  kind: ComplaintSubjectKind = "issue",
): string {
  return (
    (OUTCOME_TEXT[kind][decision] ?? OUTCOME_TEXT.issue[decision])?.() ??
    decision
  )
}

const KEEP_TEXT: Record<KeepReason, Text> = {
  no_violation: m.complaint_keep_no_violation,
  insufficient_detail: m.complaint_keep_insufficient_detail,
}

export function complaintReasonText(reason: ComplaintDecisionReason): string {
  return reason === "no_violation" || reason === "insufficient_detail"
    ? KEEP_TEXT[reason]()
    : rejectReasonText(reason)
}
