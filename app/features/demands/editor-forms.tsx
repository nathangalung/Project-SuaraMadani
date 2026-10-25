import { ArrowDown, ArrowUp, FileText } from "lucide-react"
import { Fragment, type MouseEvent, useEffect, useRef, useState } from "react"
import { Form } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import type { FieldError } from "~/components/ui/error-summary"
import { Fieldset, Radio, Textarea, TextInput } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { Select } from "~/components/ui/select"
import { m } from "~/paraglide/messages.js"
import {
  BRIEF_URL_MAX,
  briefTooLarge,
  DEMAND_CATEGORIES,
  DEMAND_LENGTHS,
  MAX_DEMAND_ISSUES,
} from "../../../shared/demands.ts"
import {
  formatDate,
  formatFileSize,
  formatIsoDate,
} from "../../../shared/format.ts"
import {
  FULFILMENT_STATUSES,
  RESPONSE_STATUSES,
} from "../../../shared/status.ts"
import { ActionPanel } from "../moderation/action-panel"
import { useSubmitting } from "../moderation/submitting"
import { useHydrated } from "../report/hydrated"
import type { RegencyGroup } from "../report/regions.server"
import { CATEGORY_TEXT } from "./category-labels"
import { type DemandErrorKey, lastStatusOn } from "./demand-form"
import { briefUrl } from "./demand-href"
import { ItemUpdates } from "./item-updates"
import { FULFILMENT_TEXT, RESPONSE_TEXT } from "./labels"
import type { DemandFields, ManagedDemand, ManagedItem } from "./manage.server"
import { FulfilmentMark, ResponseMark } from "./status-mark"

const L = DEMAND_LENGTHS

const FIELD_ID: Record<DemandErrorKey, string> = {
  scope: "demand-scope",
  province: "demand-province",
  regency: "demand-regency",
  category: "demand-category",
  publish_category: "demand-publish",
  title: "demand-title",
  body: "demand-body",
  summary: "demand-summary",
  target: "demand-target",
  raised_on: "demand-raised-on",
  raised_after_updates: "demand-raised-on",
  brief_url: "demand-brief-url",
  items: "demand-items",
  publish_items: "demand-publish",
  issues_too_many: "issue-code",
  item_body: "item-body",
  item_brief_url: "item-brief-url",
  brief_summary: "item-brief-summary",
  occurred_on: "update-occurred-on",
  occurred_before_last: "update-occurred-on",
  note: "update-note",
  source_text: "update-source-text",
  source_url: "update-source-url",
  status: "update-status",
  close_note: "close-note",
  issue_code: "issue-code",
  brief_file: "brief-file",
  demand_closed: "demand-state",
}

const ERROR_TEXT: Record<DemandErrorKey, () => string> = {
  scope: m.demand_error_scope,
  province: m.demand_error_province,
  regency: m.demand_error_regency,
  category: m.demand_error_category,
  publish_category: m.demand_publish_needs_category,
  title: () => m.demand_error_title(L.title),
  body: () => m.demand_error_body(L.body),
  summary: () => m.demand_error_summary(L.summary),
  target: () => m.demand_error_target(L.target),
  raised_on: m.demand_error_raised_on,
  raised_after_updates: m.demand_error_raised_after_updates,
  brief_url: () => m.demand_error_brief_url({ max: BRIEF_URL_MAX }),
  items: () => m.demand_error_items(L.item),
  publish_items: m.demand_publish_needs_items,
  issues_too_many: () =>
    m.demand_error_issues_too_many({ max: MAX_DEMAND_ISSUES }),
  item_body: () => m.demand_error_item_body(L.item),
  item_brief_url: () => m.demand_error_brief_url({ max: BRIEF_URL_MAX }),
  brief_summary: () => m.demand_error_brief_summary(L.briefSummary),
  occurred_on: m.demand_error_occurred_on,
  occurred_before_last: m.demand_error_occurred_before_last,
  note: () => m.demand_error_note(L.note),
  source_text: () => m.demand_error_source_text(L.source),
  source_url: m.demand_error_source_url,
  status: m.demand_error_status,
  close_note: () => m.demand_error_close_note(L.closeNote),
  issue_code: m.demand_error_issue_code,
  brief_file: m.demand_error_brief_file,
  demand_closed: m.demand_error_closed,
}

