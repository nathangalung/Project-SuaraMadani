import {
  complaintOutcomeText,
  complaintReasonText,
} from "../../app/features/moderation/complaint-labels.ts"
import { decisionReasonText } from "../../app/features/moderation/reason-labels.ts"
import { m } from "../../app/paraglide/messages.js"
import {
  COMPLAINT_SLA_DAYS,
  type ComplaintDecision,
  type ComplaintDecisionReason,
  type ComplaintSubjectKind,
} from "../../shared/complaints.ts"
import { formatDate, formatIsoDate } from "../../shared/format.ts"
import {
  type DecisionReason,
  isRejectReason,
  standardAnchor,
} from "../../shared/moderation.ts"
import type {
  ComplaintTemplate,
  DemandTemplate,
  NotificationTemplate,
} from "../../shared/notifications.ts"
import type { ReplyRejectReason } from "../../shared/replies.ts"
import type {
  AdvocacyStatus,
  DemandProgress,
  GovernmentStatus,
  IssueAction,
  ReportStatus,
} from "../../shared/status.ts"
import {
  type MailContent,
  type MailSite,
  type RenderedMail,
  renderMail,
} from "./layout.ts"

export type { MailSite, RenderedMail } from "./layout.ts"

type Text = () => string
type ReportTemplate = Extract<NotificationTemplate, `report_${string}`>
type FollowerTemplate = Extract<NotificationTemplate, `issue_${string}`>

export function isReportTemplate(
  template: NotificationTemplate,
): template is ReportTemplate {
  return template.startsWith("report_")
}

export function isFollowerTemplate(
  template: NotificationTemplate,
): template is FollowerTemplate {
  return template.startsWith("issue_")
}

export type ReporterMail = {
  template: ReportTemplate
  site: MailSite
  report: { code: string; title: string }
  // Null url: not published yet
  issue: {
    code: string
    // Null when taken down
    title: string | null
    url: string | null
    removed?: boolean
  } | null
  trackUrl: string
  // Rejected or not verifiable
  decision?: { reason: DecisionReason; text: string } | null
  // Copy at campus B
  forwarded?: { from: string; campus: string } | null
}

export type FollowerMail = {
  template: FollowerTemplate
  site: MailSite
  issue: {
    code: string
    title: string
    url: string
    govStatus: GovernmentStatus
    advocacyStatus: AdvocacyStatus
  }
  unsubscribeUrl: string
}

type Copy = {
  subject: (p: { code: string; issue: string }) => string
  heading: Text
  body: (p: { issue: string; url: string }) => string
}

// Forwarded mail names two codes
const REPORT_COPY: Record<Exclude<ReportStatus, "forwarded">, Copy> = {
  submitted: {
    subject: m.mail_report_submitted_subject,
    heading: m.mail_report_submitted_heading,
    body: m.mail_report_submitted_body,
  },
  in_review: {
    subject: m.mail_report_in_review_subject,
    heading: m.mail_report_in_review_heading,
    body: m.mail_report_in_review_body,
  },
  verified: {
    subject: m.mail_report_verified_subject,
    heading: m.mail_report_verified_heading,
    body: m.mail_report_verified_body,
  },
  unverifiable: {
    subject: m.mail_report_unverifiable_subject,
    heading: m.mail_report_unverifiable_heading,
    body: m.mail_report_unverifiable_body,
  },
  rejected: {
    subject: m.mail_report_rejected_subject,
    heading: m.mail_report_rejected_heading,
    body: m.mail_report_rejected_body,
  },
  merged: {
    subject: m.mail_report_merged_subject,
    heading: m.mail_report_merged_heading,
    body: m.mail_report_merged_body,
  },
}

const STATUS_TEXT: Record<ReportStatus, Text> = {
  submitted: m.report_status_submitted,
  in_review: m.report_status_in_review,
  verified: m.report_status_verified,
  unverifiable: m.report_status_unverifiable,
  rejected: m.report_status_rejected,
  merged: m.report_status_merged,
  forwarded: m.report_status_forwarded,
}

