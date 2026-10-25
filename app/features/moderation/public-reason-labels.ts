// Public unverifiable labels
import type { UnverifiableReason } from "../../../shared/moderation.ts"
import { m } from "../../paraglide/messages.js"

type Text = () => string

export const UNVERIFIABLE_TEXT: Record<UnverifiableReason, Text> = {
  no_evidence: m.reason_no_evidence,
  source_unreachable: m.reason_source_unreachable,
  conflicting_information: m.reason_conflicting_information,
  location_unclear: m.reason_location_unclear,
}