/** Ids prefixed per item form. */
export function demandErrors(
  keys: readonly DemandErrorKey[],
  itemId?: string,
): FieldError[] {
  return keys.map((key) => ({
    fieldId: itemId ? `${FIELD_ID[key]}-${itemId}` : FIELD_ID[key],
    message: ERROR_TEXT[key](),
  }))
}

const at = (errors: FieldError[], id: string) =>
  errors.find((error) => error.fieldId === id)?.message

export type ItemPanel = "catat" | "brief" | "ubah"

const PANEL_OF: Partial<Record<string, ItemPanel>> = {
  update_item: "catat",
  edit_item: "ubah",
  edit_brief: "brief",
  publish_brief: "brief",
  withdraw_brief: "brief",
}

/** Failed intent to its panel. */
export function panelOf(intent: string): ItemPanel | null {
  return PANEL_OF[intent] ?? null
}

// Typed text, no-JS error
export type ItemValues = {
  body?: string
  briefSummary?: string
  briefUrl?: string
}

/** Optional brief link field. */
function BriefUrlInput({
  id,
  defaultValue,
  error,
}: {
  id: string
  defaultValue?: string
  error?: string
}) {
  return (
    <TextInput
      id={id}
      name="briefUrl"
      type="url"
      inputMode="url"
      label={m.demand_field_brief_url()}
      hint={m.demand_field_brief_url_hint()}
      defaultValue={defaultValue}
      maxLength={BRIEF_URL_MAX}
      error={error}
      optional
    />
  )
}

function Submit({
  intent,
  label,
  variant,
}: {
  intent: string
  label: string
  variant?: "primary" | "secondary" | "danger"
}) {
  return (
    <div>
      <Button
        type="submit"
        name="intent"
        value={intent}
        variant={variant}
        pending={useSubmitting(intent)}
      >
        {label}
      </Button>
    </div>
  )
}

