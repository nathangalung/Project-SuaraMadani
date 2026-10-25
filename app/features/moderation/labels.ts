// Admin-only label maps
import { m } from "~/paraglide/messages.js"
import type {
  AuditAction,
  AuditEntity,
  CloseAccountReason,
} from "../../../shared/moderation.ts"
import type { IssueAction } from "../../../shared/status.ts"
import type { AuditRow } from "./audit.server"

type Text = () => string

export const ISSUE_ACTION_TEXT: Record<IssueAction, Text> = {
  refer: m.manage_action_refer,
  escalate: m.manage_action_escalate,
  record_response: m.manage_action_record_response,
  mark_in_progress: m.manage_action_mark_in_progress,
  confirm_resolved: m.manage_action_confirm_resolved,
  reopen: m.manage_action_reopen,
  mark_not_competent: m.manage_action_mark_not_competent,
  mark_not_followed_up: m.manage_action_mark_not_followed_up,
  close: m.manage_action_close,
}

export const CLOSE_REASON_TEXT: Record<CloseAccountReason, Text> = {
  self_declared: m.close_reason_self_declared,
  report_content: m.close_reason_report_content,
  guardian_request: m.close_reason_guardian_request,
  data_subject_request: m.close_reason_data_subject_request,
}

export const ROLE_TEXT: Record<NonNullable<AuditRow["actorRole"]>, Text> = {
  reporter: m.role_reporter,
  editor: m.role_editor,
  admin: m.role_admin,
}

export const AUDIT_ACTION_TEXT: Record<AuditAction, Text> = {
  "report.submit": m.audit_report_submit,
  "report.start_review": m.audit_report_start_review,
  "report.verify": m.audit_report_verify,
  "report.mark_unverifiable": m.audit_report_mark_unverifiable,
  "report.reject": m.audit_report_reject,
  "report.merge": m.audit_report_merge,
  "report.forward": m.audit_report_forward,
  "report.forward_in": m.audit_report_forward_in,
  "issue.create": m.audit_issue_create,
  "issue.publish": m.audit_issue_publish,
  "issue.refer": m.audit_issue_refer,
  "issue.escalate": m.audit_issue_escalate,
  "issue.record_response": m.audit_issue_record_response,
  "issue.mark_in_progress": m.audit_issue_mark_in_progress,
  "issue.claim_resolved": m.audit_issue_claim_resolved,
  "issue.confirm_resolved": m.audit_issue_confirm_resolved,
  "issue.reopen": m.audit_issue_reopen,
  "issue.mark_not_competent": m.audit_issue_mark_not_competent,
  "issue.mark_not_followed_up": m.audit_issue_mark_not_followed_up,
  "issue.close": m.audit_issue_close,
  "account.close_minor": m.audit_account_close_minor,
  "account.close": m.audit_account_close,
  "report.view_contact": m.audit_report_view_contact,
  "report.view_account": m.audit_report_view_account,
  "issue.edit": m.audit_issue_edit,
  "evidence.decide": m.audit_evidence_decide,
  "evidence.download_original": m.audit_evidence_download_original,
  // Legacy rows, complaints removed
  "complaint.submit": m.audit_complaint_submit,
  "complaint.decide": m.audit_complaint_decide,
  "complaint.appeal": m.audit_complaint_appeal,
  "complaint.appeal_decide": m.audit_complaint_appeal_decide,
  "issue.redact": m.audit_issue_redact,
  "issue.unpublish": m.audit_issue_unpublish,
  "issue.take_down": m.audit_issue_take_down,
  "member.invite": m.audit_member_invite,
  "member.invite_resend": m.audit_member_invite_resend,
  "member.invite_cancel": m.audit_member_invite_cancel,
  "member.join": m.audit_member_join,
  "member.role": m.audit_member_role,
  "member.remove": m.audit_member_remove,
  "settings.theme": m.audit_settings_theme,
  "settings.logo": m.audit_settings_logo,
  "settings.intake_pause": m.audit_settings_intake_pause,
  "settings.identity": m.audit_settings_identity,
  "campus.create": m.audit_campus_create,
  "demand.create": m.audit_demand_create,
  "demand.edit": m.audit_demand_edit,
  "demand.delete": m.audit_demand_delete,
  "demand.publish": m.audit_demand_publish,
  "demand.close": m.audit_demand_close,
  "demand.reopen": m.audit_demand_reopen,
  "demand.hide": m.audit_demand_hide,
  "demand.item_add": m.audit_demand_item_add,
  "demand.item_edit": m.audit_demand_item_edit,
  "demand.item_move": m.audit_demand_item_move,
  "demand.item_remove": m.audit_demand_item_remove,
  "demand.item_status": m.audit_demand_item_status,
  "demand.item_note": m.audit_demand_item_note,
  "demand.brief_upload": m.audit_demand_brief_upload,
  "demand.brief_publish": m.audit_demand_brief_publish,
  "demand.brief_withdraw": m.audit_demand_brief_withdraw,
  "demand.issue_link": m.audit_demand_issue_link,
  "demand.issue_unlink": m.audit_demand_issue_unlink,
}

/** Option text, first letter up. */
export function optionText(text: string): string {
  return text.charAt(0).toLocaleUpperCase("id-ID") + text.slice(1)
}

export const ENTITY_TEXT: Record<AuditEntity, Text> = {
  report: m.entity_report,
  issue: m.entity_issue,
  user: m.entity_user,
  evidence: m.entity_evidence,
  complaint: m.entity_complaint,
  invitation: m.entity_invitation,
  organization: m.entity_organization,
  demand: m.entity_demand,
}
