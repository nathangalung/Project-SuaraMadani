import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { database } from "../../../db/client.server.ts"
import { issues } from "../../../db/schema/issues.ts"
import { regions } from "../../../db/schema/regions.ts"
import { pgError, type Tx, withTenant } from "../../../db/tenant.server.ts"
import { originFor } from "../../../server/origin.server.ts"
import type {
  IssueRanking,
  IssueSort,
} from "../../../shared/canonical-query.ts"
import { isCategoryId } from "../../../shared/categories.ts"
import type {
  StandardReason,
  TakedownReason,
} from "../../../shared/complaints.ts"
import { daysSince } from "../../../shared/format.ts"
import {
  type AdvocacyStatus,
  type GovernmentStatus,
  PUBLIC_STAGES,
  STAGE_GOVERNMENT,
  type VerificationLabel,
} from "../../../shared/status.ts"
import {
  type PublicEvidence,
  readPublicEvidence,
} from "./public-evidence.server.ts"
import { type IssueRecord, readIssueRecord } from "./record.server.ts"
import { createSlots, type Slots } from "./slots.ts"

// Starting Values: search
export const ISSUE_PAGE_SIZE = 20
const ISSUE_MAX_PAGES = 50
const SEARCH_MIN_LENGTH = 3
const searchSlots = createSlots(2)

const province = alias(regions, "province")
const regency = alias(regions, "regency")
const district = alias(regions, "district")

const cardColumns = {
  id: issues.id,
  code: issues.publicCode,
  title: issues.title,
  categoryId: issues.categoryId,
  subcategoryId: issues.subcategoryId,
  regencyName: regency.name,
  districtName: district.name,
  advocacyStatus: issues.advocacyStatus,
  govStatus: issues.govStatus,
  verificationLabel: issues.verificationLabel,
  reportCount: issues.reportCount,
  publishedAt: issues.publishedAt,
  lastActivityAt: issues.lastActivityAt,
}

type IssueCard = {
  code: string
  title: string
  categoryId: string
  subcategoryId: string
  regencyName: string
  districtName: string | null
  advocacyStatus: AdvocacyStatus
  govStatus: GovernmentStatus
  verificationLabel: VerificationLabel
  reportCount: number
  publishedAt: Date
  lastActivityAt: Date
}

// Card excerpt, bounded payload
const EXCERPT_LENGTH = 180

export type ListedIssue = IssueCard & { excerpt: string }

export type PublicIssue = IssueCard & {
  summary: string
  provinceName: string
  version: number
  // Disunting admin line
  redactedAt: Date | null
  redactionReason: StandardReason | null
}

function published(row: { publishedAt: Date | null }): Date {
  if (!row.publishedAt) throw new Error("unpublished row in public read")
  return row.publishedAt
}

/** Filter label, null when unknown. */
export async function regionName(code: string): Promise<string | null> {
  const [row] = await database()
    .db.select({ name: regions.name })
    .from(regions)
    .where(eq(regions.code, code))
    .limit(1)
  return row?.name ?? null
}

async function readPublished(
  tx: Tx,
  code: string,
): Promise<(PublicIssue & { id: string }) | null> {
  const [row] = await tx
    .select({
      ...cardColumns,
      summary: issues.summary,
      provinceName: province.name,
      version: issues.version,
      redactedAt: issues.redactedAt,
      redactionReason: issues.redactionReason,
    })
    .from(issues)
    .innerJoin(province, eq(province.code, issues.provinceCode))
    .innerJoin(regency, eq(regency.code, issues.regencyCode))
    .leftJoin(district, eq(district.code, issues.districtCode))
    .where(and(eq(issues.publicCode, code), isNotNull(issues.publishedAt)))
    .limit(1)
  return row ? { ...row, publishedAt: published(row) } : null
}

/** Published only, null means 404. */
export function getPublishedIssue(
  orgId: string,
  code: string,
): Promise<PublicIssue | null> {
  return withTenant(orgId, async (tx) => {
    const found = await readPublished(tx, code)
    if (!found) return null
    const { id: _id, ...issue } = found
    return issue
  })
}

/** Canonical and OG image URLs. */
export function issueUrls(host: string, code: string, version: number) {
  const origin = originFor(host)
  return {
    url: `${origin}/isu/${code}`,
    image: `${origin}/isu/${code}/og.png?v=${version}`,
  }
}

export type TakenDown = { takenDownAt: Date; reason: TakedownReason }

/** Removed issues answer 410. */
export function getTakenDown(
  orgId: string,
  code: string,
): Promise<TakenDown | null> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({
        takenDownAt: issues.takenDownAt,
        reason: issues.takedownReason,
      })
      .from(issues)
      .where(and(eq(issues.publicCode, code), isNotNull(issues.takenDownAt)))
      .limit(1)
    return row?.takenDownAt && row.reason
      ? { takenDownAt: row.takenDownAt, reason: row.reason }
      : null
  })
}

