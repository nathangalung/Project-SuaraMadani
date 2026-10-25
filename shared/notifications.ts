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

export type NotificationTemplate =
  | EmailTemplate
  | "issue_published"
  // Legacy rows, claim removed
  | "issue_claim_resolved"
  | ComplaintTemplate

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplate[] = [
  ...REPORT_STATUSES.map((status) => `report_${status}` as const),
  ...ISSUE_ACTIONS.map((action) => `issue_${action}` as const),
  "issue_published",
  "issue_claim_resolved",
  ...COMPLAINT_TEMPLATES,
  ...DEMAND_ACTIONS.map((action) => `demand_${action}` as const),
  "demand_update",
]

export type DemandTemplate = `demand_${DemandAction}` | "demand_update"

export function isDemandTemplate(template: string): template is DemandTemplate {
  return template.startsWith("demand_")
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