const GOVERNMENT_TEXT: Record<GovernmentStatus, Text> = {
  awaiting_response: m.gov_awaiting_response,
  responded: m.gov_responded,
  in_progress: m.gov_in_progress,
  claimed_resolved: m.gov_claimed_resolved,
  confirmed_resolved: m.gov_confirmed_resolved,
  reopened: m.gov_reopened,
  not_competent: m.gov_not_competent,
  not_followed_up: m.gov_not_followed_up,
  closed: m.gov_closed,
}

const ADVOCACY_TEXT: Record<AdvocacyStatus, Text> = {
  monitoring: m.advocacy_monitoring,
  referred: m.advocacy_referred,
  escalated: m.advocacy_escalated,
}

const ISSUE_LEAD: Record<IssueAction, Text> = {
  refer: m.mail_issue_refer,
  escalate: m.mail_issue_escalate,
  record_response: m.mail_issue_record_response,
  mark_in_progress: m.mail_issue_mark_in_progress,
  claim_resolved: m.mail_issue_claim_resolved,
  confirm_resolved: m.mail_issue_confirm_resolved,
  reopen: m.mail_issue_reopen,
  mark_not_competent: m.mail_issue_mark_not_competent,
  mark_not_followed_up: m.mail_issue_mark_not_followed_up,
  close: m.mail_issue_close,
}

// Subject names the event itself
const ISSUE_SUBJECT: Record<IssueAction, Text> = {
  refer: m.mail_issue_subject_refer,
  escalate: m.mail_issue_subject_escalate,
  record_response: m.mail_issue_subject_record_response,
  mark_in_progress: m.mail_issue_subject_mark_in_progress,
  claim_resolved: m.mail_issue_subject_claim_resolved,
  confirm_resolved: m.mail_issue_subject_confirm_resolved,
  reopen: m.mail_issue_subject_reopen,
  mark_not_competent: m.mail_issue_subject_mark_not_competent,
  mark_not_followed_up: m.mail_issue_subject_mark_not_followed_up,
  close: m.mail_issue_subject_close,
}

function footer(): string[] {
  return [m.mail_footer_identity(), m.mail_footer_auto()]
}

/** Old code, campus, new code. */
function forwardedCopy(mail: ReporterMail): Copy {
  const known = {
    code: mail.forwarded?.from ?? mail.report.code,
    campus: mail.forwarded?.campus ?? mail.site.name,
  }
  return {
    subject: () => m.mail_report_forwarded_subject(known),
    heading: m.mail_report_forwarded_heading,
    body: () =>
      m.mail_report_forwarded_body({ ...known, copy: mail.report.code }),
  }
}

export function renderReporterMail(mail: ReporterMail): RenderedMail {
  const status = mail.template.slice("report_".length) as ReportStatus
  const copy =
    status === "forwarded" ? forwardedCopy(mail) : REPORT_COPY[status]
  const issueCode = mail.issue?.code ?? ""
  const { decision } = mail
  const anchor =
    decision && isRejectReason(decision.reason)
      ? `#${standardAnchor(decision.reason)}`
      : ""
  const paragraphs = [
    copy.body({
      issue: issueCode,
      url: `${mail.site.origin}/pedoman${anchor}`,
    }),
  ]
  if (decision) paragraphs.push(m.mail_reason_note({ text: decision.text }))
  if (mail.issue && !mail.issue.url && !mail.issue.removed)
    paragraphs.push(m.mail_report_merged_draft())
  const facts: MailContent["facts"] = [
    [m.mail_fact_report_code(), mail.report.code],
    [m.mail_fact_report_title(), mail.report.title],
    [m.mail_fact_report_status(), STATUS_TEXT[status]()],
  ]
  if (mail.forwarded) {
    facts.unshift([m.mail_fact_forwarded_from(), mail.forwarded.from])
  }
  if (mail.issue?.title)
    facts.push([m.mail_fact_issue_title(), mail.issue.title])
  if (decision) {
    facts.push([m.mail_fact_reason(), decisionReasonText(decision.reason)])
  }
  const content: MailContent = {
    subject: copy.subject({ code: mail.report.code, issue: issueCode }),
    preheader: copy.heading(),
    heading: copy.heading(),
    paragraphs,
    facts,
    action: { label: m.mail_track_action(), url: mail.trackUrl },
    notes: [
      ...(mail.issue?.url
        ? [
            {
              text: m.mail_report_merged_link(),
              link: { label: m.mail_issue_action(), url: mail.issue.url },
            },
          ]
        : []),
      m.mail_track_note({ url: `${mail.site.origin}/lacak` }),
    ],
    footer: footer(),
  }
  return renderMail(mail.site, content)
}

