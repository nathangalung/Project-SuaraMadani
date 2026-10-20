import { createHash } from "node:crypto"
import { rm } from "node:fs/promises"
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  type SQLWrapper,
  sql,
} from "drizzle-orm"
import { sendJob, sendJobs } from "../../../db/jobs.server.ts"
import { notifyDemandFollowers } from "../../../db/notifications.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import {
  demandIssues,
  demandItems,
  demands,
  demandUpdates,
  policyBriefs,
} from "../../../db/schema/demands.ts"
import { issues } from "../../../db/schema/issues.ts"
import { nextCounter, type Tx, withTenant } from "../../../db/tenant.server.ts"
import { writeAtomic } from "../../../server/atomic-file.server.ts"
import { hashKey, valueHash } from "../../../server/email-log.ts"
import { briefPath, defaultFilesDir } from "../../../server/files.server.ts"
import type { PurgeDeps } from "../../../server/purge.server.ts"
import {
  BRIEF_MAX_BYTES,
  type DemandCategory,
  type DemandScope,
  emptyImportance,
  formatDemandCode,
  type Importance,
  MAX_DEMAND_ISSUES,
  MAX_DEMAND_ITEMS,
} from "../../../shared/demands.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import type { AuditAction } from "../../../shared/moderation.ts"
import {
  canTransitionDemand,
  canUpdateDemandItem,
  type DemandAction,
  type DemandItemState,
  type DemandState,
  demandProgress,
  transitionDemand,
  transitionDemandItem,
} from "../../../shared/status.ts"
import { citedIssues, purgeDemandPages } from "./purge.server.ts"
import { pendingRaters, readImportance } from "./rating.server.ts"

export { demandProgress }

export type DemandTenant = { id: string; host: string; campusCode: string }

export type DemandFields = {
  scope: DemandScope
  provinceCode: string | null
  regencyCode: string | null
  // Null only before 0024
  category: DemandCategory | null
  title: string
  body: string
  summary: string
  target: string
  raisedOn: string
}

type DemandFailure =
  | "not_found"
  | "changed"
  | "not_allowed"
  | "unchanged"
  | "no_items"
  // Rows before 0024 lack one
  | "no_category"
  | "too_many"
  | "issue_not_found"
  | "not_pdf"
  | "too_large"
  // Status dated before the last
  | "before_last"
  // Raised after a dated update
  | "raised_after_updates"
  // Closed, or hidden after closing
  | "closed"

export type DemandResult =
  | { ok: true; code: string }
  | { ok: false; reason: DemandFailure }

type Done = {
  ok: true
  code: string
  version: number
  // Drafts are never cached
  public: boolean
  // Files removed after commit
  removedBriefs?: string[]
  issues?: string[]
}
type Step = Done | { ok: false; reason: DemandFailure }

type Locked = {
  id: string
  code: string
  state: DemandState
  version: number
  // Hidden ones keep it
  publishedAt: Date | null
  // Set while complaint hides
  hiddenAt: Date | null
  fields: DemandFields
}

const fail = (reason: DemandFailure) => ({ ok: false, reason }) as const

const FIELD_COLUMNS = {
  scope: "scope",
  provinceCode: "province_code",
  regencyCode: "regency_code",
  category: "category",
  title: "title",
  body: "body",
  summary: "summary",
  target: "target",
  raisedOn: "raised_on",
} as const satisfies Record<keyof DemandFields, string>

// Free text hashed, never stored
const HASHED = ["title", "body", "summary", "target"] as const

async function lockDemand(tx: Tx, code: string): Promise<Locked | null> {
  const [row] = await tx
    .select({
      id: demands.id,
      code: demands.publicCode,
      state: demands.state,
      version: demands.version,
      publishedAt: demands.publishedAt,
      hiddenAt: demands.hiddenAt,
      scope: demands.scope,
      provinceCode: demands.provinceCode,
      regencyCode: demands.regencyCode,
      category: demands.category,
      title: demands.title,
      body: demands.body,
      summary: demands.summary,
      target: demands.target,
      raisedOn: demands.raisedOn,
    })
    .from(demands)
    .where(eq(demands.publicCode, code))
    .for("update")
  if (!row) return null
  const {
    id,
    code: publicCode,
    state,
    version,
    publishedAt,
    hiddenAt,
    ...fields
  } = row
  return { id, code: publicCode, state, version, publishedAt, hiddenAt, fields }
}

type Shown = { state: "published" | "closed"; closedAt: Date | null }

