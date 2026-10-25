import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import {
  demandIssues,
  demandItems,
  demands,
  demandUpdates,
  policyBriefs,
} from "../../../db/schema/demands.ts"
import { issues } from "../../../db/schema/issues.ts"
import { regions } from "../../../db/schema/regions.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import {
  cleanBriefPath,
  defaultFilesDir,
} from "../../../server/files.server.ts"
import { originFor } from "../../../server/origin.server.ts"
import {
  DEMAND_PAGE_SIZE,
  type DemandCategory,
  type DemandEventAction,
  type DemandScope,
  emptyImportance,
  type Importance,
  isDemandCategory,
  isFulfilmentStatus,
} from "../../../shared/demands.ts"
import {
  type DemandProgress,
  type DemandState,
  demandProgress,
  FULFILMENT_STATUSES,
  type FulfilmentStatus,
  type ResponseStatus,
} from "../../../shared/status.ts"
import { briefUrl } from "./demand-href.ts"
import {
  type NamedRaters,
  readImportance,
  readNamedRaters,
  readTopImportant,
} from "./rating.server.ts"

const MAX_PAGES = 50
const SEARCH_MIN_LENGTH = 3
const SUMMARY_EXCERPT = 240

const province = alias(regions, "province")
const regency = alias(regions, "regency")

// Draft never leaves /kelola
const PUBLIC = ne(demands.state, "draft")

type PublicBrief = { id: string; byteSize: number; url: string }

type PublicItem = {
  id: string
  number: number
  body: string
  response: ResponseStatus
  fulfilment: FulfilmentStatus
  briefSummary: string | null
  brief: PublicBrief | null
}

type DemandHead = {
  code: string
  title: string
  summary: string
  scope: DemandScope
  category: DemandCategory | null
  provinceName: string | null
  regencyName: string | null
  target: string
  raisedOn: string
  state: Exclude<DemandState, "draft">
  publishedAt: Date
}

export type ListedDemand = DemandHead & {
  progress: DemandProgress
  importance: Importance
  briefs: number
  // First item with a brief
  firstBrief: number | null
  issueCount: number
}

export type DemandListQuery = Partial<
  Record<
    "lingkup" | "provinsi" | "kategori" | "status" | "q" | "kursor",
    string
  >
>

export type DemandListResult =
  | {
      kind: "results"
      demands: ListedDemand[]
      page: number
      nextCursor: string | null
      capped: boolean
    }
  | { kind: "short_query" | "bad_cursor" }

const headColumns = {
  id: demands.id,
  code: demands.publicCode,
  title: demands.title,
  summary: demands.summary,
  scope: demands.scope,
  category: demands.category,
  provinceName: province.name,
  regencyName: regency.name,
  target: demands.target,
  raisedOn: demands.raisedOn,
  state: demands.state,
  publishedAt: demands.publishedAt,
}

type HeadRow = {
  id: string
  state: DemandState
  publishedAt: Date | null
} & Omit<DemandHead, "state" | "publishedAt">

function head(row: HeadRow): DemandHead & { id: string } {
  if (row.state === "draft" || !row.publishedAt) {
    throw new Error("draft row in public read")
  }
  return { ...row, state: row.state, publishedAt: row.publishedAt }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UTC_KEY = /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

type Cursor = { page: number; key: string; id: string }

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify([cursor.page, cursor.key, cursor.id]),
  ).toString("base64url")
}

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    )
    if (!Array.isArray(parsed) || parsed.length !== 3) return null
    const [page, key, id] = parsed
    if (!Number.isInteger(page) || page < 2 || page > MAX_PAGES) return null
    if (typeof key !== "string" || !UTC_KEY.test(key)) return null
    if (Number.isNaN(Date.parse(key))) return null
    if (typeof id !== "string" || !UUID.test(id)) return null
    return { page, key, id }
  } catch {
    return null
  }
}

function filters(query: DemandListQuery, search: string | null): SQL[] {
  const where: SQL[] = [PUBLIC]
  if (query.lingkup === "nasional") where.push(eq(demands.scope, "national"))
  if (query.lingkup === "daerah") where.push(eq(demands.scope, "regional"))
  if (query.provinsi) where.push(eq(demands.provinceCode, query.provinsi))
  if (query.kategori && isDemandCategory(query.kategori)) {
    where.push(eq(demands.category, query.kategori))
  }
  if (query.status && isFulfilmentStatus(query.status)) {
    where.push(eq(demands.progress, query.status))
  }
  if (search) {
    where.push(
      sql`${demands.search} @@ websearch_to_tsquery('indonesian', ${search})`,
    )
  }
  return where
}