export function renderFollowerMail(mail: FollowerMail): RenderedMail {
  const { issue } = mail
  const published = mail.template === "issue_published"
  const action = mail.template.slice("issue_".length) as IssueAction
  const lead = published ? m.mail_issue_published_body() : ISSUE_LEAD[action]()
  const heading = published
    ? m.mail_issue_published_heading()
    : m.mail_issue_heading()
  const content: MailContent = {
    subject: published
      ? m.mail_issue_published_subject({ code: issue.code })
      : m.mail_issue_subject({
          code: issue.code,
          action: ISSUE_SUBJECT[action](),
        }),
    preheader: lead,
    heading,
    paragraphs: [lead],
    facts: [
      [m.mail_fact_issue_code(), issue.code],
      [m.mail_fact_issue_title(), issue.title],
      [m.mail_fact_issue_gov(), GOVERNMENT_TEXT[issue.govStatus]()],
      [m.mail_fact_issue_advocacy(), ADVOCACY_TEXT[issue.advocacyStatus]()],
    ],
    action: { label: m.mail_issue_action(), url: issue.url },
    notes: [
      {
        text: m.mail_unfollow_note({ code: issue.code }),
        link: { label: m.mail_unfollow_action(), url: mail.unsubscribeUrl },
      },
    ],
    footer: footer(),
  }
  return renderMail(mail.site, content)
}

export type DemandMail = {
  template: DemandTemplate
  site: MailSite
  demand: { code: string; title: string; url: string; progress: DemandProgress }
  unsubscribeUrl: string
}

const DEMAND_LEAD: Record<DemandTemplate, Text> = {
  demand_publish: m.mail_demand_publish_body,
  demand_close: m.mail_demand_close_body,
  demand_reopen: m.mail_demand_reopen_body,
  demand_update: m.mail_demand_update_body,
}

export function renderDemandMail(mail: DemandMail): RenderedMail {
  const { demand } = mail
  const lead = DEMAND_LEAD[mail.template]()
  const progress = m.demand_progress_line({
    done: demand.progress.fulfilled,
    total: demand.progress.total,
  })
  const content: MailContent = {
    subject: m.mail_demand_subject({ code: demand.code }),
    preheader: lead,
    heading: m.mail_demand_heading(),
    paragraphs: [lead],
    facts: [
      [m.mail_fact_demand_code(), demand.code],
      [m.mail_fact_demand_title(), demand.title],
      [m.mail_fact_demand_progress(), progress],
    ],
    action: { label: m.mail_demand_action(), url: demand.url },
    notes: [
      {
        text: m.mail_demand_unfollow_note({ code: demand.code }),
        link: {
          label: m.mail_demand_unfollow_action(),
          url: mail.unsubscribeUrl,
        },
      },
    ],
    footer: footer(),
  }
  return renderMail(mail.site, content)
}

export type ComplaintMail = {
  template: ComplaintTemplate
  site: MailSite
  complaint: {
    code: string
    subject: { kind: ComplaintSubjectKind; code: string }
    url: string
  }
  decision: {
    decision: ComplaintDecision
    reason: ComplaintDecisionReason
    text: string
  } | null
  // First decision only
  appealUntil: Date | null
}

const COMPLAINT_COPY: Record<
  ComplaintTemplate,
  { subject: (p: { code: string }) => string; heading: Text }
