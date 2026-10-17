// Client-safe complaint form rules
import {
  COMPLAINT_LENGTHS,
  COMPLAINT_REASONS,
  type ComplaintPart,
  type ComplaintReason,
  ISSUE_PARTS,
} from "../../../shared/complaints.ts"

export type ComplaintErrorKey = "reason" | "part" | "explanation" | "good_faith"

export type ComplaintFields = {
  reason: string
  part: string
  explanation: string
  goodFaith: boolean
}

export type ComplaintInput = {
  reason: ComplaintReason
  part: ComplaintPart
  explanation: string
}

const L = COMPLAINT_LENGTHS.explanation

function pick<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null
}

/** Field order matches the page. */
export function checkComplaint(
  fields: ComplaintFields,
  parts: readonly ComplaintPart[] = ISSUE_PARTS,
): { input: ComplaintInput } | { errors: ComplaintErrorKey[] } {
  const reason = pick(COMPLAINT_REASONS, fields.reason)
  const part = pick(parts, fields.part)
  const explanation = fields.explanation.trim().replaceAll("\r\n", "\n")
  const errors: ComplaintErrorKey[] = []
  if (!reason) errors.push("reason")
  if (!part) errors.push("part")
  if (explanation.length < L.min || explanation.length > L.max) {
    errors.push("explanation")
  }
  if (!fields.goodFaith) errors.push("good_faith")
  if (!reason || !part || errors.length > 0) return { errors }
  return { input: { reason, part, explanation } }
}
