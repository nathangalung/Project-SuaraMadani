import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import { ErrorSummary, type FieldError } from "~/components/ui/error-summary"
import {
  Checkbox,
  Fieldset,
  Radio,
  Textarea,
  TextInput,
} from "~/components/ui/field"
import { Select } from "~/components/ui/select"
import { m } from "~/paraglide/messages.js"
import {
  MODERATION_LENGTHS,
  REJECT_REASONS,
  UNVERIFIABLE_REASONS,
  VERIFY_METHODS,
} from "../../../shared/moderation.ts"
import type { ReportStatus } from "../../../shared/status.ts"
import type { ForwardTarget } from "../report/forward.server"
import {
  ISSUE_SUMMARY_LENGTH,
  ISSUE_TITLE_LENGTH,
  PUBLISH_CHECKLIST,
  type ReviewErrorKey,
} from "./fields"
import { UNVERIFIABLE_TEXT } from "./public-reason-labels"
import type { MergeTargetOption } from "./queue.server"
import { rejectReasonText } from "./reason-labels"
import { useSubmitting } from "./submitting"

// Groups link their first input
const FIELD_IDS: Record<ReviewErrorKey, string> = {
  verify_method: `verify-${VERIFY_METHODS[0]}`,
  verify_contact: `verify-${VERIFY_METHODS[0]}`,
  issue_title: "merge-title",
  issue_summary: "merge-summary",
  merge_issue: "merge-issue",
  checklist: `checklist-${PUBLISH_CHECKLIST[0]}`,
  reject_reason: "reject-reason",
  reject_text: "reject-text",
  unverifiable_reason: `unverifiable-${UNVERIFIABLE_REASONS[0]}`,
  unverifiable_text: "unverifiable-text",
  forward_target: "forward-target",
}

const REASON_TEXT_LENGTH = MODERATION_LENGTHS.reasonText

const ERROR_TEXT: Record<ReviewErrorKey, () => string> = {
  verify_method: m.error_verify_method_required,
  verify_contact: m.error_verify_contact,
  issue_title: () => m.error_issue_title_length(ISSUE_TITLE_LENGTH),
  issue_summary: () => m.error_issue_summary_length(ISSUE_SUMMARY_LENGTH),
  merge_issue: m.error_merge_issue_required,
  checklist: m.error_checklist_required,
  reject_reason: m.error_reject_reason,
  reject_text: () => m.error_reason_text_length(REASON_TEXT_LENGTH),
  unverifiable_reason: m.error_unverifiable_reason,
  unverifiable_text: () => m.error_reason_text_length(REASON_TEXT_LENGTH),
  forward_target: m.error_forward_target,
}

const METHOD_TEXT = {
  document: m.verify_method_document,
  site_photo: m.verify_method_site_photo,
  second_party: m.verify_method_second_party,
  news_source: m.verify_method_news_source,
  reporter_contact: m.verify_method_reporter_contact,
} as const

const CHECKLIST_TEXT = {
  no_personal_data: m.checklist_no_personal_data,
  region_matches: m.checklist_region_matches,
  category_complete: m.checklist_category_complete,
  label_checked: m.checklist_label_checked,
} as const

export function reviewErrors(keys: readonly ReviewErrorKey[]): FieldError[] {
  return keys.map((key) => ({
    fieldId: FIELD_IDS[key],
    message: ERROR_TEXT[key](),
  }))
}

function errorFor(errors: FieldError[], key: ReviewErrorKey) {
  return errors.find((error) => error.fieldId === FIELD_IDS[key])?.message
}

export function ReviewNotices({
  conflict,
  errors,
  attempt,
}: {
  conflict: boolean
  errors: FieldError[]
  // Action data, new per submit
  attempt: unknown
}) {
  return (
    <>
      {conflict ? (
        <p
          role="alert"
          className="mb-8 border-4 border-danger bg-surface-raised p-5 font-semibold"
        >
          {m.manage_conflict()}
        </p>
      ) : null}
      <ErrorSummary errors={errors} attempt={attempt} />
    </>
  )
}

function Submit({ intent, label }: { intent: string; label: string }) {
  return (
    <div>
      <Button type="submit" pending={useSubmitting(intent)}>
        {label}
      </Button>
    </div>
  )
}