/** State before the hide. */
async function stateBeforeHide(tx: Tx, demandId: string): Promise<Shown> {
  const [row] = await tx
    .select({ action: demandUpdates.action, at: demandUpdates.createdAt })
    .from(demandUpdates)
    .where(
      and(
        eq(demandUpdates.demandId, demandId),
        isNull(demandUpdates.itemId),
        inArray(demandUpdates.action, ["publish", "close", "reopen"]),
      ),
    )
    .orderBy(desc(demandUpdates.createdAt))
    .limit(1)
  return row?.action === "close"
    ? { state: "closed", closedAt: row.at }
    : { state: "published", closedAt: null }
}

/** Hidden keeps its closed rule. */
async function closedNow(
  tx: Tx,
  demand: Pick<Locked, "id" | "state" | "hiddenAt">,
): Promise<boolean> {
  if (demand.state === "closed") return true
  if (!demand.hiddenAt) return false
  return (await stateBeforeHide(tx, demand.id)).state === "closed"
}

/** Version bump, activity, progress. */
async function touch(
  tx: Tx,
  demand: Locked,
  // Unlinked ones still cached
  dropped: string[] = [],
): Promise<Done> {
  const items = await tx
    .select({
      response: demandItems.responseStatus,
      fulfilment: demandItems.fulfilmentStatus,
    })
    .from(demandItems)
    .where(eq(demandItems.demandId, demand.id))
  const [row] = await tx
    .update(demands)
    .set({
      progress: demandProgress(items).status,
      version: sql`${demands.version} + 1`,
      lastActivityAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(demands.id, demand.id))
    .returning({ version: demands.version, state: demands.state })
  if (!row) throw new Error("demand vanished under lock")
  return {
    ok: true,
    code: demand.code,
    version: row.version,
    public: row.state !== "draft",
    issues: [...(await citedIssues(tx, demand.id)), ...dropped],
  }
}

async function audit(
  tx: Tx,
  orgId: string,
  row: {
    actorId: string
    action: AuditAction
    entityId: string
    changedColumns?: string[]
    reasonCode?: string | null
    valueHashes?: Record<string, { old?: string; new?: string }>
  },
): Promise<string> {
  const [event] = await tx
    .insert(auditLog)
    .values({ orgId, entityType: "demand", ...row })
    .returning({ id: auditLog.id })
  if (!event) throw new Error("audit row not inserted")
  return event.id
}

type Notify = { notify?: boolean }

async function tellFollowers(
  tx: Tx,
  orgId: string,
  demand: { id: string; public: boolean },
  eventId: string,
  template: Parameters<typeof notifyDemandFollowers>[1]["template"],
  input: Notify,
): Promise<void> {
  if (!demand.public || input.notify === false) return
  await notifyDemandFollowers(tx, {
    orgId,
    demandId: demand.id,
    eventId,
    template,
  })
}

export type BriefDeps = { filesDir?: string }

/** Rows first, files after commit. */
async function removeBriefFiles(
  orgId: string,
  ids: readonly string[],
  deps: BriefDeps,
): Promise<void> {
  const dir = deps.filesDir ?? defaultFilesDir()
  for (const id of ids) await rm(briefPath(dir, orgId, id), { force: true })
}

/** worker-media drops public copies. */
async function forgetPublicCopies(
  tx: Tx,
  orgId: string,
  ids: readonly string[],
): Promise<void> {
  await sendJobs(
    tx,
    "evidence-brief",
    ids.map((briefId) => ({ orgId, briefId })),
  )
}

/** Explicit, before the cascade. */
async function deleteBriefs(
  tx: Tx,
  orgId: string,
  itemIds: SQLWrapper | string[],
) {
  const rows = await tx
    .delete(policyBriefs)
    .where(inArray(policyBriefs.itemId, itemIds))
    .returning({ id: policyBriefs.id })
  const ids = rows.map((row) => row.id)
  await forgetPublicCopies(tx, orgId, ids)
  return ids
}

/** Admin role, purge when public. */
async function run(
  tenant: DemandTenant,
  fn: (tx: Tx) => Promise<Step>,
  deps: PurgeDeps & BriefDeps,
): Promise<DemandResult> {
  const result = await withTenant(tenant.id, fn, { role: "admin" })
  if (!result.ok) return result
  const briefs = result.removedBriefs ?? []
  await removeBriefFiles(tenant.id, briefs, deps)
  if (result.public) {
    await purgeDemandPages(tenant.host, { ...result, briefs }, deps)
  }
  return { ok: true, code: result.code }
}

/** Draft, with its first items. */
export function createDemand(
  tenant: DemandTenant,
  input: { fields: DemandFields; items: string[]; actorId: string; now?: Date },
): Promise<DemandResult> {
  if (input.items.length > MAX_DEMAND_ITEMS) {
    return Promise.resolve(fail("too_many"))
  }
  return withTenant(
    tenant.id,
    async (tx) => {
      const year = Number(jakartaIsoDate(input.now ?? new Date()).slice(0, 4))
      const number = await nextCounter(tx, tenant.id, year, "demand")
      const code = formatDemandCode(tenant.campusCode, year, number)
      const [row] = await tx
        .insert(demands)
        .values({
          orgId: tenant.id,
          year,
          number,
          publicCode: code,
          ...input.fields,
          createdBy: input.actorId,
        })
        .returning({ id: demands.id })
      if (!row) throw new Error("demand not inserted")
      if (input.items.length > 0) {
        await tx.insert(demandItems).values(
          input.items.map((body, position) => ({
            orgId: tenant.id,
            demandId: row.id,
            position,
            body,
          })),
        )
      }
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.create",
        entityId: row.id,
      })
      return { ok: true, code } as const
    },
    { role: "admin" },
  )
}

