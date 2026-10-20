import { and, eq } from "drizzle-orm"
import { data, type RouterContextProvider, redirect } from "react-router"
import { database } from "../../../db/client.server.ts"
import { regions } from "../../../db/schema/regions.ts"
import { DEMAND_LENGTHS, normalizeDemandCode } from "../../../shared/demands.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import { DEMAND_ACTIONS, type DemandAction } from "../../../shared/status.ts"
import { normalizeIssueCode } from "../issues/issue-code.ts"
import { requireAdmin } from "../moderation/access.server.ts"
import {
  longText,
  oneOf,
  text,
  UUID,
  within,
} from "../moderation/form-values.ts"
import {
  type DemandErrorKey,
  lastStatusOn,
  parseDemandFields,
  parseItemLines,
  parseItemUpdate,
} from "./demand-form.ts"
import {
  addItem,
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandResult,
  deleteDraft,
  editDemand,
  editItem,
  getManagedDemand,
  linkIssue,
  moveItem,
  publishBrief,
  recordItemUpdate,
  removeItem,
  unlinkIssue,
  withdrawBrief,
} from "./manage.server.ts"

const EDITOR_INTENTS = [
  "edit",
  ...DEMAND_ACTIONS,
  "delete",
  "add_item",
  "edit_item",
  "move_up",
  "move_down",
  "remove_item",
  "update_item",
  "edit_brief",
  "publish_brief",
  "withdraw_brief",
  "link_issue",
  "unlink_issue",
] as const
type EditorIntent = (typeof EDITOR_INTENTS)[number]

const ITEM_INTENTS = new Set<EditorIntent>([
  "edit_item",
  "edit_brief",
  "move_up",
  "move_down",
  "remove_item",
  "update_item",
])

export type DemandActionData =
  | { conflict: true }
  // itemId: notice beside that item
  | { unchanged: true; intent: EditorIntent; itemId?: string }
  | { saved: EditorIntent; itemId?: string }
  | {
      errors: DemandErrorKey[]
      intent: EditorIntent
      itemId?: string
      values?: FormValues
    }

const L = DEMAND_LENGTHS

/** Province and regency exist. */
async function regionErrors(fields: DemandFields): Promise<DemandErrorKey[]> {
  if (fields.scope === "national") return []
  const { db } = database()
  const codes = [fields.provinceCode, fields.regencyCode].filter(
    (code): code is string => code !== null,
  )
  const found = await Promise.all(
    codes.map((code) =>
      db
        .select({ code: regions.code })
        .from(regions)
        .where(
          and(
            eq(regions.code, code),
            eq(regions.level, code.length === 2 ? 1 : 2),
          ),
        ),
    ),
  )
  const errors: DemandErrorKey[] = []
  if (found[0]?.length !== 1) errors.push("province")
  if (codes.length > 1 && found[1]?.length !== 1) errors.push("regency")
  return errors
}

type Admin = Awaited<ReturnType<typeof requireAdmin>>

const FORM_KEYS = [
  "scope",
  "provinceCode",
  "regencyCode",
  "category",
  "title",
  "body",
  "summary",
  "target",
  "raisedOn",
  "items",
  "briefSummary",
] as const
export type FormValues = Partial<Record<(typeof FORM_KEYS)[number], string>>

// Refilled after a no-JS error
function formValues(form: FormData): FormValues {
  return Object.fromEntries(
    FORM_KEYS.map((key) => [key, longText(form, key)]),
  ) as FormValues
}

function tenantOf(admin: Admin) {
  return {
    id: admin.tenant.id,
    host: admin.tenant.host,
    campusCode: admin.tenant.campusCode,
  }
}

/** New draft, then the editor. */
export async function createDemandAction({
  request,
  context,
}: {
  request: Request
  context: Readonly<RouterContextProvider>
}): Promise<{ errors: DemandErrorKey[]; values: FormValues }> {
  const admin = await requireAdmin(context)
  const form = await request.formData()
  const today = jakartaIsoDate(new Date())
  const parsed = parseDemandFields(form, today)
  const items = parseItemLines(longText(form, "items"))
  const errors = [
    ...(parsed.ok ? await regionErrors(parsed.fields) : parsed.errors),
    ...(items.ok ? [] : items.errors),
  ]
  const values = formValues(form)
  if (!parsed.ok || !items.ok || errors.length > 0) return { errors, values }
  const result = await createDemand(tenantOf(admin), {
    fields: parsed.fields,
    items: items.items,
    actorId: admin.session.user.id,
  })
  if (!result.ok) return { errors: ["items"], values }
  throw redirect(`/kelola/tuntutan/${result.code}?dibuat=1`, 303)
}

function version(form: FormData): number | null {
  const raw = text(form, "version")
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null
}

export function outcome(
  intent: EditorIntent,
  result: DemandResult,
  itemId?: string,
): DemandActionData {
  const item = itemId ? { itemId } : {}
  if (result.ok) return { saved: intent, ...item }
  switch (result.reason) {
    // Stale page or crafted request
    case "changed":
    case "not_allowed":
      return { conflict: true }
    case "unchanged":
      return { unchanged: true, intent, ...item }
    case "not_found":
      throw data(null, { status: 404 })
    case "issue_not_found":
      return { errors: ["issue_code"], intent }
    case "before_last":
      return { errors: ["occurred_before_last"], intent, itemId }
    case "raised_after_updates":
      return { errors: ["raised_after_updates"], intent }
    case "closed":
      return { errors: ["demand_closed"], intent }
    case "no_items":
      return { errors: ["publish_items"], intent }
    case "no_category":
      return { errors: ["publish_category"], intent }
    case "too_many":
      return intent === "link_issue"
        ? { errors: ["issues_too_many"], intent }
        : { errors: ["items"], intent, itemId }
    default:
      return { errors: ["brief_file"], intent, itemId }
  }
}

