import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import type { FieldError } from "~/components/ui/error-summary"
import { Checkbox, Fieldset, Textarea, TextInput } from "~/components/ui/field"
import { Select } from "~/components/ui/select"
import { m } from "~/paraglide/messages.js"
import {
  COMPLAINT_LENGTHS,
  type ComplaintDecision,
  type ComplaintSubjectKind,
  decisionReasons,
  decisionsFor,
} from "../../../shared/complaints.ts"
import { formatRange } from "../../../shared/format.ts"
import { ActionPanel } from "./action-panel"
import { complaintReasonText } from "./complaint-labels"
import {
  type DecideErrorKey,
  ISSUE_SUMMARY_LENGTH,
  ISSUE_TITLE_LENGTH,
} from "./fields"
import { optionText } from "./labels"
import { useSubmitting } from "./submitting"

const S = COMPLAINT_LENGTHS.statement

const FIELD: Record<DecideErrorKey, string> = {
  decision_reason: "reason",
  statement: "statement",
  edit_title: "title",
  edit_summary: "summary",
  confirm: "confirm",
}

const ERROR_TEXT: Record<DecideErrorKey, () => string> = {
  decision_reason: m.error_decide_reason,
  statement: () => m.error_decide_statement(formatRange(S)),
  edit_title: () => m.error_issue_title_length(ISSUE_TITLE_LENGTH),
  edit_summary: () => m.error_issue_summary_length(ISSUE_SUMMARY_LENGTH),
  confirm: m.error_decide_confirm,
}

const fieldId = (decision: ComplaintDecision, key: DecideErrorKey) =>
  `${decision}-${FIELD[key]}`

export function decideErrors(
  decision: ComplaintDecision,
  keys: readonly DecideErrorKey[],
): FieldError[] {
  return keys.map((key) => ({
    fieldId: fieldId(decision, key),
    message: ERROR_TEXT[key](),
  }))
}

export const DECISION_ACTION_TEXT: Record<ComplaintDecision, () => string> = {
  keep: m.manage_decide_keep,
  edit: m.manage_decide_edit,
  hide: m.manage_decide_hide,
  remove: m.manage_decide_remove,
}

// Tuntutan: keep or hide only
const DEMAND_ACTION_TEXT: Record<ComplaintDecision, () => string> = {
  ...DECISION_ACTION_TEXT,
  hide: m.manage_decide_hide_demand,
}

const DEMAND_HINT: Record<ComplaintDecision, () => string> = {
  keep: m.manage_decide_keep_demand_hint,
  edit: m.manage_decide_edit_hint,
  hide: m.manage_decide_hide_demand_hint,
  remove: m.manage_decide_remove_hint,
}

const DECISION_HINT: Record<ComplaintDecision, () => string> = {
  keep: m.manage_decide_keep_hint,
  edit: m.manage_decide_edit_hint,
  hide: m.manage_decide_hide_hint,
  remove: m.manage_decide_remove_hint,
}

type Failed = { decision: ComplaintDecision; errors: FieldError[] } | null

export type DecideTarget = {
  stage: "first" | "appeal"
  subject: {
    kind: ComplaintSubjectKind
    version: number
    title: string
    summary: string
    published: boolean
    takenDown: boolean
  }
  evidence: { id: string; label: string }[]
}

function errorOf(
  failed: Failed,
  decision: ComplaintDecision,
  key: DecideErrorKey,
) {
  if (failed?.decision !== decision) return undefined
  return failed.errors.find((e) => e.fieldId === fieldId(decision, key))
    ?.message
}