/** CAS on version, hashes text. */
export function editDemand(
  tenant: DemandTenant,
  input: {
    code: string
    version: number
    fields: DemandFields
    actorId: string
  },
  deps: PurgeDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      if (demand.version !== input.version) return fail("changed")
      const changed = (
        Object.keys(FIELD_COLUMNS) as (keyof DemandFields)[]
      ).filter((key) => demand.fields[key] !== input.fields[key])
      if (changed.length === 0) return fail("unchanged")
      if (changed.includes("raisedOn")) {
        // Timeline starts after raising
        const [first] = await tx
          .select({
            on: sql<string | null>`min(${demandUpdates.occurredOn})::text`,
          })
          .from(demandUpdates)
          .where(eq(demandUpdates.demandId, demand.id))
        if (first?.on && input.fields.raisedOn > first.on) {
          return fail("raised_after_updates")
        }
      }
      await tx
        .update(demands)
        .set(input.fields)
        .where(eq(demands.id, demand.id))
      const key = hashKey()
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.edit",
        entityId: demand.id,
        changedColumns: changed.map((column) => FIELD_COLUMNS[column]),
        valueHashes: Object.fromEntries(
          HASHED.filter((column) => changed.includes(column)).map((column) => [
            column,
            {
              old: valueHash(demand.fields[column], key),
              new: valueHash(input.fields[column], key),
            },
          ]),
        ),
      })
      return touch(tx, demand)
    },
    deps,
  )
}

/** Shown again as it was. */
async function restore(
  tx: Tx,
  orgId: string,
  demand: Locked,
  actorId: string,
): Promise<Step> {
  const shown = await stateBeforeHide(tx, demand.id)
  await tx
    .update(demands)
    .set({
      state: shown.state,
      closedAt: shown.closedAt,
      hiddenAt: null,
      hiddenReason: null,
    })
    .where(eq(demands.id, demand.id))
  // No timeline row, no email
  await audit(tx, orgId, {
    actorId,
    action: "demand.publish",
    entityId: demand.id,
    changedColumns: ["state", "hidden_at", "version"],
    reasonCode: "restore",
  })
  return touch(tx, demand)
}

/** Publish, close or reopen. */
export function changeDemandState(
  tenant: DemandTenant,
  input: {
    code: string
    action: DemandAction
    version: number
    note: string | null
    actorId: string
    now?: Date
  } & Notify,
  deps: PurgeDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      if (demand.version !== input.version) return fail("changed")
      if (!canTransitionDemand(demand.state, input.action)) {
        return fail("not_allowed")
      }
      if (input.action === "close" && !input.note) return fail("not_allowed")
      if (input.action === "publish" && demand.hiddenAt) {
        return restore(tx, tenant.id, demand, input.actorId)
      }
      if (input.action === "publish") {
        const [items] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(demandItems)
          .where(eq(demandItems.demandId, demand.id))
        if ((items?.n ?? 0) === 0) return fail("no_items")
        if (!demand.fields.category) return fail("no_category")
      }
      const { next, followUps } = transitionDemand(demand.state, input.action)
      await tx
        .update(demands)
        .set({
          state: next,
          publishedAt: sql`coalesce(${demands.publishedAt}, now())`,
          closedAt: next === "closed" ? sql`now()` : null,
          hiddenAt: null,
          hiddenReason: null,
        })
        .where(eq(demands.id, demand.id))
      await tx.insert(demandUpdates).values({
        orgId: tenant.id,
        demandId: demand.id,
        action: input.action,
        occurredOn: jakartaIsoDate(input.now ?? new Date()),
        note: input.note,
        createdBy: input.actorId,
      })
      const eventId = await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: `demand.${input.action}`,
        entityId: demand.id,
        changedColumns: ["state", "version"],
      })
      const done = await touch(tx, demand)
      for (const followUp of followUps) {
        await tellFollowers(
          tx,
          tenant.id,
          { id: demand.id, public: done.public },
          eventId,
          followUp.template,
          input,
        )
      }
      return done
    },
    deps,
  )
}

