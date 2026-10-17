// Codes stay stored, labels shown
import { m } from "~/paraglide/messages.js"
import { TOKEN_TEXT } from "../campus/theme-labels"
import { FULFILMENT_TEXT, RESPONSE_TEXT } from "../demands/labels"
import { CHANNEL_TEXT } from "../issues/labels"
import { COMPLAINT_REASON_TEXT } from "./complaint-labels"
import { CLOSE_REASON_TEXT, ROLE_TEXT } from "./labels"
import { UNVERIFIABLE_TEXT } from "./public-reason-labels"

type Text = () => string

const COLUMN_TEXT: Record<string, Text> = {
  ...TOKEN_TEXT,
  status: m.audit_column_status,
  verified_at: m.audit_column_verified_at,
  title: m.audit_column_title,
  summary: m.audit_column_summary,
  gov_status: m.audit_column_gov_status,
  advocacy_status: m.audit_column_advocacy_status,
  published_at: m.audit_column_published_at,
  taken_down_at: m.audit_column_taken_down_at,
  forwarded_to_org_id: m.audit_column_forwarded_to_org_id,
  forwarded_from_report_id: m.audit_column_forwarded_from_report_id,
  decision: m.audit_column_decision,
  redaction_boxes: m.audit_column_redaction_boxes,
  publish_pages: m.audit_column_publish_pages,
  version: m.audit_column_version,
  role: m.audit_column_role,
  invitations: m.audit_column_invitations,
  members: m.audit_column_members,
  reports: m.audit_column_reports,
  sessions: m.audit_column_sessions,
  organizations: m.audit_column_organizations,
  expires_at: m.audit_column_expires_at,
  intakePaused: m.audit_column_intake_paused,
  statusUrl: m.audit_column_status_url,
  logo: m.audit_column_logo,
  evidence: m.audit_column_evidence,
  category_id: m.audit_column_category_id,
  subcategory_id: m.audit_column_subcategory_id,
  province_code: m.audit_column_province_code,
  regency_code: m.audit_column_regency_code,
  name: m.audit_column_name,
  campusName: m.audit_column_campus_name,
  contactEmail: m.audit_column_contact_email,
  alliance: m.audit_column_alliance,
  legalNumber: m.audit_column_legal_number,
  credit: m.audit_column_credit,
  officers: m.audit_column_officers,
  scope: m.audit_column_scope,
  body: m.audit_column_body,
  target: m.audit_column_target,
  raised_on: m.audit_column_raised_on,
  state: m.audit_column_state,
  brief_summary: m.audit_column_brief_summary,
  response_status: m.audit_column_response_status,
  fulfilment_status: m.audit_column_fulfilment_status,
}

const CODE_TEXT: Record<string, Text> = {
  ...CHANNEL_TEXT,
  // Historical rows, migration 0013
  sp4n_lapor: CHANNEL_TEXT.agency_service,
  ...UNVERIFIABLE_TEXT,
  ...COMPLAINT_REASON_TEXT,
  ...ROLE_TEXT,
  // Historical rows, migration 0017
  moderator: m.role_admin,
  ...CLOSE_REASON_TEXT,
  // Legal takedown, data owner too
  komdigi_order: m.legal_reason_komdigi_order,
  data_subject_request: m.legal_reason_data_subject_request,
  document: m.verify_method_document,
  site_photo: m.verify_method_site_photo,
  second_party: m.verify_method_second_party,
  news_source: m.verify_method_news_source,
  reporter_contact: m.verify_method_reporter_contact,
  redact: m.manage_evidence_decision_redact,
  no_redaction: m.manage_evidence_decision_no_redaction,
  withhold: m.manage_evidence_decision_withhold,
  no_violation: m.complaint_keep_no_violation,
  insufficient_detail: m.complaint_keep_insufficient_detail,
  out_of_scope: m.reason_out_of_scope,
  paused: m.settings_intake_paused,
  resumed: m.settings_intake_open,
  set: m.audit_reason_logo_set,
  removed: m.audit_reason_logo_removed,
  ...RESPONSE_TEXT,
  ...FULFILMENT_TEXT,
}

const STANDARD = /^standard_(\d{1,2})$/

function lookup(map: Record<string, Text>, code: string): string {
  return Object.hasOwn(map, code) ? (map[code]?.() ?? code) : code
}

/** Unknown codes stay raw. */
export function auditColumnText(column: string): string {
  return lookup(COLUMN_TEXT, column)
}

/** Unknown codes stay raw. */
export function auditReasonText(code: string): string {
  const n = STANDARD.exec(code)?.[1]
  if (n) return m.audit_reason_standard({ n })
  // Sub-tuntutan axes, response/fulfilment
  if (code.includes("/")) {
    return code
      .split("/")
      .map((part) => lookup(CODE_TEXT, part))
      .join(" · ")
  }
  return lookup(CODE_TEXT, code)
}