function EditFields({
  target,
  failed,
}: {
  target: DecideTarget
  failed: Failed
}) {
  const err = (key: DecideErrorKey) => errorOf(failed, "edit", key)
  return (
    <>
      <TextInput
        id={fieldId("edit", "edit_title")}
        name="title"
        label={m.manage_decide_title_label()}
        error={err("edit_title")}
        defaultValue={target.subject.title}
        maxLength={ISSUE_TITLE_LENGTH.max}
      />
      <Textarea
        id={fieldId("edit", "edit_summary")}
        name="summary"
        label={m.manage_decide_summary_label()}
        hint={m.manage_decide_summary_hint()}
        error={err("edit_summary")}
        defaultValue={target.subject.summary}
        maxLength={ISSUE_SUMMARY_LENGTH.max}
        rows={8}
      />
      {target.evidence.length > 0 ? (
        <Fieldset
          id="edit-withdraw"
          legend={m.manage_decide_withdraw_legend()}
          hint={m.manage_decide_withdraw_hint()}
        >
          {target.evidence.map((file) => (
            <Checkbox
              key={file.id}
              id={`withdraw-${file.id}`}
              name="withdraw"
              value={file.id}
              label={file.label}
              inline
            />
          ))}
        </Fieldset>
      ) : null}
    </>
  )
}

function DecisionForm({
  decision,
  target,
  failed,
}: {
  decision: ComplaintDecision
  target: DecideTarget
  failed: Failed
}) {
  const demand = target.subject.kind === "demand"
  const label = (demand ? DEMAND_ACTION_TEXT : DECISION_ACTION_TEXT)[decision]()
  const err = (key: DecideErrorKey) => errorOf(failed, decision, key)
  const severe = decision === "remove"
  return (
    <ActionPanel
      id={`putusan-${decision}`}
      title={label}
      open={failed?.decision === decision}
      tone={severe ? "danger" : "default"}
    >
      <p className="mb-5 text-[0.95rem] text-ink-soft">
        {(demand ? DEMAND_HINT : DECISION_HINT)[decision]()}
      </p>
      <Form method="post" className="flex flex-col gap-6">
        <input type="hidden" name="intent" value={decision} />
        <input type="hidden" name="stage" value={target.stage} />
        <input
          type="hidden"
          name="subjectVersion"
          value={target.subject.version}
        />
        <Select
          id={fieldId(decision, "decision_reason")}
          name="reason"
          label={m.manage_decide_reason_label()}
          error={err("decision_reason")}
          defaultValue=""
        >
          <option value="">{m.location_choose()}</option>
          {decisionReasons(decision).map((reason) => (
            <option key={reason} value={reason}>
              {optionText(complaintReasonText(reason))}
            </option>
          ))}
        </Select>
        {decision === "edit" ? (
          <EditFields target={target} failed={failed} />
        ) : null}
        <Textarea
          id={fieldId(decision, "statement")}
          name="statement"
          label={m.manage_decide_statement_label()}
          hint={m.manage_decide_statement_hint(formatRange(S))}
          error={err("statement")}
          maxLength={S.max}
          rows={4}
        />
        {decision === "hide" || decision === "remove" ? (
          <Fieldset
            id={`${decision}-confirm-group`}
            legend={m.manage_decide_confirm_legend()}
            error={err("confirm")}
          >
            <Checkbox
              id={fieldId(decision, "confirm")}
              name="confirm"
              value="yes"
              label={
                severe
                  ? m.manage_decide_remove_confirm()
                  : demand
                    ? m.manage_decide_hide_demand_confirm()
                    : m.manage_decide_hide_confirm()
              }
            />
          </Fieldset>
        ) : null}
        <div>
          <Button
            type="submit"
            variant={severe ? "danger" : "primary"}
            pending={useSubmitting(decision)}
          >
            {label}
          </Button>
        </div>
      </Form>
    </ActionPanel>
  )
}

/** Decisions the subject allows. */
function allowedDecisions(
  subject: DecideTarget["subject"],
): readonly ComplaintDecision[] {
  if (subject.kind === "demand") {
    return subject.published ? decisionsFor("demand") : ["keep"]
  }
  if (subject.takenDown) return ["keep"]
  return subject.published
    ? ["keep", "edit", "hide", "remove"]
    : ["keep", "edit", "remove"]
}

export function DecisionPanels({
  target,
  failed,
}: {
  target: DecideTarget
  failed: Failed
}) {
  return (
    <div className="flex flex-col gap-3">
      {allowedDecisions(target.subject).map((decision) => (
        <DecisionForm
          key={decision}
          decision={decision}
          target={target}
          failed={failed}
        />
      ))}
    </div>
  )
}