/** Create and edit share it. */
export function DemandFieldsForm({
  values,
  regencies,
  errors,
  intent,
  version,
  withItems,
}: {
  values: Partial<Record<keyof DemandFields | "items", string | null>>
  regencies: RegencyGroup[]
  errors: FieldError[]
  intent: "create" | "edit"
  version?: number
  withItems?: boolean
}) {
  const hydrated = useHydrated()
  const [province, setProvince] = useState(values.provinceCode ?? "")
  // No JS: every group stays
  const shown =
    hydrated && province
      ? regencies.filter((group) => group.code === province)
      : regencies
  return (
    <Form method="post" className="flex flex-col gap-6">
      {version ? <input type="hidden" name="version" value={version} /> : null}
      <Fieldset
        id={FIELD_ID.scope}
        legend={m.demand_field_scope()}
        error={at(errors, FIELD_ID.scope)}
        requiredMark
      >
        <Radio
          id="demand-scope-national"
          name="scope"
          value="national"
          defaultChecked={values.scope === "national"}
          label={m.demand_scope_national()}
          hint={m.demand_field_scope_national_hint()}
        />
        <Radio
          id="demand-scope-regional"
          name="scope"
          value="regional"
          defaultChecked={values.scope !== "national"}
          label={m.demand_scope_regional()}
          hint={m.demand_field_scope_regional_hint()}
        />
      </Fieldset>
      <div className="grid gap-6 sm:grid-cols-2 sm:items-end">
        <Select
          id={FIELD_ID.province}
          name="provinceCode"
          label={m.demands_filter_province()}
          hint={m.demand_field_province_hint()}
          defaultValue={values.provinceCode ?? ""}
          onChange={(event) => setProvince(event.currentTarget.value)}
          error={at(errors, FIELD_ID.province)}
        >
          <option value="">{m.demand_field_none()}</option>
          {regencies.map((province) => (
            <option key={province.code} value={province.code}>
              {province.name}
            </option>
          ))}
        </Select>
        <Select
          // New province, empty choice
          key={hydrated ? province : "all"}
          id={FIELD_ID.regency}
          name="regencyCode"
          label={m.demand_field_regency()}
          hint={m.demand_field_regency_hint()}
          defaultValue={
            !hydrated || province === values.provinceCode
              ? (values.regencyCode ?? "")
              : ""
          }
          error={at(errors, FIELD_ID.regency)}
          optional
        >
          <option value="">{m.demand_field_none()}</option>
          {shown.map((group) => (
            <optgroup key={group.code} label={group.name}>
              {group.regencies.map((regency) => (
                <option key={regency.code} value={regency.code}>
                  {regency.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <Select
        id={FIELD_ID.category}
        name="category"
        label={m.demand_field_category()}
        hint={m.demand_field_category_hint()}
        defaultValue={values.category ?? ""}
        error={at(errors, FIELD_ID.category)}
        requiredMark
      >
        <option value="">{m.demand_field_category_choose()}</option>
        {DEMAND_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {CATEGORY_TEXT[category]()}
          </option>
        ))}
      </Select>
      <Note>{m.demand_neutral_guide()}</Note>
      <TextInput
        id={FIELD_ID.title}
        name="title"
        label={m.demand_field_title()}
        defaultValue={values.title ?? undefined}
        maxLength={L.title.max}
        error={at(errors, FIELD_ID.title)}
        requiredMark
      />
      <Textarea
        id={FIELD_ID.body}
        name="body"
        label={m.demand_field_text()}
        hint={m.demand_field_body_hint()}
        defaultValue={values.body ?? undefined}
        maxLength={L.body.max}
        error={at(errors, FIELD_ID.body)}
        requiredMark
      />
      <Textarea
        id={FIELD_ID.summary}
        name="summary"
        label={m.demand_field_summary()}
        hint={m.demand_field_summary_hint()}
        defaultValue={values.summary ?? undefined}
        maxLength={L.summary.max}
        error={at(errors, FIELD_ID.summary)}
        requiredMark
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextInput
          id={FIELD_ID.target}
          name="target"
          label={m.demand_field_target()}
          hint={m.demand_field_target_hint()}
          defaultValue={values.target ?? undefined}
          maxLength={L.target.max}
          error={at(errors, FIELD_ID.target)}
          requiredMark
        />
        <TextInput
          id={FIELD_ID.raised_on}
          name="raisedOn"
          type="date"
          label={m.demand_field_raised_on()}
          hint={m.demand_field_raised_on_hint()}
          defaultValue={values.raisedOn ?? undefined}
          error={at(errors, FIELD_ID.raised_on)}
          requiredMark
        />
      </div>
      <BriefUrlInput
        id={FIELD_ID.brief_url}
        defaultValue={values.briefUrl ?? undefined}
        error={at(errors, FIELD_ID.brief_url)}
      />
      {withItems ? (
        <Textarea
          id={FIELD_ID.items}
          name="items"
          label={m.demand_items_title()}
          hint={m.demand_field_items_hint()}
          defaultValue={values.items ?? undefined}
          error={at(errors, FIELD_ID.items)}
        />
      ) : null}
      <Submit
        intent={intent}
        label={
          intent === "create"
            ? m.demand_create_submit()
            : m.demand_edit_submit()
        }
      />
    </Form>
  )
}

/** Publish, close, reopen, delete. */
/** Draft text before publishing. */
export function DraftPreview({ demand }: { demand: ManagedDemand }) {
  return (
    <div className="border border-line-subtle bg-surface-raised p-5">
      <h3 className="font-bold text-lg">{m.demand_draft_preview_title()}</h3>
      <p className="mt-1 text-ink-soft text-sm">
        {m.demand_draft_preview_lead()}
      </p>
      <p className="mt-4 text-ink-soft text-sm">
        {m.demand_draft_preview_meta({
          target: demand.target,
          date: formatIsoDate(demand.raisedOn),
        })}
      </p>
      <p className="mt-3 whitespace-pre-line leading-relaxed">
        {demand.summary}
      </p>
      <h4 className="mt-5 font-semibold">{m.demand_draft_preview_text()}</h4>
      <blockquote className="mt-2 whitespace-pre-line text-lg leading-relaxed">
        {demand.body}
      </blockquote>
    </div>
  )
}

export function StateForms({
  demand,
  errors,
}: {
  demand: ManagedDemand
  errors: FieldError[]
}) {
  const version = <input type="hidden" name="version" value={demand.version} />
  if (demand.state === "draft") {
    const refused = at(errors, FIELD_ID.publish_items)
    return (
      <div className="flex flex-col gap-3">
        {/* Second click: no blind publish */}
        <ActionPanel
          id="terbitkan"
          title={m.demand_publish_submit()}
          open={Boolean(refused)}
        >
          <Form method="post" className="flex flex-col gap-3">
            {version}
            <p
              id={FIELD_ID.publish_items}
              tabIndex={-1}
              className="text-ink-soft"
            >
              {demand.items.length === 0
                ? m.demand_publish_needs_items()
                : demand.category
                  ? m.demand_publish_lead()
                  : m.demand_publish_needs_category()}
            </p>
            {refused ? (
              <p className="font-semibold text-danger-ink">{refused}</p>
            ) : null}
            <Submit intent="publish" label={m.demand_publish_submit()} />
          </Form>
        </ActionPanel>
        {demand.publishedAt === null ? (
          <ActionPanel id="hapus" title={m.demand_delete_title()} tone="danger">
            <Form method="post" className="flex flex-col gap-3">
              <p className="text-ink-soft">{m.demand_delete_lead()}</p>
              <Submit
                intent="delete"
                label={m.demand_delete_submit()}
                variant="danger"
              />
            </Form>
          </ActionPanel>
        ) : null}
      </div>
    )
  }
  if (demand.state === "closed") {
    return (
      <Form method="post" className="flex flex-col gap-3">
        {version}
        <p className="text-ink-soft">{m.demand_reopen_lead()}</p>
        <Submit
          intent="reopen"
          label={m.demand_reopen_submit()}
          variant="secondary"
        />
      </Form>
    )
  }
  return (
    <ActionPanel id="tutup" title={m.demand_close_title()}>
      <Form method="post" className="flex flex-col gap-4">
        {version}
        <Textarea
          id={FIELD_ID.close_note}
          name="note"
          label={m.demand_close_note()}
          hint={m.demand_close_note_hint()}
          maxLength={L.closeNote.max}
          error={at(errors, FIELD_ID.close_note)}
          requiredMark
        />
        <Submit
          intent="close"
          label={m.demand_close_submit()}
          variant="secondary"
        />
      </Form>
    </ActionPanel>
  )
}

const BRIEF_STATUS_TEXT = {
  pending: m.demand_brief_pending,
  clean: m.demand_brief_clean,
  infected: m.demand_brief_infected,
} as const

function BriefPanel({
  demand,
  item,
  errors,
  values,
}: {
  demand: ManagedDemand
  item: ManagedItem
  errors: FieldError[]
  values?: ItemValues
}) {
  const id = (key: DemandErrorKey) => `${FIELD_ID[key]}-${item.id}`
  const [tooLarge, setTooLarge] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      {item.briefs.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {item.briefs.map((brief) => (
            <li
              key={brief.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-line-subtle border-b pb-2"
            >
              <FileText aria-hidden="true" className="size-4 text-brand" />
              <span className="text-sm">{formatDate(brief.createdAt)}</span>
              <span className="text-sm">{formatFileSize(brief.byteSize)}</span>
              <Badge tone={brief.status === "infected" ? "danger" : "neutral"}>
                {brief.publishedAt
                  ? m.demand_brief_published({
                      date: formatDate(brief.publishedAt),
                    })
                  : BRIEF_STATUS_TEXT[brief.status]()}
              </Badge>
              {brief.publishedAt && demand.state !== "draft" ? (
                <a
                  href={briefUrl(demand.code, brief.id)}
                  className="font-semibold text-accent text-sm underline underline-offset-4"
                >
                  {m.demand_brief_open()}
                </a>
              ) : null}
              {brief.status === "clean" &&
              !brief.publishedAt &&
              !demand.frozen ? (
                <Form method="post">
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="briefId" value={brief.id} />
                  <Submit
                    intent="publish_brief"
                    label={m.demand_brief_publish_submit()}
                    variant="secondary"
                  />
                </Form>
              ) : null}
              {brief.publishedAt ? (
                <Form method="post">
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="briefId" value={brief.id} />
                  <Submit
                    intent="withdraw_brief"
                    label={m.demand_brief_withdraw_submit()}
                    variant="danger"
                  />
                </Form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">{m.demand_brief_missing()}</p>
      )}
      {item.briefs.some((brief) => brief.publishedAt) ? (
        <p className="text-ink-muted text-sm">
          {m.demand_brief_withdraw_hint()}
        </p>
      ) : null}
      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="version" value={item.version} />
        <Textarea
          id={id("brief_summary")}
          name="briefSummary"
          label={m.demand_item_brief_summary()}
          hint={m.demand_item_brief_summary_hint()}
          defaultValue={values?.briefSummary ?? item.briefSummary ?? ""}
          maxLength={L.briefSummary.max}
          error={at(errors, id("brief_summary"))}
          optional
        />
        <Submit
          intent="edit_brief"
          label={m.demand_brief_summary_save()}
          variant="secondary"
        />
      </Form>
      {demand.frozen ? null : (
        <Form
          method="post"
          action={`/kelola/tuntutan/${demand.code}/unggah`}
          encType="multipart/form-data"
          reloadDocument
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            const input = event.currentTarget.elements.namedItem("brief")
            const file =
              input instanceof HTMLInputElement ? input.files?.[0] : undefined
            // No doomed 10 MB upload
            const large = briefTooLarge(file)
            setTooLarge(large)
            if (large) event.preventDefault()
          }}
        >
          <input type="hidden" name="itemId" value={item.id} />
          <TextInput
            id={`${FIELD_ID.brief_file}-${item.id}`}
            name="brief"
            type="file"
            accept="application/pdf"
            label={m.demand_brief_upload_label()}
            hint={m.demand_brief_upload_hint()}
            error={tooLarge ? m.demand_upload_too_large() : undefined}
            requiredMark
          />
          <div>
            <Button type="submit" variant="secondary">
              {m.demand_brief_upload_submit()}
            </Button>
          </div>
        </Form>
      )}
    </div>
  )
}

function UpdateForm({
  demand,
  item,
  errors,
  today,
}: {
  demand: ManagedDemand
  item: ManagedItem
  errors: FieldError[]
  today: string
}) {
  const id = (key: DemandErrorKey) => `${FIELD_ID[key]}-${item.id}`
  const floor = lastStatusOn(item.updates)
  // Responses are never withdrawn
  const responded = item.state.response === "responded"
  return (
    <Form method="post" className="flex flex-col gap-5">
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="version" value={item.version} />
      <p id={id("status")} className="text-ink-soft text-sm">
        {m.demand_update_lead()}
      </p>
      {/* Fresh fields, focus kept */}
      <Fragment key={`${item.version}-${item.updates.length}`}>
        {at(errors, id("status")) ? (
          <p className="font-semibold text-danger-ink">
            {at(errors, id("status"))}
          </p>
        ) : null}
        <div className="grid gap-5 sm:grid-cols-2 sm:items-end">
          <Select
            id={`update-response-${item.id}`}
            name="response"
            label={m.demands_col_response()}
            defaultValue={item.state.response}
          >
            {RESPONSE_STATUSES.filter(
              (status) => !responded || status === "responded",
            ).map((status) => (
              <option key={status} value={status}>
                {RESPONSE_TEXT[status]()}
              </option>
            ))}
          </Select>
          <Select
            id={`update-fulfilment-${item.id}`}
            name="fulfilment"
            label={m.demands_col_fulfilment()}
            hint={m.demand_update_rejected_hint()}
            defaultValue={item.state.fulfilment}
          >
            {FULFILMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {FULFILMENT_TEXT[status]()}
              </option>
            ))}
          </Select>
        </div>
        <TextInput
          id={id("occurred_on")}
          name="occurredOn"
          type="date"
          min={demand.raisedOn}
          max={today}
          defaultValue={today}
          label={m.demand_update_date()}
          hint={
            floor
              ? m.demand_update_date_floor({ date: formatIsoDate(floor) })
              : undefined
          }
          error={at(errors, id("occurred_on"))}
          requiredMark
        />
        <Textarea
          id={id("note")}
          name="note"
          label={m.demand_update_note()}
          hint={m.demand_update_note_hint()}
          maxLength={L.note.max}
          error={at(errors, id("note"))}
          requiredMark
        />
        <div className="grid gap-5 sm:grid-cols-2 sm:items-end">
          <TextInput
            id={id("source_text")}
            name="sourceText"
            label={m.demand_update_source()}
            hint={m.demand_update_source_hint()}
            maxLength={L.source.max}
            error={at(errors, id("source_text"))}
            requiredMark
          />
          <TextInput
            id={id("source_url")}
            name="sourceUrl"
            type="url"
            label={m.demand_update_source_url()}
            error={at(errors, id("source_url"))}
            optional
          />
        </div>
      </Fragment>
      <Submit intent="update_item" label={m.demand_update_submit()} />
    </Form>
  )
}

function ItemTextForm({
  item,
  errors,
  values,
}: {
  item: ManagedItem
  errors: FieldError[]
  values?: ItemValues
}) {
  const id = (key: DemandErrorKey) => `${FIELD_ID[key]}-${item.id}`
  return (
    <Form method="post" className="flex flex-col gap-5">
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="version" value={item.version} />
      <Textarea
        id={id("item_body")}
        name="body"
        label={m.demand_item_body()}
        defaultValue={values?.body ?? item.body}
        maxLength={L.item.max}
        error={at(errors, id("item_body"))}
        requiredMark
      />
      <BriefUrlInput
        id={id("item_brief_url")}
        defaultValue={values?.briefUrl ?? item.briefUrl ?? ""}
        error={at(errors, id("item_brief_url"))}
      />
      <Submit intent="edit_item" label={m.demand_item_save()} />
    </Form>
  )
}

export type EditorNotice = {
  tone: "success" | "info" | "danger"
  text: string
}

// Moves report at the arrows
export type ItemSpot = ItemPanel | "head"

/** Feedback beside the form used. */
export function EditorNote({
  notice,
  className,
}: {
  notice: EditorNotice | null | undefined
  className?: string
}) {
  if (!notice) return null
  return (
    <Note tone={notice.tone} className={className}>
      <p role="status">{notice.text}</p>
    </Note>
  )
}

// Edge: focus stays, inert
const stay = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault()
// data-edge outranks the pending cursor
const EDGE = "data-edge:cursor-not-allowed data-edge:opacity-50"

/** One sub-tuntutan, all its forms. */
export function ItemEditor({
  demand,
  item,
  index,
  errors,
  today,
  open,
  values,
  notice,
}: {
  demand: ManagedDemand
  item: ManagedItem
  index: number
  errors: FieldError[]
  today: string
  // Failed form stays open
  open: ItemPanel | null
  values?: ItemValues
  // Shown after the form used
  notice?: { notice: EditorNotice; at: ItemSpot } | null
}) {
  const noteAt = (spot: ItemSpot, className: string) =>
    notice?.at === spot ? (
      <EditorNote notice={notice.notice} className={className} />
    ) : null
  const opened = (panel: ItemPanel) => open === panel || notice?.at === panel
  const row = useRef<HTMLLIElement>(null)
  const arrows = useRef<HTMLFormElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per move
  useEffect(() => {
    // Moved off screen: follow it
    const form = arrows.current
    if (!form?.contains(document.activeElement)) return
    const { top, bottom } = form.getBoundingClientRect()
    if (top < 96 || bottom > window.innerHeight) {
      row.current?.scrollIntoView({ block: "start" })
    }
  }, [index])
  const first = index === 0
  const last = index === demand.items.length - 1
  return (
    <li
      ref={row}
      id={`sub-${item.id}`}
      className="scroll-mt-24 border border-line-subtle bg-surface-raised p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="font-bold text-lg leading-snug">
          {/* The list already numbers */}
          <span aria-hidden="true" className="mr-2 text-accent tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          {item.body}
        </h3>
        <Form ref={arrows} method="post" className="flex gap-1">
          <input type="hidden" name="itemId" value={item.id} />
          <Button
            type="submit"
            name="intent"
            value="move_up"
            variant="quiet"
            size="sm"
            className={EDGE}
            aria-disabled={first || undefined}
            data-edge={first || undefined}
            onClick={first ? stay : undefined}
            aria-label={m.demand_item_move_up({ n: String(index + 1) })}
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="submit"
            name="intent"
            value="move_down"
            variant="quiet"
            size="sm"
            className={EDGE}
            aria-disabled={last || undefined}
            data-edge={last || undefined}
            onClick={last ? stay : undefined}
            aria-label={m.demand_item_move_down({ n: String(index + 1) })}
          >
            <ArrowDown aria-hidden="true" className="size-4" />
          </Button>
        </Form>
      </div>
      {noteAt("head", "mt-3")}
      <p className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
        <ResponseMark status={item.state.response} />
        <FulfilmentMark status={item.state.fulfilment} />
      </p>
      <h4 className="mt-4 font-bold">{m.demand_updates_title()}</h4>
      <ItemUpdates updates={item.updates} withStatus />
      <div className="mt-4 flex flex-col gap-3">
        {demand.frozen ? null : (
          <ActionPanel
            id={`catat-${item.id}`}
            title={m.demand_update_title()}
            open={opened("catat")}
          >
            <UpdateForm
              demand={demand}
              item={item}
              errors={errors}
              today={today}
            />
            {noteAt("catat", "mt-5")}
          </ActionPanel>
        )}
        <ActionPanel
          id={`brief-${item.id}`}
          title={m.demand_brief_panel()}
          open={opened("brief")}
        >
          <BriefPanel
            demand={demand}
            item={item}
            errors={errors}
            values={values}
          />
          {noteAt("brief", "mt-5")}
        </ActionPanel>
        <ActionPanel
          id={`ubah-${item.id}`}
          title={m.demand_item_edit_title()}
          open={opened("ubah")}
        >
          <ItemTextForm item={item} errors={errors} values={values} />
          {noteAt("ubah", "mt-5")}
        </ActionPanel>
        {demand.publishedAt === null ? (
          <Form method="post">
            <input type="hidden" name="itemId" value={item.id} />
            <Submit
              intent="remove_item"
              label={m.demand_item_remove()}
              variant="secondary"
            />
          </Form>
        ) : null}
      </div>
    </li>
  )
}

export function AddItemForm({
  errors,
  values,
}: {
  errors: FieldError[]
  values?: ItemValues
}) {
  return (
    <Form method="post" className="flex flex-col gap-4">
      <Textarea
        id={FIELD_ID.item_body}
        name="body"
        label={m.demand_item_new()}
        hint={m.demand_item_new_hint()}
        defaultValue={values?.body}
        maxLength={L.item.max}
        error={at(errors, FIELD_ID.item_body)}
        requiredMark
      />
      <BriefUrlInput
        id={FIELD_ID.item_brief_url}
        defaultValue={values?.briefUrl}
        error={at(errors, FIELD_ID.item_brief_url)}
      />
      <Submit
        intent="add_item"
        label={m.demand_item_add()}
        variant="secondary"
      />
    </Form>
  )
}

export function IssueLinks({
  demand,
  errors,
}: {
  demand: ManagedDemand
  errors: FieldError[]
}) {
  return (
    <div className="flex flex-col gap-5">
      {demand.issues.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {demand.issues.map((issue) => (
            <li
              key={issue.code}
              className="flex flex-wrap items-center justify-between gap-3 border-line-subtle border-b pb-2"
            >
              <span className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-sm tabular-nums">{issue.code}</span>
                <span>{issue.title}</span>
                {issue.published ? null : (
                  <span className="text-ink-muted">
                    {m.manage_issue_unpublished()}
                  </span>
                )}
              </span>
              <Form method="post">
                <input type="hidden" name="issueCode" value={issue.code} />
                <Submit
                  intent="unlink_issue"
                  label={m.demand_issue_unlink()}
                  variant="secondary"
                />
              </Form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">{m.demand_issues_none()}</p>
      )}
      <Form method="post" className="flex flex-col gap-3">
        <TextInput
          id={FIELD_ID.issue_code}
          name="issueCode"
          label={m.demand_issue_code()}
          hint={m.demand_issue_code_hint()}
          error={at(errors, FIELD_ID.issue_code)}
        />
        <Submit
          intent="link_issue"
          label={m.demand_issue_link()}
          variant="secondary"
        />
      </Form>
    </div>
  )
}