export function StartReviewForm({ from }: { from: ReportStatus }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="start_review" />
      <input type="hidden" name="from" value={from} />
      <Button type="submit" pending={useSubmitting("start_review")}>
        {m.manage_start_review()}
      </Button>
    </Form>
  )
}

export function VerifyForm({
  from,
  contactable,
  errors,
}: {
  from: ReportStatus
  // Consent from step 7
  contactable: boolean
  errors: FieldError[]
}) {
  const methods = VERIFY_METHODS.filter(
    (method) => contactable || method !== "reporter_contact",
  )
  return (
    <Form method="post" className="flex flex-col gap-6">
      <input type="hidden" name="intent" value="verify" />
      <input type="hidden" name="from" value={from} />
      <Fieldset
        id="verify-method"
        legend={m.manage_verify_legend()}
        hint={
          contactable
            ? m.manage_verify_hint()
            : m.manage_verify_hint_no_contact()
        }
        // Shares the contact error's id
        error={errorFor(errors, "verify_method")}
      >
        {methods.map((method) => (
          <Radio
            key={method}
            id={`verify-${method}`}
            name="method"
            value={method}
            label={METHOD_TEXT[method]()}
          />
        ))}
      </Fieldset>
      <Submit intent="verify" label={m.manage_verify()} />
    </Form>
  )
}

function ReasonText({
  id,
  errors,
  errorKey,
}: {
  id: string
  errors: FieldError[]
  errorKey: ReviewErrorKey
}) {
  return (
    <Textarea
      id={id}
      name="reasonText"
      label={m.manage_reason_text_label()}
      hint={m.manage_reason_text_hint(REASON_TEXT_LENGTH)}
      error={errorFor(errors, errorKey)}
      maxLength={REASON_TEXT_LENGTH.max}
    />
  )
}

// PLAN §5.10: cite a standard
export function RejectForm({
  from,
  errors,
}: {
  from: ReportStatus
  errors: FieldError[]
}) {
  return (
    <Form method="post" className="flex flex-col gap-6">
      <input type="hidden" name="intent" value="reject" />
      <input type="hidden" name="from" value={from} />
      <Select
        id={FIELD_IDS.reject_reason}
        name="reason"
        label={m.manage_reject_reason_label()}
        hint={m.manage_reject_reason_hint()}
        error={errorFor(errors, "reject_reason")}
        defaultValue=""
      >
        <option value="">{m.location_choose()}</option>
        {REJECT_REASONS.map((reason) => (
          <option key={reason} value={reason}>
            {rejectReasonText(reason)}
          </option>
        ))}
      </Select>
      <ReasonText
        id={FIELD_IDS.reject_text}
        errors={errors}
        errorKey="reject_text"
      />
      <Submit intent="reject" label={m.manage_action_reject()} />
    </Form>
  )
}

export function UnverifiableForm({
  from,
  errors,
}: {
  from: ReportStatus
  errors: FieldError[]
}) {
  return (
    <Form method="post" className="flex flex-col gap-6">
      <input type="hidden" name="intent" value="mark_unverifiable" />
      <input type="hidden" name="from" value={from} />
      <Fieldset
        id="unverifiable-reason"
        legend={m.manage_unverifiable_reason_label()}
        error={errorFor(errors, "unverifiable_reason")}
      >
        {UNVERIFIABLE_REASONS.map((reason) => (
          <Radio
            key={reason}
            id={`unverifiable-${reason}`}
            name="reason"
            value={reason}
            label={UNVERIFIABLE_TEXT[reason]()}
          />
        ))}
      </Fieldset>
      <ReasonText
        id={FIELD_IDS.unverifiable_text}
        errors={errors}
        errorKey="unverifiable_text"
      />
      <Submit
        intent="mark_unverifiable"
        label={m.manage_action_mark_unverifiable()}
      />
    </Form>
  )
}

export function ForwardForm({
  targets,
  errors,
}: {
  targets: ForwardTarget[]
  errors: FieldError[]
}) {
  if (targets.length === 0) {
    return <p className="text-ink-muted">{m.manage_forward_none()}</p>
  }
  return (
    <Form method="post" className="flex flex-col gap-6">
      <input type="hidden" name="intent" value="forward" />
      <Select
        id={FIELD_IDS.forward_target}
        name="targetOrgId"
        label={m.manage_forward_label()}
        hint={m.manage_forward_hint()}
        error={errorFor(errors, "forward_target")}
        defaultValue=""
      >
        <option value="">{m.location_choose()}</option>
        {targets.map((target) => (
          <option key={target.id} value={target.id}>
            {target.name}
          </option>
        ))}
      </Select>
      <Submit intent="forward" label={m.manage_action_forward()} />
    </Form>
  )
}

