import { jakartaIsoDate } from "./format.ts"
import {
  DEMAND_ACTIONS,
  type DemandAction,
  type EmailTemplate,
  ISSUE_ACTIONS,
  REPORT_STATUSES,
  type ReportStatus,
} from "./status.ts"

// Starting Values: email quota
export const EMAIL_QUOTA = {
  providerDaily: 300,
  otpReserve: 100,
  // Notifications plus invitations
  notificationCeiling: 200,
  invitationDaily: 50,
  // Unproven codes: proven keep headroom
  signUpPerHour: 20,
  signUpPerDay: 60,
  // Per IPv4 or IPv6 /64
  signUpPerClientDay: 10,
} as const

// Deferred sends start 07:00 WIB
const MORNING_HOUR_WIB = 7
const WIB_OFFSET_MS = 7 * 3_600_000
const DAY_MS = 86_400_000

// Legacy rows, complaints removed
const COMPLAINT_TEMPLATES = [
  "complaint_received",
  "complaint_decided",
  "complaint_appeal_decided",
] as const
type ComplaintTemplate = (typeof COMPLAINT_TEMPLATES)[number]

// Admin digest, no subject row
export const DEADLINE_TEMPLATE = "referral_deadline" as const

// Reporter "Sudah beres?", PLAN §5.7
export const SURVEY_TEMPLATE = "claim_survey" as const

// Right of reply sender
const REPLY_TEMPLATES = ["reply_received", "reply_decided"] as const
export type ReplyTemplate = (typeof REPLY_TEMPLATES)[number]

// Legacy rows, claim removed
export const LEGACY_CLAIM_TEMPLATE = "issue_claim_resolved" as const

export type NotificationTemplate =
  | EmailTemplate
  | "issue_published"
  | typeof LEGACY_CLAIM_TEMPLATE
  | ComplaintTemplate
  | typeof DEADLINE_TEMPLATE
  | typeof SURVEY_TEMPLATE
  | ReplyTemplate

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplate[] = [
  ...REPORT_STATUSES.map((status) => `report_${status}` as const),
  ...ISSUE_ACTIONS.map((action) => `issue_${action}` as const),
  "issue_published",
  LEGACY_CLAIM_TEMPLATE,
  ...COMPLAINT_TEMPLATES,
  ...DEMAND_ACTIONS.map((action) => `demand_${action}` as const),
  "demand_update",
  DEADLINE_TEMPLATE,
  SURVEY_TEMPLATE,
  ...REPLY_TEMPLATES,
]

export type DemandTemplate = `demand_${DemandAction}` | "demand_update"

export function isDemandTemplate(template: string): template is DemandTemplate {
  return template.startsWith("demand_")
}

export function isReplyTemplate(template: string): template is ReplyTemplate {
  return (REPLY_TEMPLATES as readonly string[]).includes(template)
}

export function templateForReport(status: ReportStatus): NotificationTemplate {
  return `report_${status}`
}

/** WIB has no daylight saving. */
export function jakartaDayStart(now: Date): Date {
  return new Date(Date.parse(jakartaIsoDate(now)) - WIB_OFFSET_MS)
}

/** Today's quota is spent. */
export function nextSendMorning(now: Date): Date {
  const start = jakartaDayStart(now).getTime()
  return new Date(start + DAY_MS + MORNING_HOUR_WIB * 3_600_000)
}

/** Before 07:00 WIB: wait. */
export function quietUntil(now: Date): Date | undefined {
  const morning = new Date(
    jakartaDayStart(now).getTime() + MORNING_HOUR_WIB * 3_600_000,
  )
  return now < morning ? morning : undefined
}

// Reserved by RFC 2606, 6761
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost"])
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"]

/** Saves quota on dead addresses. */
export function isUndeliverable(address: string): boolean {
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase()
  const tld = domain.slice(domain.lastIndexOf(".") + 1)
  if (RESERVED_TLDS.has(tld)) return true
  return RESERVED_DOMAINS.some(
    (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
  )
}