> = {
  complaint_received: {
    subject: m.mail_complaint_received_subject,
    heading: m.mail_complaint_received_heading,
  },
  complaint_decided: {
    subject: m.mail_complaint_decided_subject,
    heading: m.mail_complaint_decided_heading,
  },
  complaint_appeal_decided: {
    subject: m.mail_complaint_appeal_decided_subject,
    heading: m.mail_complaint_appeal_decided_heading,
  },
}

function complaintLead(mail: ComplaintMail): string {
  const { kind, code } = mail.complaint.subject
  const subject =
    kind === "issue"
      ? m.complaint_subject_issue({ code })
      : m.complaint_subject_demand({ code })
  if (mail.template === "complaint_received") {
    return m.mail_complaint_received_body({ subject, days: COMPLAINT_SLA_DAYS })
  }
  return mail.template === "complaint_decided"
    ? m.mail_complaint_decided_body({ subject })
    : m.mail_complaint_appeal_decided_body({ subject })
}

export function renderComplaintMail(mail: ComplaintMail): RenderedMail {
  const copy = COMPLAINT_COPY[mail.template]
  const { decision } = mail
  const lead = complaintLead(mail)
  const paragraphs = [lead]
  if (decision) paragraphs.push(m.mail_reason_note({ text: decision.text }))
  if (mail.appealUntil) {
    paragraphs.push(
      m.mail_complaint_appeal_note({ date: formatDate(mail.appealUntil) }),
    )
  }
  const facts: MailContent["facts"] = [
    [m.mail_fact_complaint_code(), mail.complaint.code],
    [
      mail.complaint.subject.kind === "issue"
        ? m.mail_fact_issue_code()
        : m.mail_fact_demand_code(),
      mail.complaint.subject.code,
    ],
  ]
  if (decision) {
    facts.push(
      [
        m.mail_fact_decision(),
        complaintOutcomeText(decision.decision, mail.complaint.subject.kind),
      ],
      [m.mail_fact_reason(), complaintReasonText(decision.reason)],
    )
  }
  return renderMail(mail.site, {
    subject: copy.subject({ code: mail.complaint.code }),
    preheader: lead,
    heading: copy.heading(),
    paragraphs,
    facts,
    action: { label: m.mail_complaint_action(), url: mail.complaint.url },
    notes: [],
    footer: footer(),
  })
}

// Longer lists end counted
export const DEADLINE_MAIL_ITEMS = 20

export type DeadlineMail = {
  site: MailSite
  operator: string
  // Oldest deadline first
  items: {
    code: string
    title: string
    agency: string
    deadlineOn: string
    // Since sent, as /isu shows
    days: number
  }[]
}

/** Admin digest, lewat tenggat. */
export function renderDeadlineMail(mail: DeadlineMail): RenderedMail {
  const shown = mail.items.slice(0, DEADLINE_MAIL_ITEMS)
  const rest = mail.items.length - shown.length
  const lead = m.mail_deadline_body()
  return renderMail(mail.site, {
    subject: m.mail_deadline_subject({ count: mail.items.length }),
    preheader: lead,
    heading: m.mail_deadline_heading(),
    paragraphs: [lead],
    facts: shown.map((item) => [
      item.code,
      m.mail_deadline_item({
        title: item.title,
        agency: item.agency,
        deadline: formatIsoDate(item.deadlineOn),
        days: item.days,
      }),
    ]),
    action: {
      label: m.mail_deadline_action(),
      url: `${mail.site.origin}/kelola/isu?perlu=lewat-tenggat`,
    },
    notes: [
      ...(rest > 0 ? [m.mail_deadline_more({ count: rest })] : []),
      m.mail_deadline_note({ operator: mail.operator }),
    ],
    footer: footer(),
  })
}

type IssueRef = { code: string; title: string; url: string }

export type SurveyMail = {
  site: MailSite
  issue: IssueRef
  surveyUrl: string
  claimedAt: Date
}

