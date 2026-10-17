// Worker mail reuses these, relative

import {
  type DecisionReason,
  isRejectReason,
  type RejectReason,
} from "../../../shared/moderation.ts"
import { m } from "../../paraglide/messages.js"
import { UNVERIFIABLE_TEXT } from "./public-reason-labels.ts"

type Text = () => string

const STANDARD_TEXT: Record<Exclude<RejectReason, "out_of_scope">, Text> = {
  standard_1: m.guidelines_standard_1,
  standard_2: m.guidelines_standard_2,
  standard_3: m.guidelines_standard_3,
  standard_4: m.guidelines_standard_4,
  standard_5: m.guidelines_standard_5,
  standard_6: m.guidelines_standard_6,
  standard_7: m.guidelines_standard_7,
  standard_8: m.guidelines_standard_8,
  standard_9: m.guidelines_standard_9,
  standard_10: m.guidelines_standard_10,
  standard_11: m.guidelines_standard_11,
  standard_12: m.guidelines_standard_12,
  standard_13: m.guidelines_standard_13,
}

export function rejectReasonText(reason: RejectReason): string {
  if (reason === "out_of_scope") return m.reason_out_of_scope()
  return m.reason_standard({
    n: reason.slice("standard_".length),
    text: STANDARD_TEXT[reason](),
  })
}

/** Label for any stored reason. */
export function decisionReasonText(reason: DecisionReason): string {
  return isRejectReason(reason)
    ? rejectReasonText(reason)
    : UNVERIFIABLE_TEXT[reason]()
}