/** Every editor form posts here. */
export async function demandEditorAction({
  request,
  params,
  context,
}: {
  request: Request
  params: { code?: string }
  context: Readonly<RouterContextProvider>
}): Promise<DemandActionData> {
  const admin = await requireAdmin(context)
  const code = normalizeDemandCode(params.code ?? "")
  if (!code) throw data(null, { status: 404 })
  const form = await request.formData()
  const intent = oneOf(EDITOR_INTENTS, text(form, "intent"))
  if (!intent) throw data(null, { status: 400 })
  const tenant = tenantOf(admin)
  const actorId = admin.session.user.id
  const today = jakartaIsoDate(new Date())
  const itemId = text(form, "itemId")
  if (ITEM_INTENTS.has(intent) && !UUID.test(itemId)) {
    throw data(null, { status: 400 })
  }

  if (intent === "edit") {
    const seen = version(form)
    if (seen === null) throw data(null, { status: 400 })
    const parsed = parseDemandFields(form, today)
    const values = formValues(form)
    if (!parsed.ok) return { errors: parsed.errors, intent, values }
    const regionsWrong = await regionErrors(parsed.fields)
    if (regionsWrong.length > 0) return { errors: regionsWrong, intent, values }
    const result = outcome(
      intent,
      await editDemand(tenant, {
        code,
        version: seen,
        fields: parsed.fields,
        actorId,
      }),
    )
    // Refill the form without JS
    return "errors" in result ? { ...result, values } : result
  }
  if ((DEMAND_ACTIONS as readonly string[]).includes(intent)) {
    const seen = version(form)
    if (seen === null) throw data(null, { status: 400 })
    const note = longText(form, "note")
    if (intent === "close" && !within(note, L.closeNote)) {
      return { errors: ["close_note"], intent }
    }
    return outcome(
      intent,
      await changeDemandState(tenant, {
        code,
        action: intent as DemandAction,
        version: seen,
        note: note || null,
        actorId,
      }),
    )
  }
  if (intent === "delete") {
    const result = await deleteDraft(tenant, { code, actorId })
    if (result.ok) throw redirect("/kelola/tuntutan?dihapus=1", 303)
    return outcome(intent, result)
  }
  if (intent === "add_item") {
    const body = text(form, "body")
    if (!within(body, L.item)) return { errors: ["item_body"], intent }
    return outcome(intent, await addItem(tenant, { code, body, actorId }))
  }
  if (intent === "edit_item") {
    const seen = version(form)
    if (seen === null) throw data(null, { status: 400 })
    const body = text(form, "body")
    if (!within(body, L.item)) {
      return { errors: ["item_body"], intent, itemId, values: { body } }
    }
    return outcome(
      intent,
      await editItem(tenant, { code, itemId, version: seen, body, actorId }),
      itemId,
    )
  }
  if (intent === "edit_brief") {
    const seen = version(form)
    if (seen === null) throw data(null, { status: 400 })
    const briefSummary = longText(form, "briefSummary")
    if (!within(briefSummary, L.briefSummary)) {
      return {
        errors: ["brief_summary"],
        intent,
        itemId,
        values: { briefSummary },
      }
    }
    return outcome(
      intent,
      await editItem(tenant, {
        code,
        itemId,
        version: seen,
        briefSummary: briefSummary || null,
        actorId,
      }),
      itemId,
    )
  }
  if (intent === "move_up" || intent === "move_down") {
    return outcome(
      intent,
      await moveItem(tenant, {
        code,
        itemId,
        direction: intent === "move_up" ? "up" : "down",
        actorId,
      }),
      itemId,
    )
  }
  if (intent === "remove_item") {
    return outcome(
      intent,
      await removeItem(tenant, { code, itemId, actorId }),
      itemId,
    )
  }
  if (intent === "update_item") {
    const demand = await getManagedDemand(tenant.id, code)
    const item = demand?.items.find((row) => row.id === itemId)
    if (!demand || !item) throw data(null, { status: 404 })
    const parsed = parseItemUpdate(
      form,
      today,
      demand.raisedOn,
      item.state,
      lastStatusOn(item.updates),
    )
    if (!parsed) throw data(null, { status: 400 })
    if (!parsed.ok) return { errors: parsed.errors, intent, itemId }
    return outcome(
      intent,
      await recordItemUpdate(tenant, { code, ...parsed.value, actorId }),
      itemId,
    )
  }
  if (intent === "publish_brief" || intent === "withdraw_brief") {
    const briefId = text(form, "briefId")
    if (!UUID.test(briefId)) throw data(null, { status: 400 })
    const input = { code, briefId, actorId }
    return outcome(
      intent,
      intent === "publish_brief"
        ? await publishBrief(tenant, input)
        : await withdrawBrief(tenant, input),
      UUID.test(itemId) ? itemId : undefined,
    )
  }
  const issueCode = normalizeIssueCode(text(form, "issueCode"))
  if (!issueCode) return { errors: ["issue_code"], intent }
  const input = { code, issueCode, actorId }
  return outcome(
    intent,
    intent === "link_issue"
      ? await linkIssue(tenant, input)
      : await unlinkIssue(tenant, input),
  )
}