/** "Sudah beres?" to a reporter. */
export function renderSurveyMail(mail: SurveyMail): RenderedMail {
  const lead = m.mail_survey_body({ claimedOn: formatDate(mail.claimedAt) })
  return renderMail(mail.site, {
    subject: m.mail_survey_subject({ code: mail.issue.code }),
    preheader: lead,
    heading: m.mail_survey_heading(),
    paragraphs: [lead],
    facts: [
      [m.mail_fact_issue_code(), mail.issue.code],
      [m.mail_fact_issue_title(), mail.issue.title],
    ],
    action: { label: m.mail_survey_action(), url: mail.surveyUrl },
    notes: [m.mail_survey_note()],
    footer: footer(),
  })
}

export type ReplyMail = {
  site: MailSite
  issue: IssueRef
  agency: string
  // Null: receipt
  decision:
    | { status: "accepted" }
    | { status: "rejected"; reason: ReplyRejectReason }
    | null
}

const REPLY_REASON: Record<ReplyRejectReason, Text> = {
  sender_unconfirmed: m.mail_reply_reason_sender_unconfirmed,
  off_topic: m.mail_reply_reason_off_topic,
  personal_data: m.mail_reply_reason_personal_data,
  already_recorded: m.mail_reply_reason_already_recorded,
}

/** Receipt or decision, to sender. */
export function renderReplyMail(mail: ReplyMail): RenderedMail {
  const code = { code: mail.issue.code }
  const agency = { agency: mail.agency }
  const { decision } = mail
  const copy =
    decision === null
      ? {
          subject: m.mail_reply_received_subject(code),
          heading: m.mail_reply_received_heading(),
          body: m.mail_reply_received_body(agency),
        }
      : decision.status === "accepted"
        ? {
            subject: m.mail_reply_accepted_subject(code),
            heading: m.mail_reply_accepted_heading(),
            body: m.mail_reply_accepted_body(agency),
          }
        : {
            subject: m.mail_reply_rejected_subject(code),
            heading: m.mail_reply_rejected_heading(),
            body: m.mail_reply_rejected_body({
              ...agency,
              reason: REPLY_REASON[decision.reason](),
            }),
          }
  return renderMail(mail.site, {
    subject: copy.subject,
    preheader: copy.body,
    heading: copy.heading,
    paragraphs: [copy.body],
    facts: [
      [m.mail_fact_issue_code(), mail.issue.code],
      [m.mail_fact_issue_title(), mail.issue.title],
      [m.mail_fact_reply_agency(), mail.agency],
    ],
    action: { label: m.mail_reply_action(), url: mail.issue.url },
    notes: [],
    footer: footer(),
  })
}

// Plain identity, no tenant needed
const OTP_SITE: MailSite = {
  name: "Sadar Bersuara",
  origin: "",
  brand: "#0f55d6",
}

export function renderOtpMail(code: string): RenderedMail {
  const [first = "", ...rest] = m.email_otp_body({ code }).split("\n\n")
  return renderMail(OTP_SITE, {
    subject: m.email_otp_subject(),
    preheader: first,
    heading: m.email_otp_heading(),
    paragraphs: [first, ...rest],
    facts: [],
    notes: [],
    footer: footer(),
  })
}

export type InvitationMail = {
  site: MailSite
  operator: string
  url: string
  expiresAt: Date
}

export function renderInvitationMail(mail: InvitationMail): RenderedMail {
  const lead = m.mail_invite_body({ operator: mail.operator })
  return renderMail(mail.site, {
    subject: m.mail_invite_subject({ operator: mail.operator }),
    preheader: lead,
    heading: m.mail_invite_heading(),
    paragraphs: [lead, m.mail_invite_steps()],
    facts: [
      [m.mail_fact_organization(), mail.operator],
      [m.mail_fact_role(), m.role_admin()],
      [m.mail_fact_expires(), formatDate(mail.expiresAt)],
    ],
    action: { label: m.mail_invite_action(), url: mail.url },
    notes: [m.mail_invite_ignore()],
    footer: footer(),
  })
}