export type IssuePage = PublicIssue & {
  record: IssueRecord
  evidence: PublicEvidence[]
}

/** Issue page: one transaction. */
export function getIssuePage(
  orgId: string,
  code: string,
): Promise<IssuePage | null> {
  return withTenant(orgId, async (tx) => {
    const found = await readPublished(tx, code)
    if (!found) return null
    const { id, ...issue } = found
    return {
      ...issue,
      record: await readIssueRecord(tx, id),
      evidence: await readPublicEvidence(tx, id),
    }
  })
}

export type ShowcaseIssue = Pick<
  IssueCard,
  | "code"
  | "title"
  | "regencyName"
  | "districtName"
  | "reportCount"
  | "govStatus"
>

export const SHOWCASE_SIZE = 6

/** Home list, newest published first. */
export function listLatestIssues(orgId: string): Promise<ShowcaseIssue[]> {
  return withTenant(orgId, (tx) =>
    tx
      .select({
        code: issues.publicCode,
        title: issues.title,
        regencyName: regency.name,
        districtName: district.name,
        reportCount: issues.reportCount,
        govStatus: issues.govStatus,
      })
      .from(issues)
      .innerJoin(regency, eq(regency.code, issues.regencyCode))
      .leftJoin(district, eq(district.code, issues.districtCode))
      .where(isNotNull(issues.publishedAt))
      .orderBy(desc(issues.publishedAt), desc(issues.id))
      .limit(SHOWCASE_SIZE),
  )
}

export const RANKING_SIZE = 5
// Settled issues never wait
const SETTLED: GovernmentStatus[] = ["confirmed_resolved", "closed"]

export type RankedIssue = Pick<
  IssueCard,
  | "code"
  | "title"
  | "categoryId"
  | "govStatus"
  | "regencyName"
  | "districtName"
  | "reportCount"
> & { days: number }

/** Dashboard issue order, live. */
export function listIssueRanking(
  orgId: string,
  ranking: IssueRanking,
  now: Date,
): Promise<RankedIssue[]> {
  return withTenant(orgId, async (tx) => {
    const base = and(
      isNotNull(issues.publishedAt),
      ranking === "terlama" ? notInArray(issues.govStatus, SETTLED) : undefined,
    )
    const rows = await tx
      .select({
        code: issues.publicCode,
        title: issues.title,
        categoryId: issues.categoryId,
        govStatus: issues.govStatus,
        regencyName: regency.name,
        districtName: district.name,
        reportCount: issues.reportCount,
        publishedAt: issues.publishedAt,
      })
      .from(issues)
      .innerJoin(regency, eq(regency.code, issues.regencyCode))
      .leftJoin(district, eq(district.code, issues.districtCode))
      .where(base)
      .orderBy(
        ...(ranking === "terlama"
          ? [asc(issues.publishedAt), asc(issues.id)]
          : [desc(issues.reportCount), desc(issues.id)]),
      )
      .limit(RANKING_SIZE)
    return rows.map(({ publishedAt, ...row }) => ({
      ...row,
      days: daysSince(published({ publishedAt }), now),
    }))
  })
}

export type IssueCursor = {
  page: number
  sort: IssueSort
  key: string
  id: string
}

export function encodeCursor(cursor: IssueCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.page, cursor.sort, cursor.key, cursor.id]),
  ).toString("base64url")
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const INT_MAX = 2_147_483_647
const UTC_KEY = /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

// Postgres must accept the cast
function validKey(sort: IssueSort, key: string): boolean {
  if (sort === "laporan") {
    return /^(0|[1-9]\d{0,9})$/.test(key) && Number(key) <= INT_MAX
  }
  if (!UTC_KEY.test(key)) return false
  const seconds = `${key.slice(0, 19)}Z`
  const date = new Date(seconds)
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString() === `${key.slice(0, 19)}.000Z`
  )
}

function isSort(value: unknown): value is IssueSort {
  return value === "terbaru" || value === "aktivitas" || value === "laporan"
}

export function decodeCursor(value: string): IssueCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    )
    if (!Array.isArray(parsed) || parsed.length !== 4) return null
    const [page, sort, key, id] = parsed
    if (!Number.isInteger(page) || page < 2) return null
    if (!isSort(sort)) return null
    if (typeof key !== "string" || !validKey(sort, key)) return null
    if (typeof id !== "string" || !UUID.test(id)) return null
    return { page, sort, key, id }
  } catch {
    return null
  }
}

export type IssueListQuery = Partial<
  Record<"kategori" | "status" | "wilayah" | "q" | "urut" | "kursor", string>
>

export type IssueListResult =
  | {
      kind: "results"
      issues: ListedIssue[]
      page: number
      nextCursor: string | null
      capped: boolean
    }
  | { kind: "short_query" | "page_cap" | "bad_cursor" | "busy" }

