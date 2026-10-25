// Agency right of reply
import { MODERATION_LENGTHS, parseSourceUrl } from "./moderation.ts"

export const REPLY_STATUSES = ["pending", "accepted", "rejected"] as const
export type ReplyStatus = (typeof REPLY_STATUSES)[number]

export const REPLY_REJECT_REASONS = [
  "sender_unconfirmed",
  "off_topic",
  "personal_data",
  "already_recorded",
] as const
export type ReplyRejectReason = (typeof REPLY_REJECT_REASONS)[number]

export function isReplyRejectReason(value: string): value is ReplyRejectReason {
  return (REPLY_REJECT_REASONS as readonly string[]).includes(value)
}

export const REPLY_LENGTHS = {
  agency: MODERATION_LENGTHS.agency,
  senderRole: { min: 3, max: 120 },
  body: MODERATION_LENGTHS.responseBody,
} as const

// Per account per 24 h
export const DAILY_REPLIES = 5

export type ReplyErrorKey = "agency" | "sender_role" | "body" | "source_url"

export type ReplyInput = {
  agency: string
  senderRole: string
  body: string
  sourceUrl: string | null
}

const within = (value: string, range: { min: number; max: number }) =>
  value.length >= range.min && value.length <= range.max

/** Server checked, trims fields. */
export function checkReply(fields: {
  agency: string
  senderRole: string
  body: string
  sourceUrl: string
}): { ok: true; input: ReplyInput } | { ok: false; errors: ReplyErrorKey[] } {
  const agency = fields.agency.trim()
  const senderRole = fields.senderRole.trim()
  const body = fields.body.trim()
  const rawUrl = fields.sourceUrl.trim()
  const sourceUrl = rawUrl ? parseSourceUrl(rawUrl) : null
  const errors: ReplyErrorKey[] = []
  if (!within(agency, REPLY_LENGTHS.agency)) errors.push("agency")
  if (!within(senderRole, REPLY_LENGTHS.senderRole)) errors.push("sender_role")
  if (!within(body, REPLY_LENGTHS.body)) errors.push("body")
  if (rawUrl && !sourceUrl) errors.push("source_url")
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, input: { agency, senderRole, body, sourceUrl } }
}
