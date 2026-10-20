import {
  DEMAND_CATEGORIES,
  DEMAND_LENGTHS,
  DEMAND_SCOPES,
  MAX_DEMAND_ITEMS,
} from "../../../shared/demands.ts"
import { isIsoDate, parseSourceUrl } from "../../../shared/moderation.ts"
import {
  canUpdateDemandItem,
  type DemandItemState,
  FULFILMENT_STATUSES,
  RESPONSE_STATUSES,
} from "../../../shared/status.ts"
import { longText, oneOf, text, UUID, within } from "../moderation/form-values"
import type { DemandFields } from "./manage.server"

// Client-safe parsing, server checks too

export type DemandErrorKey =
  | "scope"
  | "province"
  | "regency"
  | "category"
  | "publish_category"
  | "title"
  | "body"
  | "summary"
  | "target"
  | "raised_on"
  | "raised_after_updates"
  | "items"
  | "publish_items"
  | "issues_too_many"
  | "item_body"
  | "brief_summary"
  | "occurred_on"
  | "occurred_before_last"
  | "note"
  | "source_text"
  | "source_url"
  | "status"
  | "close_note"
  | "issue_code"
  | "brief_file"
  // Closed: reopen before changing
  | "demand_closed"

const L = DEMAND_LENGTHS
const EARLIEST = "2000-01-01"
const PROVINCE = /^\d{2}$/
const REGENCY = /^\d{2}\.\d{2}$/

type Parsed<T> = { ok: true } & T
type Failed = { ok: false; errors: DemandErrorKey[] }

function pastDate(value: string, from: string, today: string): boolean {
  return isIsoDate(value) && value >= from && value <= today
}

/** Caller checks region rows. */
export function parseDemandFields(
  form: FormData,
  today: string,
): Parsed<{ fields: DemandFields }> | Failed {
  const errors: DemandErrorKey[] = []
  const scope = oneOf(DEMAND_SCOPES, text(form, "scope"))
  if (!scope) errors.push("scope")
  const regional = scope === "regional"
  const province = text(form, "provinceCode")
  const regency = text(form, "regencyCode")
  const provinceOk = PROVINCE.test(province)
  if (regional && !provinceOk) errors.push("province")
  if (
    regional &&
    provinceOk &&
    regency !== "" &&
    (!REGENCY.test(regency) || !regency.startsWith(`${province}.`))
  ) {
    errors.push("regency")
  }
  const category = oneOf(DEMAND_CATEGORIES, text(form, "category"))
  if (!category) errors.push("category")
  const title = text(form, "title")
  const body = longText(form, "body")
  const summary = longText(form, "summary")
  const target = text(form, "target")
  const raisedOn = text(form, "raisedOn")
  if (!within(title, L.title)) errors.push("title")
  if (!within(body, L.body)) errors.push("body")
  if (!within(summary, L.summary)) errors.push("summary")
  if (!within(target, L.target)) errors.push("target")
  if (!pastDate(raisedOn, EARLIEST, today)) errors.push("raised_on")
  if (errors.length > 0 || !scope || !category) return { ok: false, errors }
  return {
    ok: true,
    fields: {
      scope,
      provinceCode: regional ? province : null,
      regencyCode: regional && regency ? regency : null,
      category,
      title,
      body,
      summary,
      target,
      raisedOn,
    },
  }
}

/** One sub-tuntutan per line. */
export function parseItemLines(
  value: string,
): Parsed<{ items: string[] }> | Failed {
  const items = value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
  const fits = items.every((item) => within(item, L.item))
  if (!fits || items.length > MAX_DEMAND_ITEMS) {
    return { ok: false, errors: ["items"] }
  }
  return { ok: true, items }
}

export type ItemUpdateValue = {
  itemId: string
  version: number
  to: DemandItemState | null
  occurredOn: string
  note: string
  sourceText: string
  sourceUrl: string | null
}

/** Newest-first updates to a floor. */
export function lastStatusOn(
  updates: readonly { action: string; occurredOn: string }[],
): string | null {
  return (
    updates.find((update) => update.action === "status")?.occurredOn ?? null
  )
}

/** Null means a malformed request. */
export function parseItemUpdate(
  form: FormData,
  today: string,
  raisedOn: string,
  current: DemandItemState,
  // Last status change date
  floor: string | null = null,
): Parsed<{ value: ItemUpdateValue }> | Failed | null {
  const itemId = text(form, "itemId")
  const version = text(form, "version")
  const response = oneOf(RESPONSE_STATUSES, text(form, "response"))
  const fulfilment = oneOf(FULFILMENT_STATUSES, text(form, "fulfilment"))
  if (!UUID.test(itemId) || !/^[1-9]\d{0,8}$/.test(version)) return null
  if (!response || !fulfilment) return null
  const to = { response, fulfilment }
  const moved =
    to.response !== current.response || to.fulfilment !== current.fulfilment
  if (moved && !canUpdateDemandItem(current, to)) {
    return { ok: false, errors: ["status"] }
  }
  const errors: DemandErrorKey[] = []
  const occurredOn = text(form, "occurredOn")
  const note = longText(form, "note")
  const sourceText = text(form, "sourceText")
  const rawUrl = text(form, "sourceUrl")
  const sourceUrl = rawUrl ? parseSourceUrl(rawUrl) : null
  if (!pastDate(occurredOn, raisedOn, today)) errors.push("occurred_on")
  else if (moved && floor && occurredOn < floor) {
    errors.push("occurred_before_last")
  }
  if (!within(note, L.note)) errors.push("note")
  if (!within(sourceText, L.source)) errors.push("source_text")
  if (rawUrl && !sourceUrl) errors.push("source_url")
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      itemId,
      version: Number(version),
      to: moved ? to : null,
      occurredOn,
      note,
      sourceText,
      sourceUrl,
    },
  }
}