type ItemRow = {
  id: string
  demandId: string
  body: string
  response: ResponseStatus
  fulfilment: FulfilmentStatus
  briefSummary: string | null
}

async function readItems(tx: Tx, demandIds: string[]): Promise<ItemRow[]> {
  if (demandIds.length === 0) return []
  return tx
    .select({
      id: demandItems.id,
      demandId: demandItems.demandId,
      body: demandItems.body,
      response: demandItems.responseStatus,
      fulfilment: demandItems.fulfilmentStatus,
      briefSummary: demandItems.briefSummary,
    })
    .from(demandItems)
    .where(inArray(demandItems.demandId, demandIds))
    .orderBy(asc(demandItems.position), asc(demandItems.id))
}

/** Latest published brief per item. */
async function readBriefs(
  tx: Tx,
  itemIds: string[],
): Promise<Map<string, { id: string; byteSize: number }>> {
  if (itemIds.length === 0) return new Map()
  const rows = await tx
    .selectDistinctOn([policyBriefs.itemId], {
      itemId: policyBriefs.itemId,
      id: policyBriefs.id,
      byteSize: policyBriefs.byteSize,
    })
    .from(policyBriefs)
    .where(
      and(
        inArray(policyBriefs.itemId, itemIds),
        isNotNull(policyBriefs.publishedAt),
        eq(policyBriefs.status, "clean"),
      ),
    )
    .orderBy(policyBriefs.itemId, desc(policyBriefs.publishedAt))
  return new Map(rows.map((row) => [row.itemId, row]))
}

