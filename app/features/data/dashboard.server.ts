import { dashboardSnapshots } from "../../../db/schema/dashboard.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import type {
  DashboardView,
  IssueRanking,
} from "../../../shared/canonical-query.ts"
import { CATEGORY_IDS, type CategoryId } from "../../../shared/categories.ts"
import {
  type CategoryFilter,
  type Count,
  type DashboardSnapshot,
  filterKey,
  REFRESH_MINUTES,
  SNAPSHOT_VERSION,
  STALE_AFTER_MINUTES,
  STATUS_FILTERS,
  type StatusFilter,
} from "../../../shared/dashboard.ts"
import { MAP_HEIGHT, MAP_WIDTH, PROVINCE_SHAPES } from "./region-map.server.ts"

export type DataQuery = {
  kategori?: string
  status?: string
  tampilan?: string
  peringkat?: string
}

export type RegionRow = {
  code: string
  name: string
  count: Count | undefined
  byCategory: Record<CategoryId, Count | undefined>
}

type MapBase = {
  category: CategoryFilter
  status: StatusFilter
  view: DashboardView
  // Page tab, kept in links
  ranking: IssueRanking
  width: number
  height: number
}

// Reports only, team 25 Oct
export type MapView = MapBase & {
  total: Count | undefined
  // Geometry order, paths in provinces.svg
  regions: RegionRow[]
}

export type Dashboard =
  | { kind: "empty" }
  | {
      kind: "ready"
      computedAt: string
      nextAt: string
      stale: boolean
      summary: Omit<
        DashboardSnapshot,
        "verifiedProvinces" | "verifiedProvinceTotals"
      >
      // Verified reports per stage
      stageReports: Record<StatusFilter, Count>
      map: MapView
    }

function mapBase(query: DataQuery): MapBase {
  return {
    category: (query.kategori ?? "all") as CategoryFilter,
    status: (query.status ?? "all") as StatusFilter,
    view: query.tampilan === "tabel" ? "tabel" : "peta",
    ranking: query.peringkat === "terlama" ? "terlama" : "laporan",
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
  }
}

function reportMap(snapshot: DashboardSnapshot, base: MapBase): MapView {
  const key = filterKey(base.category, base.status)
  const cells = snapshot.verifiedProvinces[key]
  // Absent code means zero
  const read = (
    counts: Record<string, Count> | undefined,
    code: string,
  ): Count | undefined => {
    if (!counts) return undefined
    // Null is 1-4, never zero
    return Object.hasOwn(counts, code) ? (counts[code] as Count) : 0
  }
  const regions = PROVINCE_SHAPES.map((shape) => ({
    code: shape.code,
    name: shape.name,
    count: read(cells, shape.code),
    byCategory: Object.fromEntries(
      CATEGORY_IDS.map((id) => [
        id,
        read(
          snapshot.verifiedProvinces[filterKey(id, base.status)],
          shape.code,
        ),
      ]),
    ) as Record<CategoryId, Count | undefined>,
  }))
  return {
    ...base,
    total: snapshot.verifiedProvinceTotals[key],
    regions,
  }
}

export type StoredSnapshot = {
  computedAt: string
  nextAt: string
  stale: boolean
  data: DashboardSnapshot
}

/** Current version or null. */
function readSnapshot(
  orgId: string,
  now = new Date(),
): Promise<StoredSnapshot | null> {
  return withTenant(orgId, (tx) => readSnapshotIn(tx, now))
}

/** Same, inside a caller's transaction. */
export async function readSnapshotIn(
  tx: Tx,
  now: Date,
): Promise<StoredSnapshot | null> {
  const [row] = await tx.select().from(dashboardSnapshots).limit(1)
  if (!row || row.data.v !== SNAPSHOT_VERSION) return null
  const computed = row.computedAt.getTime()
  return {
    computedAt: row.computedAt.toISOString(),
    nextAt: new Date(computed + REFRESH_MINUTES * 60_000).toISOString(),
    stale: now.getTime() - computed > STALE_AFTER_MINUTES * 60_000,
    data: row.data,
  }
}

/** Reads the stored snapshot only. */
export async function readDashboard(
  orgId: string,
  query: DataQuery,
  now = new Date(),
): Promise<Dashboard> {
  const stored = await readSnapshot(orgId, now)
  if (!stored) return { kind: "empty" }
  const {
    verifiedProvinces: _p,
    verifiedProvinceTotals: _t,
    ...summary
  } = stored.data
  return {
    kind: "ready",
    computedAt: stored.computedAt,
    nextAt: stored.nextAt,
    stale: stored.stale,
    summary,
    stageReports: Object.fromEntries(
      STATUS_FILTERS.map((s) => [
        s,
        stored.data.verifiedProvinceTotals[filterKey("all", s)] ?? 0,
      ]),
    ) as Record<StatusFilter, Count>,
    map: reportMap(stored.data, mapBase(query)),
  }
}
