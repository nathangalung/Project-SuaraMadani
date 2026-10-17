import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import type { FieldError } from "~/components/ui/error-summary"
import { Textarea, TextInput } from "~/components/ui/field"
import { Select } from "~/components/ui/select"
import { m } from "~/paraglide/messages.js"
import {
  ESCALATION_CHANNELS,
  MODERATION_LENGTHS,
  REFERRAL_CHANNELS,
} from "../../../shared/moderation.ts"
import type { IssueAction, IssueState } from "../../../shared/status.ts"
import { CHANNEL_TEXT } from "../issues/labels"
import { ActionPanel } from "./action-panel"
import type { IssueErrorKey } from "./fields"
import { NOTE_REQUIRED } from "./issue-form"
import { ISSUE_ACTION_TEXT, optionText } from "./labels"
import { useSubmitting } from "./submitting"

const L = MODERATION_LENGTHS

const ERROR_TEXT: Record<IssueErrorKey, () => string> = {
  agency: () => m.error_agency_length(L.agency),
  channel: m.error_channel_required,
  ticket: () => m.error_ticket_length(L.ticket),
  sent_on: m.error_sent_on,
  deadline_on: m.error_deadline_on,
  response_agency: () => m.error_agency_length(L.agency),
  response_body: () => m.error_response_body_length(L.responseBody),
  responded_on: m.error_responded_on,
  source_url: m.error_source_url,
  note: () => m.error_note_length(L.note),
}

// Field ids per action form
const FIELD: Record<IssueErrorKey, string> = {
  agency: "agency",
  channel: "channel",
  ticket: "ticket",
  sent_on: "sent-on",
  deadline_on: "deadline-on",
  response_agency: "response-agency",
  response_body: "response-body",
  responded_on: "responded-on",
  source_url: "source-url",
  note: "note",
}

const fieldId = (action: IssueAction, key: IssueErrorKey) =>
  `${action}-${FIELD[key]}`

export function issueErrors(
  action: IssueAction,
  keys: readonly IssueErrorKey[],
): FieldError[] {
  return keys.map((key) => ({
    fieldId: fieldId(action, key),
    message:
      key === "note" && NOTE_REQUIRED.includes(action)
        ? m.error_note_required(L.requiredNote)
        : ERROR_TEXT[key](),
  }))
}

type Failed = { action: IssueAction; errors: FieldError[] } | null

export type IssueFormDefaults = {
  // Jakarta today, from the loader
  today: string
  deadline: string
  agency: string
}

function errorOf(failed: Failed, action: IssueAction, key: IssueErrorKey) {
  if (failed?.action !== action) return undefined
  return failed.errors.find((e) => e.fieldId === fieldId(action, key))?.message
}

function State({ state, version }: { state: IssueState; version: number }) {
  return (
    <>
      <input type="hidden" name="advocacy" value={state.advocacy} />
      <input type="hidden" name="government" value={state.government} />
      <input type="hidden" name="version" value={version} />
    </>
  )
}

function ReferralFields({
  action,
  failed,
  defaults,
}: {
  action: "refer" | "escalate"
  failed: Failed
  defaults: IssueFormDefaults
}) {
  const id = (key: IssueErrorKey) => fieldId(action, key)
  const err = (key: IssueErrorKey) => errorOf(failed, action, key)
  const refer = action === "refer"
  const channels = refer ? REFERRAL_CHANNELS : ESCALATION_CHANNELS
  return (
    <>
      <TextInput
        id={id("agency")}
        name="agency"
        label={
          refer ? m.manage_field_agency() : m.manage_field_escalate_agency()
        }
        hint={
          refer
            ? m.manage_field_agency_hint()
            : m.manage_field_escalate_agency_hint()
        }
        error={err("agency")}
        defaultValue={refer ? defaults.agency : ""}
        maxLength={L.agency.max}
      />
      <Select
        id={id("channel")}
        name="channel"
        label={m.manage_field_channel()}
        error={err("channel")}
        defaultValue=""
      >
        <option value="">{m.location_choose()}</option>
        {channels.map((channel) => (
          <option key={channel} value={channel}>
            {optionText(CHANNEL_TEXT[channel]())}
          </option>
        ))}
      </Select>
      <TextInput
        id={id("ticket")}
        name="ticket"
        label={m.manage_field_ticket()}
        hint={m.manage_field_ticket_hint()}
        optional
        error={err("ticket")}
        maxLength={L.ticket.max}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextInput
          id={id("sent_on")}
          name="sentOn"
          type="date"
          label={m.manage_field_sent_on()}
          error={err("sent_on")}
          defaultValue={defaults.today}
          max={defaults.today}
        />
        <TextInput
          id={id("deadline_on")}
          name="deadlineOn"
          type="date"
          label={m.manage_field_deadline()}
          hint={
            refer
              ? m.manage_field_deadline_hint()
              : m.manage_field_escalate_deadline_hint()
          }
          optional={!refer}
          error={err("deadline_on")}
          defaultValue={refer ? defaults.deadline : ""}
        />
      </div>
    </>
  )
}

