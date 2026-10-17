// Pure complaint decision parsing
import {
  COMPLAINT_DECISIONS,
  COMPLAINT_LENGTHS,
  type ComplaintDecision,
  type ComplaintDecisionReason,
  isDecisionReasonFor,
} from "../../../shared/complaints.ts"
import {
  type DecideErrorKey,
  ISSUE_SUMMARY_LENGTH,
  ISSUE_TITLE_LENGTH,
} from "./fields.ts"
import { longText, oneOf, text, UUID, within } from "./form-values.ts"

type DecideFields = {
  decision: ComplaintDecision
  stage: "first" | "appeal"
  subjectVersion: number
  reason: ComplaintDecisionReason
  statement: string
  edit?: { title: string; summary: string; withdraw: string[] }
}

export type ParsedDecide =
  | { input: DecideFields }
  | { decision: ComplaintDecision; errors: DecideErrorKey[] }

const STAGES = ["first", "appeal"] as const

/** Null means a malformed request. */
export function parseDecideForm(form: FormData): ParsedDecide | null {
  const decision = oneOf(COMPLAINT_DECISIONS, text(form, "intent"))
  const stage = oneOf(STAGES, text(form, "stage"))
  const version = text(form, "subjectVersion")
  if (!decision || !stage || !/^\d{1,9}$/.test(version)) return null
  const reason = text(form, "reason")
  const statement = longText(form, "statement")
  const errors: DecideErrorKey[] = []
  const reasonOk = isDecisionReasonFor(decision, reason)
  if (!reasonOk) errors.push("decision_reason")
  if (!within(statement, COMPLAINT_LENGTHS.statement)) errors.push("statement")
  let edit: DecideFields["edit"]
  if (decision === "edit") {
    const title = text(form, "title")
    const summary = longText(form, "summary")
    if (!within(title, ISSUE_TITLE_LENGTH)) errors.push("edit_title")
    if (!within(summary, ISSUE_SUMMARY_LENGTH)) errors.push("edit_summary")
    const withdraw = form
      .getAll("withdraw")
      .filter((id): id is string => typeof id === "string" && UUID.test(id))
    edit = { title, summary, withdraw }
  }
  if (
    (decision === "hide" || decision === "remove") &&
    text(form, "confirm") !== "yes"
  ) {
    errors.push("confirm")
  }
  if (errors.length > 0 || !reasonOk) return { decision, errors }
  return {
    input: {
      decision,
      stage,
      subjectVersion: Number(version),
      reason,
      statement,
      ...(edit ? { edit } : {}),
    },
  }
}
