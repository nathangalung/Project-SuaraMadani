// Dashboard labels, no rule text
import type {
  RejectReason,
  UnverifiableReason,
} from "../../../shared/moderation.ts"
import { m } from "../../paraglide/messages.js"

type Text = () => string

// Public: the failure, not rule
const PUBLIC_TEXT: Record<Exclude<RejectReason, "out_of_scope">, Text> = {
  standard_1: m.reason_public_standard_1,
  standard_2: m.reason_public_standard_2,
  standard_3: m.reason_public_standard_3,
  standard_4: m.reason_public_standard_4,
  standard_5: m.reason_public_standard_5,
  standard_6: m.reason_public_standard_6,
  standard_7: m.reason_public_standard_7,
  standard_8: m.reason_public_standard_8,
  standard_9: m.reason_public_standard_9,
  standard_10: m.reason_public_standard_10,
  standard_11: m.reason_public_standard_11,
  standard_12: m.reason_public_standard_12,
  standard_13: m.reason_public_standard_13,
}

/** /data label, no rule text. */
export function publicRejectReasonText(reason: RejectReason): string {
  if (reason === "out_of_scope") return m.reason_out_of_scope()
  return m.reason_standard({
    n: reason.slice("standard_".length),
    text: PUBLIC_TEXT[reason](),
  })
}

export const UNVERIFIABLE_TEXT: Record<UnverifiableReason, Text> = {
  no_evidence: m.reason_no_evidence,
  source_unreachable: m.reason_source_unreachable,
  conflicting_information: m.reason_conflicting_information,
  location_unclear: m.reason_location_unclear,
}
