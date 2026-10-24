import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import type { FieldError } from "~/components/ui/error-summary"
import {
  Checkbox,
  Fieldset,
  Radio,
  Textarea,
  TextInput,
} from "~/components/ui/field"
import { Select } from "~/components/ui/select"
import { m } from "~/paraglide/messages.js"
import { CATEGORIES } from "../../../shared/categories.ts"
import { LEGAL_REASONS, type LegalReason } from "../../../shared/complaints.ts"
import { CATEGORY_TEXT, SUBCATEGORY_TEXT } from "../report/public-labels"
import type { RegencyGroup } from "../report/regions.server"
import { ActionPanel } from "./action-panel"
import { ISSUE_SUMMARY_LENGTH, ISSUE_TITLE_LENGTH } from "./fields"
import type { EditErrorKey, LegalErrorKey } from "./issue-edit.server"
import { useSubmitting } from "./submitting"

const EDIT_FIELD: Record<EditErrorKey, string> = {
  edit_title: "edit-title",
  edit_summary: "edit-summary",
  edit_subcategory: "edit-subcategory",
  edit_regency: "edit-regency",
}

const EDIT_ERROR: Record<EditErrorKey, () => string> = {
  edit_title: () => m.error_issue_title_length(ISSUE_TITLE_LENGTH),
  edit_summary: () => m.error_issue_summary_length(ISSUE_SUMMARY_LENGTH),
  edit_subcategory: m.error_edit_subcategory,
  edit_regency: m.error_edit_regency,
}

// Hide needs a published issue
const legalField = (published: boolean): Record<LegalErrorKey, string> => ({
  legal_decision: published ? "legal-hide" : "legal-remove",
  legal_reason: `legal-${LEGAL_REASONS[0]}`,
  legal_confirm: "legal-confirm",
})

const LEGAL_ERROR: Record<LegalErrorKey, () => string> = {
  legal_decision: m.error_legal_decision,
  legal_reason: m.error_legal_reason,
  legal_confirm: m.error_legal_confirm,
}

const LEGAL_REASON_TEXT: Record<LegalReason, () => string> = {
  komdigi_order: m.legal_reason_komdigi_order,
  data_subject_request: m.legal_reason_data_subject_request,
}

export function editErrors(keys: readonly EditErrorKey[]): FieldError[] {
  return keys.map((key) => ({
    fieldId: EDIT_FIELD[key],
    message: EDIT_ERROR[key](),
  }))
}

export function legalErrors(
  keys: readonly LegalErrorKey[],
  published: boolean,
): FieldError[] {
  const field = legalField(published)
  return keys.map((key) => ({
    fieldId: field[key],
    message: LEGAL_ERROR[key](),
  }))
}

const errorAt = (errors: FieldError[], id: string) =>
  errors.find((error) => error.fieldId === id)?.message

type EditValues = {
  title: string
  summary: string
  subcategoryId: string
  regencyCode: string
  version: number
}