/** Keyset paging on publish time. */
export async function listPublishedDemands(
  orgId: string,
  query: DemandListQuery,
): Promise<DemandListResult> {
  const search = query.q?.trim() ?? ""
  if (search !== "" && search.length < SEARCH_MIN_LENGTH) {
    return { kind: "short_query" }
  }
  const cursor = query.kursor ? decodeCursor(query.kursor) : null
  if (query.kursor && !cursor) return { kind: "bad_cursor" }
  const page = cursor?.page ?? 1
  const where = filters(query, search || null)
  if (cursor) {
    where.push(
      sql`(${demands.publishedAt}, ${demands.id}) < (${cursor.key}::timestamptz, ${cursor.id}::uuid)`,
    )
  }
  return withTenant(orgId, async (tx) => {
    const rows = await tx
      .select({
        ...headColumns,
        summary: sql<string>`left(${demands.summary}, ${SUMMARY_EXCERPT})`,
        key: sql<string>`to_char(${demands.publishedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        issueCount: sql<number>`(SELECT count(*)::int FROM ${demandIssues}
          JOIN ${issues} ON ${issues.orgId} = ${demandIssues.orgId}
            AND ${issues.id} = ${demandIssues.issueId}
          WHERE ${demandIssues.demandId} = ${demands.id}
            AND ${issues.publishedAt} IS NOT NULL)`,
      })
      .from(demands)
      .leftJoin(province, eq(province.code, demands.provinceCode))
      .leftJoin(regency, eq(regency.code, demands.regencyCode))
      .where(and(...where))
      .orderBy(desc(demands.publishedAt), desc(demands.id))
      .limit(DEMAND_PAGE_SIZE + 1)
    const more = rows.length > DEMAND_PAGE_SIZE
    const shown = rows.slice(0, DEMAND_PAGE_SIZE)
    const items = await readItems(
      tx,
      shown.map((row) => row.id),
    )
    const briefs = await readBriefs(
      tx,
      items.map((item) => item.id),
    )
    const ratings = await readImportance(
      tx,
      shown.map((row) => row.id),
    )
    const last = shown.at(-1)
    const capped = more && page >= MAX_PAGES
    return {
      kind: "results",
      demands: shown.map(({ key: _key, issueCount, ...row }) => {
        const own = items.filter((item) => item.demandId === row.id)
        const { id: _id, ...demand } = head(row)
        const first = own.findIndex((item) => briefs.has(item.id))
        return {
          ...demand,
          progress: demandProgress(own),
          importance: ratings.get(row.id) ?? emptyImportance(),
          briefs: own.filter((item) => briefs.has(item.id)).length,
          firstBrief: first === -1 ? null : first + 1,
          issueCount,
        }
      }),
      page,
      nextCursor:
        more && !capped && last
          ? encodeCursor({ page: page + 1, key: last.key, id: last.id })
          : null,
      capped,
    }
  })
}

export type Scorecard = {
  total: number
  counts: Record<FulfilmentStatus, number>
}

/** One block per derived status. */
export function demandScorecard(orgId: string): Promise<Scorecard> {
  return withTenant(orgId, async (tx) => {
    const rows = await tx
      .select({ status: demands.progress, n: sql<number>`count(*)::int` })
      .from(demands)
      .where(PUBLIC)
      .groupBy(demands.progress)
    const counts = Object.fromEntries(
      FULFILMENT_STATUSES.map((status) => [
        status,
        rows.find((row) => row.status === status)?.n ?? 0,
      ]),
    ) as Record<FulfilmentStatus, number>
    return {
      total: rows.reduce((sum, row) => sum + row.n, 0),
      counts,
    }
  })
}

// Starting Values: dashboard lists
const OVERVIEW_LATEST = 3
// Issue page aside, newest first
const ISSUE_DEMANDS_MAX = 5
const OVERVIEW_NATIONAL = 6

export type DemandCounts = {
  total: number
  national: number
  regional: number
  // Published, not met or rejected
  active: number
  fulfilled: number
  items: number
  itemsFulfilled: number
}

export type LatestDemand = Pick<
  DemandHead,
  | "code"
  | "title"
  | "scope"
  | "category"
  | "provinceName"
  | "regencyName"
  | "state"
> & {
  progress: DemandProgress
  importance: Importance
  // Fulfilment per item, in order
  marks: FulfilmentStatus[]
  // Item text, same order
  subs: string[]
  briefs: number
}

export type NationalDemand = {
  code: string
  title: string
  state: Exclude<DemandState, "draft">
  status: FulfilmentStatus
}

export type DemandOverview = {
  counts: DemandCounts
  // Regional only, per province
  provinces: Record<string, Record<FulfilmentStatus, number>>
  national: NationalDemand[]
  latest: LatestDemand[]
}

function emptyStatuses(): Record<FulfilmentStatus, number> {
  return Object.fromEntries(
    FULFILMENT_STATUSES.map((status) => [status, 0]),
  ) as Record<FulfilmentStatus, number>
}

/** Latest public demands, compact. */
async function readLatest(
  tx: Tx,
  limit: number,
  only?: SQL,
): Promise<LatestDemand[]> {
  const rows = await tx
    .select(headColumns)
    .from(demands)
    .leftJoin(province, eq(province.code, demands.provinceCode))
    .leftJoin(regency, eq(regency.code, demands.regencyCode))
    .where(and(PUBLIC, only))
    .orderBy(desc(demands.publishedAt), desc(demands.id))
    .limit(limit)
  const items = await readItems(
    tx,
    rows.map((row) => row.id),
  )
  const briefs = await readBriefs(
    tx,
    items.map((item) => item.id),
  )
  const ratings = await readImportance(
    tx,
    rows.map((row) => row.id),
  )
  return rows.map((row) => {
    const own = items.filter((item) => item.demandId === row.id)
    const { code, title, scope, category, provinceName, regencyName, state } =
      head(row)
    return {
      code,
      title,
      scope,
      category,
      provinceName,
      regencyName,
      state,
      progress: demandProgress(own),
      importance: ratings.get(row.id) ?? emptyImportance(),
      marks: own.map((item) => item.fulfilment),
      subs: own.map((item) => item.body),
      briefs: own.filter((item) => briefs.has(item.id)).length,
    }
  })
}

/** Home strip, newest first. */
export function latestDemands(
  orgId: string,
  limit = OVERVIEW_LATEST,
): Promise<LatestDemand[]> {
  return withTenant(orgId, (tx) => readLatest(tx, limit))
}

/** Citizen order, enough raters only. */
export function importantDemands(
  orgId: string,
  limit: number,
): Promise<LatestDemand[]> {
  return withTenant(orgId, async (tx) => {
    const ids = await readTopImportant(tx, limit)
    if (ids.length === 0) return []
    const rows = await readLatest(tx, limit, inArray(demands.id, ids))
    const codes = await tx
      .select({ id: demands.id, code: demands.publicCode })
      .from(demands)
      .where(inArray(demands.id, ids))
    const rank = new Map(codes.map((row) => [row.code, ids.indexOf(row.id)]))
    return rows.toSorted(
      (a, b) => (rank.get(a.code) ?? 0) - (rank.get(b.code) ?? 0),
    )
  })
}

/** Public tuntutan citing an issue. */
export function demandsForIssue(
  orgId: string,
  issueCode: string,
): Promise<LatestDemand[]> {
  return withTenant(orgId, (tx) => {
    const citing = tx
      .select({ id: demandIssues.demandId })
      .from(demandIssues)
      .innerJoin(
        issues,
        and(
          eq(issues.orgId, demandIssues.orgId),
          eq(issues.id, demandIssues.issueId),
        ),
      )
      .where(eq(issues.publicCode, issueCode))
    return readLatest(tx, ISSUE_DEMANDS_MAX, inArray(demands.id, citing))
  })
}

/** Live /data numbers and lists. */
export function demandOverview(orgId: string): Promise<DemandOverview> {
  return withTenant(orgId, readDemandOverview)
}

/** Same, inside a caller's transaction. */
export async function readDemandOverview(tx: Tx): Promise<DemandOverview> {
  const groups = await tx
    .select({
      scope: demands.scope,
      provinceCode: demands.provinceCode,
      state: demands.state,
      status: demands.progress,
      n: sql<number>`count(*)::int`,
    })
    .from(demands)
    .where(PUBLIC)
    .groupBy(
      demands.scope,
      demands.provinceCode,
      demands.state,
      demands.progress,
    )
  const [items] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      fulfilled: sql<number>`count(*) FILTER (WHERE ${demandItems.fulfilmentStatus} = 'fulfilled')::int`,
    })
    .from(demandItems)
    .innerJoin(
      demands,
      and(
        eq(demands.orgId, demandItems.orgId),
        eq(demands.id, demandItems.demandId),
      ),
    )
    .where(PUBLIC)
  const counts: DemandCounts = {
    total: 0,
    national: 0,
    regional: 0,
    active: 0,
    fulfilled: 0,
    items: items?.total ?? 0,
    itemsFulfilled: items?.fulfilled ?? 0,
  }
  const provinces: DemandOverview["provinces"] = {}
  for (const group of groups) {
    counts.total += group.n
    counts[group.scope] += group.n
    if (group.status === "fulfilled") counts.fulfilled += group.n
    if (
      group.state === "published" &&
      (group.status === "not_fulfilled" ||
        group.status === "partially_fulfilled")
    ) {
      counts.active += group.n
    }
    if (group.scope === "regional" && group.provinceCode) {
      const cell = provinces[group.provinceCode] ?? emptyStatuses()
      cell[group.status] += group.n
      provinces[group.provinceCode] = cell
    }
  }
  const national = await tx
    .select({
      code: demands.publicCode,
      title: demands.title,
      state: demands.state,
      status: demands.progress,
    })
    .from(demands)
    .where(and(PUBLIC, eq(demands.scope, "national")))
    .orderBy(desc(demands.publishedAt), desc(demands.id))
    .limit(OVERVIEW_NATIONAL)
  return {
    counts,
    provinces,
    national: national.map((row) => ({
      ...row,
      state: row.state === "closed" ? "closed" : "published",
    })),
    latest: await readLatest(tx, OVERVIEW_LATEST),
  }
}

export type DemandEvent = {
  id: string
  action: DemandEventAction
  // Sub-tuntutan number, 1-based
  item: number | null
  response: ResponseStatus | null
  fulfilment: FulfilmentStatus | null
  occurredOn: string
  note: string | null
  sourceText: string | null
  sourceUrl: string | null
  createdAt: Date
}

export type DemandPage = DemandHead & {
  body: string
  version: number
  closedAt: Date | null
  progress: DemandProgress
  importance: Importance
  named: NamedRaters
  items: PublicItem[]
  events: DemandEvent[]
  issues: { code: string; title: string }[]
}

async function readPublic(
  tx: Tx,
  code: string,
): Promise<
  | (DemandHead & {
      id: string
      body: string
      version: number
      closedAt: Date | null
    })
  | null
> {
  const [row] = await tx
    .select({
      ...headColumns,
      body: demands.body,
      version: demands.version,
      closedAt: demands.closedAt,
    })
    .from(demands)
    .leftJoin(province, eq(province.code, demands.provinceCode))
    .leftJoin(regency, eq(regency.code, demands.regencyCode))
    .where(and(eq(demands.publicCode, code), PUBLIC))
    .limit(1)
  if (!row) return null
  const { body, version, closedAt, ...rest } = row
  return { ...head(rest), body, version, closedAt }
}

/** Published or closed, else null. */
export function getDemandPage(
  orgId: string,
  code: string,
): Promise<DemandPage | null> {
  return withTenant(orgId, async (tx) => {
    const found = await readPublic(tx, code)
    if (!found) return null
    const { id, ...demand } = found
    const items = await readItems(tx, [id])
    const briefs = await readBriefs(
      tx,
      items.map((item) => item.id),
    )
    const numbers = new Map(items.map((item, index) => [item.id, index + 1]))
    const events = await tx
      .select({
        id: demandUpdates.id,
        action: demandUpdates.action,
        itemId: demandUpdates.itemId,
        response: demandUpdates.responseStatus,
        fulfilment: demandUpdates.fulfilmentStatus,
        occurredOn: demandUpdates.occurredOn,
        note: demandUpdates.note,
        sourceText: demandUpdates.sourceText,
        sourceUrl: demandUpdates.sourceUrl,
        createdAt: demandUpdates.createdAt,
      })
      .from(demandUpdates)
      .where(eq(demandUpdates.demandId, id))
      .orderBy(asc(demandUpdates.occurredOn), asc(demandUpdates.createdAt))
    const linked = await tx
      .select({ code: issues.publicCode, title: issues.title })
      .from(demandIssues)
      .innerJoin(
        issues,
        and(
          eq(issues.orgId, demandIssues.orgId),
          eq(issues.id, demandIssues.issueId),
        ),
      )
      .where(and(eq(demandIssues.demandId, id), isNotNull(issues.publishedAt)))
      .orderBy(asc(issues.publicCode))
    const ratings = await readImportance(tx, [id])
    return {
      ...demand,
      progress: demandProgress(items),
      importance: ratings.get(id) ?? emptyImportance(),
      named: await readNamedRaters(tx, id),
      items: items.map((item, index) => {
        const brief = briefs.get(item.id)
        return {
          id: item.id,
          number: index + 1,
          body: item.body,
          response: item.response,
          fulfilment: item.fulfilment,
          briefSummary: item.briefSummary,
          brief: brief
            ? { ...brief, url: briefUrl(demand.code, brief.id) }
            : null,
        }
      }),
      events: events.map(({ itemId, ...event }) => ({
        ...event,
        item: itemId ? (numbers.get(itemId) ?? null) : null,
      })),
      issues: linked,
    }
  })
}

export type DemandCard = {
  title: string
  scope: DemandScope
  provinceName: string | null
  version: number
  progress: DemandProgress
}

/** OG image input. */
export function getDemandCard(
  orgId: string,
  code: string,
): Promise<DemandCard | null> {
  return withTenant(orgId, async (tx) => {
    const found = await readPublic(tx, code)
    if (!found) return null
    const items = await readItems(tx, [found.id])
    return {
      title: found.title,
      scope: found.scope,
      provinceName: found.provinceName,
      version: found.version,
      progress: demandProgress(items),
    }
  })
}

/** Canonical and OG image URLs. */
export function demandUrls(host: string, code: string, version: number) {
  const origin = originFor(host)
  return {
    url: `${origin}/tuntutan/${code}`,
    image: `${origin}/tuntutan/${code}/og.png?v=${version}`,
  }
}

/** Stored PDF, null when missing. */
export async function publicBriefFile(
  orgId: string,
  code: string,
  briefId: string,
  filesDir = defaultFilesDir(),
): Promise<{ file: Blob; itemNumber: number } | null> {
  const brief = await findPublicBrief(orgId, code, briefId)
  if (!brief) return null
  // Stripped copy only, never original
  const file = Bun.file(cleanBriefPath(filesDir, orgId, brief.id))
  return (await file.exists()) ? { file, itemNumber: brief.itemNumber } : null
}

function findPublicBrief(
  orgId: string,
  code: string,
  briefId: string,
): Promise<{ id: string; itemNumber: number } | null> {
  if (!UUID.test(briefId)) return Promise.resolve(null)
  return withTenant(orgId, async (tx) => {
    const found = await readPublic(tx, code)
    if (!found) return null
    const items = await readItems(tx, [found.id])
    const [brief] = await tx
      .select({ id: policyBriefs.id, itemId: policyBriefs.itemId })
      .from(policyBriefs)
      .where(
        and(
          eq(policyBriefs.id, briefId),
          eq(policyBriefs.status, "clean"),
          isNotNull(policyBriefs.publishedAt),
        ),
      )
    const index = items.findIndex((item) => item.id === brief?.itemId)
    return brief && index >= 0 ? { id: brief.id, itemNumber: index + 1 } : null
  })
}

/** Filter choices, chosen kept. */
export function demandProvinces(
  orgId: string,
  chosen?: string,
): Promise<{ code: string; name: string }[]> {
  return withTenant(orgId, (tx) => {
    const used = tx
      .select({ code: demands.provinceCode })
      .from(demands)
      .where(PUBLIC)
    return tx
      .select({ code: regions.code, name: regions.name })
      .from(regions)
      .where(
        and(
          eq(regions.level, 1),
          or(
            inArray(regions.code, used),
            chosen ? eq(regions.code, chosen) : undefined,
          ),
        ),
      )
      .orderBy(asc(regions.name))
  })
}
