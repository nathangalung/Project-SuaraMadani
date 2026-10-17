import {
  ESCALATION_CHANNELS,
  isIsoDate,
  MODERATION_LENGTHS,
  parseSourceUrl,
  REFERRAL_CHANNELS,
} from "../../../shared/moderation.ts"
import {
  ADVOCACY_STATUSES,
  GOVERNMENT_STATUSES,
  ISSUE_ACTIONS,
  type IssueAction,
} from "../../../shared/status.ts"
import type { IssueErrorKey } from "./fields.ts"
import { longText, oneOf, text, within } from "./form-values.ts"
import type { IssueActionInput } from "./referrals.server.ts"

// Omit per union member
type Parsed = IssueActionInput extends infer T
  ? T extends unknown
    ? Omit<T, "issueId" | "actorId" | "notify">
    : never
  : never

export type ParsedIssueForm =
  | Parsed
  | { action: IssueAction; errors: IssueErrorKey[] }

// Public reason must be written
export const NOTE_REQUIRED: readonly IssueAction[] = [
  "close",
  "confirm_resolved",
  "reopen",
]
const EARLIEST = "2000-01-01"
const L = MODERATION_LENGTHS

function pastDate(value: string, today: string): boolean {
  return isIsoDate(value) && value >= EARLIEST && value <= today
}

function seenState(form: FormData): Parsed["seen"] | null {
  const advocacy = oneOf(ADVOCACY_STATUSES, text(form, "advocacy"))
  const government = oneOf(GOVERNMENT_STATUSES, text(form, "government"))
  const raw = text(form, "version")
  const version = /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null
  if (!advocacy || !government || version === null) return null
  return { advocacy, government, version }
}

/** Null means a malformed request. */
export function parseIssueForm(
  form: FormData,
  today: string,
): ParsedIssueForm | null {
  const action = oneOf(ISSUE_ACTIONS, text(form, "intent"))
  const seen = seenState(form)
  if (!action || !seen) return null
  const errors: IssueErrorKey[] = []

  if (action === "refer" || action === "escalate") {
    const agency = text(form, "agency")
    const channels =
      action === "refer" ? REFERRAL_CHANNELS : ESCALATION_CHANNELS
    const channel = oneOf<string>(channels, text(form, "channel"))
    const ticket = text(form, "ticket")
    const sentOn = text(form, "sentOn")
    const deadline = text(form, "deadlineOn")
    if (!within(agency, L.agency)) errors.push("agency")
    if (!channel) errors.push("channel")
    if (!within(ticket, L.ticket)) errors.push("ticket")
    if (!pastDate(sentOn, today)) errors.push("sent_on")
    const deadlineOk =
      (action === "escalate" && deadline === "") ||
      (isIsoDate(deadline) && (!isIsoDate(sentOn) || deadline >= sentOn))
    if (!deadlineOk) errors.push("deadline_on")
    if (errors.length > 0 || !channel) return { action, errors }
    const common = { agency, ticket: ticket || null, sentOn }
    return action === "refer"
      ? {
          action,
          seen,
          referral: {
            ...common,
            channel: channel as (typeof REFERRAL_CHANNELS)[number],
            deadlineOn: deadline,
          },
        }
      : {
          action,
          seen,
          referral: {
            ...common,
            channel: channel as (typeof ESCALATION_CHANNELS)[number],
            deadlineOn: deadline || null,
          },
        }
  }

  if (action === "record_response") {
    const agency = text(form, "responseAgency")
    const body = longText(form, "body")
    const respondedOn = text(form, "respondedOn")
    const sourceUrl = parseSourceUrl(text(form, "sourceUrl"))
    if (!within(agency, L.agency)) errors.push("response_agency")
    if (!within(body, L.responseBody)) errors.push("response_body")
    if (!pastDate(respondedOn, today)) errors.push("responded_on")
    if (!sourceUrl) errors.push("source_url")
    if (errors.length > 0 || !sourceUrl) return { action, errors }
    return {
      action,
      seen,
      response: { agency, body, respondedOn, sourceUrl },
    }
  }

  const note = longText(form, "note")
  const range = NOTE_REQUIRED.includes(action) ? L.requiredNote : L.note
  if (!within(note, range)) return { action, errors: ["note"] }
  return { action, seen, note: note || null }
}