// Canonical UTC key, any session
const utcKey = (column: AnyColumn) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

const SORT_COLUMN = {
  terbaru: {
    column: issues.publishedAt,
    key: utcKey(issues.publishedAt),
    cast: sql`timestamptz`,
  },
  aktivitas: {
    column: issues.lastActivityAt,
    key: utcKey(issues.lastActivityAt),
    cast: sql`timestamptz`,
  },
  laporan: {
    column: issues.reportCount,
    key: sql<string>`${issues.reportCount}::text`,
    cast: sql`int`,
  },
} as const

function sortOf(value: string | undefined): IssueSort {
  return value === "aktivitas" || value === "laporan" ? value : "terbaru"
}

function filters(query: IssueListQuery, search: string | null): SQL[] {
  const where: SQL[] = [isNotNull(issues.publishedAt)]
  const category = query.kategori
  if (category) {
    where.push(
      isCategoryId(category)
        ? eq(issues.categoryId, category)
        : eq(issues.subcategoryId, category),
    )
  }
  const stage = PUBLIC_STAGES.find((value) => value === query.status)
  if (stage) {
    where.push(inArray(issues.govStatus, [...STAGE_GOVERNMENT[stage]]))
    // Split by sent or not
    if (stage === "verified")
      where.push(eq(issues.advocacyStatus, "monitoring"))
    if (stage === "referred")
      where.push(ne(issues.advocacyStatus, "monitoring"))
  }
  const region = query.wilayah
  if (region) {
    const column =
      region.length === 2
        ? issues.provinceCode
        : region.length === 5
          ? issues.regencyCode
          : issues.districtCode
    where.push(eq(column, region))
  }
  if (search) {
    // PLAN §6: issue or region
    const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`
    where.push(
      sql`(${issues.search} @@ websearch_to_tsquery('indonesian', ${search})
        OR ${issues.regencyCode} IN (SELECT code FROM regions
          WHERE level = 2 AND name ILIKE ${like})
        OR ${issues.provinceCode} IN (SELECT code FROM regions
          WHERE level = 1 AND name ILIKE ${like}))`,
    )
  }
  return where
}

/** Keyset paging, search slots. */
export async function listPublishedIssues(
  orgId: string,
  query: IssueListQuery,
  deps: { searchSlots?: Slots } = {},
): Promise<IssueListResult> {
  const search = query.q?.trim() ?? ""
  if (search !== "" && search.length < SEARCH_MIN_LENGTH) {
    return { kind: "short_query" }
  }
  const sortName = sortOf(query.urut)
  let cursor: IssueCursor | null = null
  if (query.kursor) {
    cursor = decodeCursor(query.kursor)
    if (!cursor || cursor.sort !== sortName) return { kind: "bad_cursor" }
    if (cursor.page > ISSUE_MAX_PAGES) return { kind: "page_cap" }
  }
  const page = cursor?.page ?? 1
  const sort = SORT_COLUMN[sortName]
  const where = filters(query, search || null)
  if (cursor) {
    where.push(
      sql`(${sort.column}, ${issues.id}) < (${cursor.key}::${sort.cast}, ${cursor.id}::uuid)`,
    )
  }
  const read = () =>
    withTenant(orgId, async (tx) => {
      if (search) await tx.execute(sql`SET LOCAL statement_timeout = 1000`)
      return tx
        .select({
          ...cardColumns,
          excerpt: sql<string>`left(${issues.summary}, ${EXCERPT_LENGTH})`,
          key: sort.key,
        })
        .from(issues)
        .innerJoin(regency, eq(regency.code, issues.regencyCode))
        .leftJoin(district, eq(district.code, issues.districtCode))
        .where(and(...where))
        .orderBy(desc(sort.column), desc(issues.id))
        .limit(ISSUE_PAGE_SIZE + 1)
    })
  let rows: Awaited<ReturnType<typeof read>>
  try {
    if (search) {
      const slot = await (deps.searchSlots ?? searchSlots).tryRun(read)
      if (!slot.ran) return { kind: "busy" }
      rows = slot.value
    } else {
      rows = await read()
    }
  } catch (error) {
    // statement_timeout: overload, not a bug
    if (pgError(error)?.code === "57014") return { kind: "busy" }
    throw error
  }
  const more = rows.length > ISSUE_PAGE_SIZE
  const shown = rows.slice(0, ISSUE_PAGE_SIZE)
  const last = shown.at(-1)
  const capped = more && page >= ISSUE_MAX_PAGES
  return {
    kind: "results",
    issues: shown.map(({ id: _id, key: _key, ...row }) => ({
      ...row,
      publishedAt: published(row),
    })),
    page,
    nextCursor:
      more && !capped && last
        ? encodeCursor({
            page: page + 1,
            sort: sortName,
            key: last.key,
            id: last.id,
          })
        : null,
    capped,
  }
}