/** Never published: gone for good. */
export async function deleteDraft(
  tenant: DemandTenant,
  input: { code: string; actorId: string },
  deps: BriefDeps = {},
): Promise<DemandResult> {
  const result = await withTenant(
    tenant.id,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      if (demand.state !== "draft" || demand.publishedAt) {
        return fail("not_allowed")
      }
      const removed = await deleteBriefs(
        tx,
        tenant.id,
        tx
          .select({ id: demandItems.id })
          .from(demandItems)
          .where(eq(demandItems.demandId, demand.id)),
      )
      const [row] = await tx
        .delete(demands)
        .where(
          and(
            eq(demands.id, demand.id),
            eq(demands.state, "draft"),
            isNull(demands.publishedAt),
          ),
        )
        .returning({ id: demands.id })
      if (!row) return fail("not_allowed")
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.delete",
        entityId: demand.id,
      })
      return { ok: true, code: demand.code, removed } as const
    },
    { role: "admin" },
  )
  if (!result.ok) return result
  await removeBriefFiles(tenant.id, result.removed, deps)
  return { ok: true, code: result.code }
}

export function addItem(
  tenant: DemandTenant,
  input: { code: string; body: string; actorId: string },
  deps: PurgeDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      if (await closedNow(tx, demand)) return fail("closed")
      const [count] = await tx
        .select({
          n: sql<number>`count(*)::int`,
          last: sql<number>`coalesce(max(${demandItems.position}), -1)::int`,
        })
        .from(demandItems)
        .where(eq(demandItems.demandId, demand.id))
      if ((count?.n ?? 0) >= MAX_DEMAND_ITEMS) return fail("too_many")
      await tx.insert(demandItems).values({
        orgId: tenant.id,
        demandId: demand.id,
        position: (count?.last ?? -1) + 1,
        body: input.body,
      })
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.item_add",
        entityId: demand.id,
      })
      return touch(tx, demand)
    },
    deps,
  )
}

type ItemRow = {
  id: string
  position: number
  body: string
  briefSummary: string | null
  version: number
  state: DemandItemState
}

async function readItems(tx: Tx, demandId: string): Promise<ItemRow[]> {
  const rows = await tx
    .select({
      id: demandItems.id,
      position: demandItems.position,
      body: demandItems.body,
      briefSummary: demandItems.briefSummary,
      version: demandItems.version,
      response: demandItems.responseStatus,
      fulfilment: demandItems.fulfilmentStatus,
    })
    .from(demandItems)
    .where(eq(demandItems.demandId, demandId))
    .orderBy(asc(demandItems.position), asc(demandItems.id))
  return rows.map(({ response, fulfilment, ...row }) => ({
    ...row,
    state: { response, fulfilment },
  }))
}