// No JS: CSS shows branch
export function MergeForm({
  defaultTitle,
  targets,
  search,
  errors,
}: {
  defaultTitle: string
  targets: MergeTargetOption[]
  search: string
  errors: FieldError[]
}) {
  const existing = search !== "" || Boolean(errorFor(errors, "merge_issue"))
  // Search stays open after misses
  const noTargets = targets.length === 0 && search === ""
  return (
    <>
      {/* GET search, fields point here */}
      <Form id="merge-search" method="get" preventScrollReset />
      <Form method="post" className="group flex flex-col gap-6">
        <input type="hidden" name="intent" value="merge" />
        <Fieldset id="merge-target" legend={m.manage_merge_target_legend()}>
          <Radio
            id="merge-target-new"
            name="target"
            value="new"
            label={m.manage_merge_new()}
            defaultChecked={!existing || noTargets}
          />
          <div className="mt-2 mb-4 ml-8 flex flex-col gap-6 border-line-subtle border-l-4 pl-4 group-has-[#merge-target-existing:checked]:hidden">
            <TextInput
              id={FIELD_IDS.issue_title}
              name="title"
              label={m.manage_issue_title_label()}
              hint={m.manage_issue_title_hint(ISSUE_TITLE_LENGTH)}
              error={errorFor(errors, "issue_title")}
              defaultValue={defaultTitle}
            />
            <Textarea
              id={FIELD_IDS.issue_summary}
              name="summary"
              label={m.manage_issue_summary_label()}
              hint={m.manage_issue_summary_hint(ISSUE_SUMMARY_LENGTH)}
              error={errorFor(errors, "issue_summary")}
            />
          </div>
          <Radio
            id="merge-target-existing"
            name="target"
            value="existing"
            label={m.manage_merge_existing()}
            hint={noTargets ? m.manage_merge_no_issues() : undefined}
            defaultChecked={existing && !noTargets}
            disabled={noTargets}
          />
          {noTargets ? null : (
            <div className="mt-2 ml-8 flex flex-col gap-6 border-line-subtle border-l-4 pl-4 group-has-[#merge-target-new:checked]:hidden">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <TextInput
                  id="merge-search-input"
                  name="cari"
                  type="search"
                  form="merge-search"
                  label={m.manage_merge_search_label()}
                  hint={m.manage_merge_search_hint()}
                  defaultValue={search}
                  className="flex-1"
                />
                <Button type="submit" form="merge-search" variant="secondary">
                  {m.manage_merge_search_submit()}
                </Button>
              </div>
              {targets.length === 0 ? (
                <p className="text-ink-muted">{m.manage_merge_no_match()}</p>
              ) : (
                <Select
                  id={FIELD_IDS.merge_issue}
                  name="issueId"
                  label={m.manage_merge_issue_label()}
                  error={errorFor(errors, "merge_issue")}
                  defaultValue=""
                >
                  <option value="">{m.location_choose()}</option>
                  {targets.map((issue) => (
                    <option key={issue.id} value={issue.id}>
                      {issue.sameRegency
                        ? `${issue.code} · ${issue.title} · ${m.manage_merge_same_regency()}`
                        : `${issue.code} · ${issue.title}`}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}
        </Fieldset>
        <Submit intent="merge" label={m.manage_merge_submit()} />
      </Form>
    </>
  )
}

export function PublishForm({
  issueId,
  errors,
}: {
  issueId: string
  errors: FieldError[]
}) {
  return (
    <Form method="post" className="flex flex-col gap-6">
      <input type="hidden" name="intent" value="publish" />
      <input type="hidden" name="issueId" value={issueId} />
      <Fieldset
        id="publish-checklist"
        legend={m.manage_checklist_legend()}
        hint={m.manage_checklist_hint()}
        error={errorFor(errors, "checklist")}
      >
        {PUBLISH_CHECKLIST.map((item) => (
          <Checkbox
            key={item}
            id={`checklist-${item}`}
            name="checklist"
            value={item}
            label={CHECKLIST_TEXT[item]()}
          />
        ))}
      </Fieldset>
      <Submit intent="publish" label={m.manage_publish()} />
    </Form>
  )
}