function ResponseFields({
  failed,
  defaults,
}: {
  failed: Failed
  defaults: IssueFormDefaults
}) {
  const action = "record_response"
  const id = (key: IssueErrorKey) => fieldId(action, key)
  const err = (key: IssueErrorKey) => errorOf(failed, action, key)
  return (
    <>
      <TextInput
        id={id("response_agency")}
        name="responseAgency"
        label={m.manage_field_response_agency()}
        error={err("response_agency")}
        defaultValue={defaults.agency}
        maxLength={L.agency.max}
      />
      <Textarea
        id={id("response_body")}
        name="body"
        label={m.manage_field_response_body()}
        hint={m.manage_field_response_body_hint(L.responseBody)}
        error={err("response_body")}
        maxLength={L.responseBody.max}
        rows={8}
      />
      <TextInput
        id={id("responded_on")}
        name="respondedOn"
        type="date"
        label={m.manage_field_responded_on()}
        error={err("responded_on")}
        defaultValue={defaults.today}
        max={defaults.today}
      />
      <TextInput
        id={id("source_url")}
        name="sourceUrl"
        type="url"
        label={m.manage_field_source_url()}
        hint={m.manage_field_source_url_hint()}
        error={err("source_url")}
        inputMode="url"
      />
    </>
  )
}

function NoteField({
  action,
  failed,
}: {
  action: IssueAction
  failed: Failed
}) {
  const required = NOTE_REQUIRED.includes(action)
  return (
    <Textarea
      id={fieldId(action, "note")}
      name="note"
      label={m.manage_field_note()}
      hint={
        required
          ? m.manage_field_note_required_hint(L.requiredNote)
          : m.manage_field_note_hint(L.note)
      }
      optional={!required}
      error={errorOf(failed, action, "note")}
      maxLength={L.note.max}
      rows={3}
    />
  )
}

function ActionForm({
  action,
  state,
  version,
  failed,
  defaults,
}: {
  action: IssueAction
  state: IssueState
  version: number
  failed: Failed
  defaults: IssueFormDefaults
}) {
  const label = ISSUE_ACTION_TEXT[action]()
  return (
    <ActionPanel
      id={`aksi-${action}`}
      title={label}
      open={failed?.action === action}
    >
      <Form method="post" className="flex flex-col gap-6">
        <input type="hidden" name="intent" value={action} />
        <State state={state} version={version} />
        {action === "refer" || action === "escalate" ? (
          <ReferralFields action={action} failed={failed} defaults={defaults} />
        ) : action === "record_response" ? (
          <ResponseFields failed={failed} defaults={defaults} />
        ) : (
          <NoteField action={action} failed={failed} />
        )}
        <div>
          <Button type="submit" pending={useSubmitting(action)}>
            {label}
          </Button>
        </div>
      </Form>
    </ActionPanel>
  )
}

/** One panel per allowed transition. */
export function IssueActions({
  actions,
  state,
  version,
  failed,
  defaults,
}: {
  actions: IssueAction[]
  state: IssueState
  version: number
  failed: Failed
  defaults: IssueFormDefaults
}) {
  if (actions.length === 0) {
    return <p className="text-ink-muted">{m.manage_actions_none()}</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {actions.map((action) => (
        <ActionForm
          key={action}
          action={action}
          state={state}
          version={version}
          failed={failed}
          defaults={defaults}
        />
      ))}
    </div>
  )
}