/** Text and brief summary. */
export function editItem(
  tenant: DemandTenant,
  input: {
    code: string
    itemId: string
    version: number
    // Left out: kept as is
    body?: string
    briefSummary?: string | null
    actorId: string
  },
  deps: PurgeDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      const item = (await readItems(tx, demand.id)).find(
        (row) => row.id === input.itemId,
      )
      if (!item) return fail("not_found")
      if (item.version !== input.version) return fail("changed")
      const body = input.body ?? item.body
      const briefSummary =
        input.briefSummary === undefined
          ? item.briefSummary
          : input.briefSummary
      const changed = [
        item.body !== body ? "body" : null,
        item.briefSummary !== briefSummary ? "brief_summary" : null,
      ].filter((column) => column !== null)
      if (changed.length === 0) return fail("unchanged")
      await tx
        .update(demandItems)
        .set({
          body,
          briefSummary,
          version: sql`${demandItems.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(demandItems.id, item.id))
      const key = hashKey()
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.item_edit",
        entityId: demand.id,
        changedColumns: changed,
        valueHashes:
          item.body !== body
            ? {
                body: {
                  old: valueHash(item.body, key),
                  new: valueHash(body, key),
                },
              }
            : undefined,
      })
      return touch(tx, demand)
    },
    deps,
  )
}

/** Swap with the neighbour. */
export function moveItem(
  tenant: DemandTenant,
  input: {
    code: string
    itemId: string
    direction: "up" | "down"
    actorId: string
  },
  deps: PurgeDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      const items = await readItems(tx, demand.id)
      const at = items.findIndex((row) => row.id === input.itemId)
      if (at < 0) return fail("not_found")
      const other = items[input.direction === "up" ? at - 1 : at + 1]
      const item = items[at]
      // Already at the edge
      if (!other || !item) return fail("unchanged")
      // Dense positions, list order
      const order = items.map((row) => row.id)
      order[at] = other.id
      order[items.indexOf(other)] = item.id
      for (const [position, id] of order.entries()) {
        await tx
          .update(demandItems)
          .set({ position })
          .where(eq(demandItems.id, id))
      }
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.item_move",
        entityId: demand.id,
      })
      return touch(tx, demand)
    },
    deps,
  )
}

/** Never published only, history stays. */
export function removeItem(
  tenant: DemandTenant,
  input: { code: string; itemId: string; actorId: string },
  deps: PurgeDeps & BriefDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      // Hidden ones were public once
      if (demand.state !== "draft" || demand.publishedAt) {
        return fail("not_allowed")
      }
      const [owned] = await tx
        .select({ id: demandItems.id })
        .from(demandItems)
        .where(
          and(
            eq(demandItems.id, input.itemId),
            eq(demandItems.demandId, demand.id),
          ),
        )
      if (!owned) return fail("not_found")
      const removedBriefs = await deleteBriefs(tx, tenant.id, [owned.id])
      const [row] = await tx
        .delete(demandItems)
        .where(
          and(
            eq(demandItems.id, input.itemId),
            eq(demandItems.demandId, demand.id),
          ),
        )
        .returning({ id: demandItems.id })
      if (!row) return fail("not_found")
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.item_remove",
        entityId: demand.id,
      })
      return { ...(await touch(tx, demand)), removedBriefs }
    },
    deps,
  )
}

/** Latest dated status change. */
async function lastStatusOn(tx: Tx, itemId: string): Promise<string | null> {
  const [row] = await tx
    .select({ on: sql<string | null>`max(${demandUpdates.occurredOn})::text` })
    .from(demandUpdates)
    .where(
      and(eq(demandUpdates.itemId, itemId), eq(demandUpdates.action, "status")),
    )
  return row?.on ?? null
}

export type ItemUpdateInput = {
  code: string
  itemId: string
  // Item version the admin saw
  version: number
  // Null: dated note only
  to: DemandItemState | null
  occurredOn: string
  note: string
  sourceText: string
  sourceUrl: string | null
  actorId: string
} & Notify

/** Dated, sourced status or note. */
export function recordItemUpdate(
  tenant: DemandTenant,
  input: ItemUpdateInput,
  deps: PurgeDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      if (await closedNow(tx, demand)) return fail("closed")
      const item = (await readItems(tx, demand.id)).find(
        (row) => row.id === input.itemId,
      )
      if (!item) return fail("not_found")
      if (item.version !== input.version) return fail("changed")
      const to = input.to
      if (to && !canUpdateDemandItem(item.state, to)) {
        return fail("not_allowed")
      }
      // History order must match status
      const floor = await lastStatusOn(tx, item.id)
      if (to && floor && input.occurredOn < floor) return fail("before_last")
      const next = to ? transitionDemandItem(item.state, to).next : null
      if (next) {
        await tx
          .update(demandItems)
          .set({
            responseStatus: next.response,
            fulfilmentStatus: next.fulfilment,
            version: sql`${demandItems.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(demandItems.id, item.id))
      }
      await tx.insert(demandUpdates).values({
        orgId: tenant.id,
        demandId: demand.id,
        itemId: item.id,
        action: next ? "status" : "note",
        responseStatus: next?.response ?? null,
        fulfilmentStatus: next?.fulfilment ?? null,
        occurredOn: input.occurredOn,
        note: input.note,
        sourceText: input.sourceText,
        sourceUrl: input.sourceUrl,
        createdBy: input.actorId,
      })
      const eventId = await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: next ? "demand.item_status" : "demand.item_note",
        entityId: demand.id,
        changedColumns: next ? ["response_status", "fulfilment_status"] : [],
        reasonCode: next ? `${next.response}/${next.fulfilment}` : null,
      })
      const done = await touch(tx, demand)
      await tellFollowers(
        tx,
        tenant.id,
        { id: demand.id, public: done.public },
        eventId,
        "demand_update",
        input,
      )
      return done
    },
    deps,
  )
}

