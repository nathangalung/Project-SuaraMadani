import { dashboardSnapshots } from "../../../db/schema/dashboard.ts"
import { withTenant } from "../../../db/tenant.server.ts"
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
  type StatusFilter,
} from "../../../shared/dashboard.ts"
import {
  FULFILMENT_STATUSES,
  type FulfilmentStatus,
  type GovernmentStatus,
} from "../../../shared/status.ts"
import type {
  DemandOverview,
  NationalDemand,
} from "../demands/demands.server.ts"
import { MAP_HEIGHT, MAP_WIDTH, PROVINCE_SHAPES } from "./region-map.server.ts"

export type DataQuery = {
  kategori?: string
  status?: string
  lapisan?: string
  tampilan?: string
  peringkat?: string
}

export type RegionRow = {
  code: string
  name: string
  count: Count | undefined
  byCategory: Record<CategoryId, Count | undefined>
}

// Exact public counts
type DemandRegionRow = {
  code: string
  name: string
  count: number
  byStatus: Record<FulfilmentStatus, number>
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

export type MapView = MapBase &
  (
    | {
        layer: "laporan"
        total: Count | undefined
        // Geometry order, paths in provinces.svg
        regions: RegionRow[]
      }
    | {
        layer: "tuntutan"
        total: number
        regions: DemandRegionRow[]
        // Beside the map
        national: NationalDemand[]
        nationalTotal: number
      }
  )

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
      map: MapView
    }

function mapBase(query: DataQuery): MapBase {
  return {
    category: (query.kategori ?? "all") as CategoryFilter,
    status: (query.status ?? "all") as GovernmentStatus | "all",
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
    layer: "laporan",
    total: snapshot.verifiedProvinceTotals[key],
    regions,
  }
}

/** Live tuntutan layer, exact. */
function demandMap(overview: DemandOverview, base: MapBase): MapView {
  const regions = PROVINCE_SHAPES.map((shape) => {
    const byStatus =
      overview.provinces[shape.code] ??
      (Object.fromEntries(
        FULFILMENT_STATUSES.map((status) => [status, 0]),
      ) as Record<FulfilmentStatus, number>)
    return {
      code: shape.code,
      name: shape.name,
      count: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      byStatus,
    }
  })
  return {
    ...base,
    layer: "tuntutan",
    total: overview.counts.regional,
    regions,
    national: overview.national,
    nationalTotal: overview.counts.national,
  }
}

/** Reads the stored snapshot only. */
export async function readDashboard(
  orgId: string,
  query: DataQuery,
  // Tuntutan layer needs it
  demands?: DemandOverview,
  now = new Date(),
): Promise<Dashboard> {
  const [row] = await withTenant(orgId, (tx) =>
    tx.select().from(dashboardSnapshots).limit(1),
  )
  if (!row || row.data.v !== SNAPSHOT_VERSION) return { kind: "empty" }
  const {
    verifiedProvinces: _p,
    verifiedProvinceTotals: _t,
    ...summary
  } = row.data
  const computed = row.computedAt.getTime()
  const base = mapBase(query)
  return {
    kind: "ready",
    computedAt: row.computedAt.toISOString(),
    nextAt: new Date(computed + REFRESH_MINUTES * 60_000).toISOString(),
    stale: now.getTime() - computed > STALE_AFTER_MINUTES * 60_000,
    summary,
    map:
      query.lapisan === "tuntutan" && demands
        ? demandMap(demands, base)
        : reportMap(row.data, base),
  }
}

/** Median check hours or null. */
export async function readVerifyMedian(orgId: string): Promise<number | null> {
  const [row] = await withTenant(orgId, (tx) =>
    tx
      .select({ data: dashboardSnapshots.data })
      .from(dashboardSnapshots)
      .limit(1),
  )
  if (!row || row.data.v !== SNAPSHOT_VERSION) return null
  return row.data.verifyTime?.medianHours ?? null
}