/** PLAN §5.10 checklist fixes. */
export function EditIssueForm({
  issue,
  regencies,
  errors,
  unchanged,
}: {
  issue: EditValues
  regencies: RegencyGroup[]
  errors: FieldError[]
  unchanged: boolean
}) {
  const pending = useSubmitting("edit")
  return (
    <ActionPanel
      id="ubah-isu"
      title={m.manage_edit_title()}
      open={errors.length > 0 || unchanged}
    >
      <p className="mb-5 text-[0.95rem] text-ink-soft">
        {m.manage_edit_lead()}
      </p>
      <Form method="post" className="flex flex-col gap-6">
        <input type="hidden" name="intent" value="edit" />
        <input type="hidden" name="version" value={issue.version} />
        <TextInput
          id={EDIT_FIELD.edit_title}
          name="title"
          label={m.manage_issue_title_label()}
          hint={m.manage_issue_title_hint(ISSUE_TITLE_LENGTH)}
          error={errorAt(errors, EDIT_FIELD.edit_title)}
          defaultValue={issue.title}
        />
        <Textarea
          id={EDIT_FIELD.edit_summary}
          name="summary"
          label={m.manage_issue_summary_label()}
          hint={m.manage_issue_summary_hint(ISSUE_SUMMARY_LENGTH)}
          error={errorAt(errors, EDIT_FIELD.edit_summary)}
          defaultValue={issue.summary}
          rows={5}
        />
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <Select
            id={EDIT_FIELD.edit_subcategory}
            name="subcategoryId"
            label={m.manage_edit_category_label()}
            error={errorAt(errors, EDIT_FIELD.edit_subcategory)}
            defaultValue={issue.subcategoryId}
          >
            {CATEGORIES.map((category) => (
              <optgroup key={category.id} label={CATEGORY_TEXT[category.id]()}>
                {category.subcategories.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {SUBCATEGORY_TEXT[sub.id]()}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <Select
            id={EDIT_FIELD.edit_regency}
            name="regencyCode"
            label={m.manage_edit_regency_label()}
            error={errorAt(errors, EDIT_FIELD.edit_regency)}
            defaultValue={issue.regencyCode}
          >
            {regencies.map((province) => (
              <optgroup key={province.code} label={province.name}>
                {province.regencies.map((regency) => (
                  <option key={regency.code} value={regency.code}>
                    {regency.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        {unchanged ? (
          <p role="status" className="text-sm">
            {m.manage_edit_unchanged()}
          </p>
        ) : null}
        <div>
          <Button type="submit" pending={pending}>
            {m.manage_edit_submit()}
          </Button>
        </div>
      </Form>
    </ActionPanel>
  )
}

/** Komdigi order or data owner. */
export function LegalTakedownForm({
  version,
  published,
  errors,
}: {
  version: number
  published: boolean
  errors: FieldError[]
}) {
  const pending = useSubmitting("legal_takedown")
  const field = legalField(published)
  return (
    <ActionPanel
      id="perintah-hukum"
      title={m.manage_legal_title()}
      tone="danger"
      open={errors.length > 0}
    >
      <p className="mb-5 text-[0.95rem] text-ink-soft">
        {m.manage_legal_lead()}
      </p>
      <Form method="post" className="flex flex-col gap-6">
        <input type="hidden" name="intent" value="legal_takedown" />
        <input type="hidden" name="version" value={version} />
        <Fieldset
          id="legal-decision"
          legend={m.manage_legal_decision_legend()}
          error={errorAt(errors, field.legal_decision)}
        >
          {published ? (
            <Radio
              id="legal-hide"
              name="decision"
              value="hide"
              label={m.manage_legal_hide()}
              hint={m.manage_legal_hide_hint()}
            />
          ) : null}
          <Radio
            id="legal-remove"
            name="decision"
            value="remove"
            label={m.manage_legal_remove()}
            hint={m.manage_legal_remove_hint()}
          />
        </Fieldset>
        <Fieldset
          id="legal-reason"
          legend={m.manage_legal_reason_legend()}
          error={errorAt(errors, field.legal_reason)}
        >
          {LEGAL_REASONS.map((reason) => (
            <Radio
              key={reason}
              id={`legal-${reason}`}
              name="reason"
              value={reason}
              label={LEGAL_REASON_TEXT[reason]()}
            />
          ))}
        </Fieldset>
        <Fieldset
          id="legal-confirm-group"
          legend={m.manage_close_confirm_legend()}
          error={errorAt(errors, field.legal_confirm)}
        >
          <Checkbox
            id={field.legal_confirm}
            name="confirm"
            value="yes"
            label={m.manage_legal_confirm()}
          />
        </Fieldset>
        <div>
          <Button type="submit" variant="danger" pending={pending}>
            {m.manage_legal_submit()}
          </Button>
        </div>
      </Form>
    </ActionPanel>
  )
}