/** Published issues, same campus. */
export function linkIssue(
  tenant: DemandTenant,
  input: { code: string; issueCode: string; actorId: string },
  deps: PurgeDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      const [issue] = await tx
        .select({ id: issues.id })
        .from(issues)
        .where(
          and(
            eq(issues.publicCode, input.issueCode),
            isNotNull(issues.publishedAt),
          ),
        )
      if (!issue) return fail("issue_not_found")
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(demandIssues)
        .where(eq(demandIssues.demandId, demand.id))
      if ((count?.n ?? 0) >= MAX_DEMAND_ISSUES) return fail("too_many")
      const inserted = await tx
        .insert(demandIssues)
        .values({ orgId: tenant.id, demandId: demand.id, issueId: issue.id })
        .onConflictDoNothing()
        .returning({ id: demandIssues.issueId })
      if (inserted.length === 0) return fail("unchanged")
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.issue_link",
        entityId: demand.id,
        reasonCode: input.issueCode,
      })
      return touch(tx, demand)
    },
    deps,
  )
}

export function unlinkIssue(
  tenant: DemandTenant,
  input: { code: string; issueCode: string; actorId: string },
  deps: PurgeDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      const ids = tx
        .select({ id: issues.id })
        .from(issues)
        .where(eq(issues.publicCode, input.issueCode))
      const removed = await tx
        .delete(demandIssues)
        .where(
          and(
            eq(demandIssues.demandId, demand.id),
            inArray(demandIssues.issueId, ids),
          ),
        )
        .returning({ id: demandIssues.issueId })
      if (removed.length === 0) return fail("issue_not_found")
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.issue_unlink",
        entityId: demand.id,
        reasonCode: input.issueCode,
      })
      return touch(tx, demand, [input.issueCode])
    },
    deps,
  )
}

const PDF_MAGIC = "%PDF-"

/** Stored, then clamd via worker-media. */
export async function uploadBrief(
  tenant: DemandTenant,
  input: { code: string; itemId: string; bytes: Uint8Array; actorId: string },
  deps: BriefDeps = {},
): Promise<DemandResult> {
  if (input.bytes.byteLength > BRIEF_MAX_BYTES) return fail("too_large")
  const head = new TextDecoder().decode(input.bytes.subarray(0, 5))
  if (input.bytes.byteLength === 0 || head !== PDF_MAGIC) return fail("not_pdf")
  const filesDir = deps.filesDir ?? defaultFilesDir()
  const briefId = crypto.randomUUID()
  // File first, then row
  await writeAtomic(briefPath(filesDir, tenant.id, briefId), input.bytes)
  try {
    const result = await withTenant(
      tenant.id,
      async (tx) => {
        const demand = await lockDemand(tx, input.code)
        if (!demand) return { result: fail("not_found"), stale: [] }
        if (await closedNow(tx, demand)) {
          return { result: fail("closed"), stale: [] }
        }
        const [item] = await tx
          .select({ id: demandItems.id })
          .from(demandItems)
          .where(
            and(
              eq(demandItems.id, input.itemId),
              eq(demandItems.demandId, demand.id),
            ),
          )
        if (!item) return { result: fail("not_found"), stale: [] }
        // Unpublished uploads are replaced
        const stale = await tx
          .delete(policyBriefs)
          .where(
            and(
              eq(policyBriefs.itemId, item.id),
              isNull(policyBriefs.publishedAt),
            ),
          )
          .returning({ id: policyBriefs.id })
        await forgetPublicCopies(
          tx,
          tenant.id,
          stale.map((row) => row.id),
        )
        await tx.insert(policyBriefs).values({
          id: briefId,
          orgId: tenant.id,
          itemId: item.id,
          sha256: createHash("sha256").update(input.bytes).digest("hex"),
          byteSize: input.bytes.byteLength,
          createdBy: input.actorId,
        })
        await sendJob(tx, "evidence-brief", { orgId: tenant.id, briefId })
        await audit(tx, tenant.id, {
          actorId: input.actorId,
          action: "demand.brief_upload",
          entityId: demand.id,
        })
        return {
          result: { ok: true, code: demand.code } as DemandResult,
          stale: stale.map((row) => row.id),
        }
      },
      { role: "admin" },
    )
    for (const id of result.stale) {
      await rm(briefPath(filesDir, tenant.id, id), { force: true })
    }
    if (!result.result.ok) {
      await rm(briefPath(filesDir, tenant.id, briefId), { force: true })
    }
    return result.result
  } catch (error) {
    await rm(briefPath(filesDir, tenant.id, briefId), { force: true })
    throw error
  }
}

