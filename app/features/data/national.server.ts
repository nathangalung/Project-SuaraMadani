import { eq } from "drizzle-orm"
import { database } from "../../../db/client.server.ts"
import {
  type NationalDimension,
  nationalAggregates,
} from "../../../db/schema/national.ts"
import { organizations } from "../../../db/schema/organizations.ts"
import { regions } from "../../../db/schema/regions.ts"
import { pgError } from "../../../db/tenant.server.ts"
import { CATEGORY_IDS, type CategoryId } from "../../../shared/categories.ts"
import {
  type Count,
  REFRESH_MINUTES,
  STALE_AFTER_MINUTES,
} from "../../../shared/dashboard.ts"
import {
  GOVERNMENT_STATUSES,
  type GovernmentStatus,
} from "../../../shared/status.ts"
import type { DemandCounts } from "../demands/demands.server.ts"

export type NationalRow = {
  dimension: NationalDimension
  key: string
  received: number | null
  issues: number | null
  issueReports: number | null
  // Exact, public content
  demands: number | null
  computedAt: Date
}

type Org = { id: string; name: string; campusName: string; host: string }

// Undefined: campus newer than refresh
export type NationalCampus = {
  id: string
  name: string
  campusName: string
  host: string
  href: string
  received: Count | undefined
  issues: Count | undefined
  issueReports: Count | undefined
  demands: number | undefined
}

type Cell = { issues: Count; issueReports: Count }

export type NationalData = {
  computedAt: string
  nextAt: string
  stale: boolean
  total: {
    campuses: number
    received: Count
    issues: Count
    issueReports: Count
    resolved: Count
  }
  campuses: NationalCampus[]
  demands: DemandCounts
  categories: (Cell & { id: CategoryId })[]
  provinces: (Cell & { code: string; name: string })[]
  statuses: (Cell & { id: GovernmentStatus })[]
}

export type NationalView =
  | { kind: "empty" }
  | ({ kind: "ready" } & NationalData)

const collator = new Intl.Collator("id-ID")

/** Dev keeps the apex port. */
export function campusHref(
  host: string,
  env: { production: boolean; port: string },
): string {
  if (env.production) return `https://${host}`
  return `http://${host}${env.port ? `:${env.port}` : ""}`
}

function cellOf(row: NationalRow | undefined): Cell {
  // Absent group means zero
  return {
    issues: row ? row.issues : 0,
    issueReports: row ? row.issueReports : 0,
  }
}

/** Exact first, then hidden. */
function byCount(
  a: Cell & { name: string },
  b: Cell & { name: string },
): number {
  const rank = (count: Count) => (count === null ? -1 : count)
  return rank(b.issues) - rank(a.issues) || collator.compare(a.name, b.name)
}

/** View rows to page data. */
export function shapeNational(input: {
  rows: NationalRow[]
  orgs: Org[]
  provinces: Map<string, string>
  now: Date
  href: (host: string) => string
}): NationalData {
  const find = (dimension: NationalDimension, key: string) =>
    input.rows.find((row) => row.dimension === dimension && row.key === key)
  const total = find("total", "all")
  // Absent group means zero
  const demand = (key: string) => find("demand", key)?.demands ?? 0
  const computed = Math.max(
    ...input.rows.map((row) => row.computedAt.getTime()),
  )
  const campuses = input.orgs
    .map((org) => {
      const row = find("campus", org.id)
      return {
        ...org,
        href: input.href(org.host),
        received: row ? row.received : undefined,
        issues: row ? row.issues : undefined,
        issueReports: row ? row.issueReports : undefined,
        demands: row ? (row.demands ?? 0) : undefined,
      }
    })
    .sort((a, b) => collator.compare(a.campusName, b.campusName))
  const provinces = input.rows
    .filter((row) => row.dimension === "province")
    .map((row) => ({
      code: row.key,
      name: input.provinces.get(row.key) ?? row.key,
      ...cellOf(row),
    }))
    .sort(byCount)
  return {
    computedAt: new Date(computed).toISOString(),
    nextAt: new Date(computed + REFRESH_MINUTES * 60_000).toISOString(),
    stale: input.now.getTime() - computed > STALE_AFTER_MINUTES * 60_000,
    total: {
      campuses: input.orgs.length,
      received: total ? total.received : 0,
      issues: total ? total.issues : 0,
      issueReports: total ? total.issueReports : 0,
      resolved: cellOf(find("status", "confirmed_resolved")).issues,
    },
    campuses,
    demands: {
      total: total?.demands ?? 0,
      national: demand("national"),
      regional: demand("regional"),
      active: demand("active"),
      fulfilled: demand("fulfilled"),
      items: demand("items"),
      itemsFulfilled: demand("items_fulfilled"),
    },
    categories: CATEGORY_IDS.map((id) => ({
      id,
      ...cellOf(find("category", id)),
    })),
    provinces,
    statuses: GOVERNMENT_STATUSES.map((id) => ({
      id,
      ...cellOf(find("status", id)),
    })),
  }
}

// Unpopulated materialized view
const NOT_POPULATED = "55000"

/** No tenant: suppressed counts only. */
export async function readNational(input: {
  port: string
  now?: Date
}): Promise<NationalView> {
  const { db } = database()
  let rows: NationalRow[]
  try {
    rows = await db.select().from(nationalAggregates)
  } catch (error) {
    if (pgError(error)?.code === NOT_POPULATED) return { kind: "empty" }
    throw error
  }
  if (rows.length === 0) return { kind: "empty" }
  const [orgs, names] = await Promise.all([
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        campusName: organizations.campusName,
        host: organizations.host,
      })
      .from(organizations),
    db
      .select({ code: regions.code, name: regions.name })
      .from(regions)
      .where(eq(regions.level, 1)),
  ])
  const production = process.env.NODE_ENV === "production"
  return {
    kind: "ready",
    ...shapeNational({
      rows,
      orgs,
      provinces: new Map(names.map((row) => [row.code, row.name])),
      now: input.now ?? new Date(),
      href: (host) => campusHref(host, { production, port: input.port }),
    }),
  }
}