/** Clean scan, admin confirms. */
export function publishBrief(
  tenant: DemandTenant,
  input: {
    code: string
    briefId: string
    actorId: string
    now?: Date
  } & Notify,
  deps: PurgeDeps & BriefDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      // Withdraw stays open, publish not
      if (await closedNow(tx, demand)) return fail("closed")
      const [brief] = await tx
        .update(policyBriefs)
        .set({ publishedAt: sql`now()` })
        .where(
          and(
            eq(policyBriefs.id, input.briefId),
            eq(policyBriefs.status, "clean"),
            isNull(policyBriefs.publishedAt),
            inArray(
              policyBriefs.itemId,
              tx
                .select({ id: demandItems.id })
                .from(demandItems)
                .where(eq(demandItems.demandId, demand.id)),
            ),
          ),
        )
        .returning({ itemId: policyBriefs.itemId })
      if (!brief) return fail("not_allowed")
      // One public brief per item
      const replaced = await tx
        .delete(policyBriefs)
        .where(
          and(
            eq(policyBriefs.itemId, brief.itemId),
            isNotNull(policyBriefs.publishedAt),
            sql`${policyBriefs.id} <> ${input.briefId}`,
          ),
        )
        .returning({ id: policyBriefs.id })
      await forgetPublicCopies(
        tx,
        tenant.id,
        replaced.map((row) => row.id),
      )
      await tx.insert(demandUpdates).values({
        orgId: tenant.id,
        demandId: demand.id,
        itemId: brief.itemId,
        action: "brief",
        occurredOn: jakartaIsoDate(input.now ?? new Date()),
        createdBy: input.actorId,
      })
      const eventId = await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.brief_publish",
        entityId: demand.id,
      })
      const done = await touch(tx, demand)
      await tellFollowers(
        tx,
        tenant.id,
        { id: demand.id, public: done.public },
        eventId,
        "demand_update",
        input,
      )
      return { ...done, removedBriefs: replaced.map((row) => row.id) }
    },
    deps,
  )
}

/** Published brief taken down. */
export function withdrawBrief(
  tenant: DemandTenant,
  input: { code: string; briefId: string; actorId: string; now?: Date },
  deps: PurgeDeps & BriefDeps = {},
): Promise<DemandResult> {
  return run(
    tenant,
    async (tx) => {
      const demand = await lockDemand(tx, input.code)
      if (!demand) return fail("not_found")
      const [brief] = await tx
        .delete(policyBriefs)
        .where(
          and(
            eq(policyBriefs.id, input.briefId),
            isNotNull(policyBriefs.publishedAt),
            inArray(
              policyBriefs.itemId,
              tx
                .select({ id: demandItems.id })
                .from(demandItems)
                .where(eq(demandItems.demandId, demand.id)),
            ),
          ),
        )
        .returning({ id: policyBriefs.id, itemId: policyBriefs.itemId })
      if (!brief) return fail("not_allowed")
      await forgetPublicCopies(tx, tenant.id, [brief.id])
      await tx.insert(demandUpdates).values({
        orgId: tenant.id,
        demandId: demand.id,
        itemId: brief.itemId,
        action: "brief_withdraw",
        occurredOn: jakartaIsoDate(input.now ?? new Date()),
        createdBy: input.actorId,
      })
      await audit(tx, tenant.id, {
        actorId: input.actorId,
        action: "demand.brief_withdraw",
        entityId: demand.id,
      })
      return { ...(await touch(tx, demand)), removedBriefs: [brief.id] }
    },
    deps,
  )
}

export type ManagedDemandRow = {
  code: string
  title: string
  scope: DemandScope
  state: DemandState
  provinceName: string | null
  items: number
  fulfilled: number
  lastActivityAt: Date
}

export const DEMAND_LIST_LIMIT = 200

/** Every state, newest activity first. */
export function listManagedDemands(orgId: string): Promise<ManagedDemandRow[]> {
  return withTenant(
    orgId,
    async (tx) => {
      const result = await tx.execute<{
        code: string
        title: string
        scope: DemandScope
        state: DemandState
        province_name: string | null
        items: number
        fulfilled: number
        last_activity_at: string
      }>(sql`
        SELECT d.public_code AS code, d.title, d.scope, d.state,
          r.name AS province_name,
          (SELECT count(*)::int FROM demand_items i WHERE i.demand_id = d.id) AS items,
          (SELECT count(*)::int FROM demand_items i WHERE i.demand_id = d.id
            AND i.fulfilment_status = 'fulfilled') AS fulfilled,
          d.last_activity_at
        FROM demands d
        LEFT JOIN regions r ON r.code = d.province_code
        ORDER BY d.last_activity_at DESC, d.id DESC
        LIMIT ${DEMAND_LIST_LIMIT}
      `)
      return result.rows.map((row) => ({
        code: row.code,
        title: row.title,
        scope: row.scope,
        state: row.state,
        provinceName: row.province_name,
        items: row.items,
        fulfilled: row.fulfilled,
        lastActivityAt: new Date(row.last_activity_at),
      }))
    },
    { role: "admin" },
  )
}

type ManagedBrief = {
  id: string
  status: "pending" | "clean" | "infected"
  byteSize: number
  createdAt: Date
  publishedAt: Date | null
}

type ManagedUpdate = {
  id: string
  action: "status" | "note" | "brief"
  occurredOn: string
  response: DemandItemState["response"] | null
  fulfilment: DemandItemState["fulfilment"] | null
  note: string | null
  sourceText: string | null
  sourceUrl: string | null
}

// Updates newest first
export type ManagedItem = ItemRow & {
  briefs: ManagedBrief[]
  updates: ManagedUpdate[]
}

export type ManagedDemand = DemandFields & {
  id: string
  code: string
  state: DemandState
  version: number
  publishedAt: Date | null
  closedAt: Date | null
  hiddenAt: Date | null
  hiddenReason: string | null
  // Closed, or hidden after closing
  frozen: boolean
  items: ManagedItem[]
  issues: { code: string; title: string; published: boolean }[]
  importance: Importance
  // Accounts too new yet
  pendingRaters: number
}

/** Editor view, every brief. */
export function getManagedDemand(
  orgId: string,
  code: string,
): Promise<ManagedDemand | null> {
  return withTenant(
    orgId,
    async (tx) => {
      const [row] = await tx
        .select({
          id: demands.id,
          code: demands.publicCode,
          state: demands.state,
          version: demands.version,
          scope: demands.scope,
          provinceCode: demands.provinceCode,
          regencyCode: demands.regencyCode,
          category: demands.category,
          title: demands.title,
          body: demands.body,
          summary: demands.summary,
          target: demands.target,
          raisedOn: demands.raisedOn,
          publishedAt: demands.publishedAt,
          closedAt: demands.closedAt,
          hiddenAt: demands.hiddenAt,
          hiddenReason: demands.hiddenReason,
        })
        .from(demands)
        .where(eq(demands.publicCode, code))
      if (!row) return null
      const items = await readItems(tx, row.id)
      const briefs = await tx
        .select({
          id: policyBriefs.id,
          itemId: policyBriefs.itemId,
          status: policyBriefs.status,
          byteSize: policyBriefs.byteSize,
          createdAt: policyBriefs.createdAt,
          publishedAt: policyBriefs.publishedAt,
        })
        .from(policyBriefs)
        .where(
          inArray(
            policyBriefs.itemId,
            items.map((item) => item.id),
          ),
        )
        .orderBy(desc(policyBriefs.createdAt))
      const updates = await tx
        .select({
          id: demandUpdates.id,
          itemId: demandUpdates.itemId,
          action: demandUpdates.action,
          occurredOn: demandUpdates.occurredOn,
          response: demandUpdates.responseStatus,
          fulfilment: demandUpdates.fulfilmentStatus,
          note: demandUpdates.note,
          sourceText: demandUpdates.sourceText,
          sourceUrl: demandUpdates.sourceUrl,
        })
        .from(demandUpdates)
        .where(
          and(
            eq(demandUpdates.demandId, row.id),
            isNotNull(demandUpdates.itemId),
          ),
        )
        .orderBy(desc(demandUpdates.occurredOn), desc(demandUpdates.createdAt))
      const linked = await tx
        .select({
          code: issues.publicCode,
          title: issues.title,
          publishedAt: issues.publishedAt,
        })
        .from(demandIssues)
        .innerJoin(
          issues,
          and(
            eq(issues.orgId, demandIssues.orgId),
            eq(issues.id, demandIssues.issueId),
          ),
        )
        .where(eq(demandIssues.demandId, row.id))
        .orderBy(asc(issues.publicCode))
      const ratings = await readImportance(tx, [row.id])
      return {
        ...row,
        frozen: await closedNow(tx, row),
        importance: ratings.get(row.id) ?? emptyImportance(),
        pendingRaters: await pendingRaters(tx, row.id),
        items: items.map((item) => ({
          ...item,
          briefs: briefs
            .filter((brief) => brief.itemId === item.id)
            .map(({ itemId: _itemId, ...brief }) => brief),
          updates: updates.flatMap(({ itemId, action, ...update }) =>
            itemId === item.id &&
            (action === "status" || action === "note" || action === "brief")
              ? [{ ...update, action }]
              : [],
          ),
        })),
        issues: linked.map((issue) => ({
          code: issue.code,
          title: issue.title,
          published: issue.publishedAt !== null,
        })),
      }
    },
    { role: "admin" },
  )
}
