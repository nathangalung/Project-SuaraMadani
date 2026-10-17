import { isCategoryId, isSubcategoryId } from "./categories.ts"
import {
  ADVOCACY_STATUSES,
  FULFILMENT_STATUSES,
  GOVERNMENT_STATUSES,
} from "./status.ts"

// Returns canonical value or null.
type ParamRule = {
  readonly normalize: (value: string) => string | null
  readonly default?: string
}
export type QuerySpec = Readonly<Record<string, ParamRule>>

export const ISSUE_SORTS = ["terbaru", "aktivitas", "laporan"] as const
export type IssueSort = (typeof ISSUE_SORTS)[number]
export const SEARCH_MAX_LENGTH = 100

function oneOf(values: readonly string[]): ParamRule["normalize"] {
  const allowed = new Set(values)
  return (value) => (allowed.has(value) ? value : null)
}

// Public disclosure stops at kecamatan.
const PUBLIC_REGION = /^\d{2}(?:\.\d{2}){0,2}$/

const searchRule: ParamRule = {
  normalize: (value) =>
    value.trim().replace(/\s+/g, " ").slice(0, SEARCH_MAX_LENGTH).trim(),
}
const cursorRule: ParamRule = {
  normalize: (value) => (/^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null),
}

export const ISSUE_LIST_QUERY: QuerySpec = {
  kategori: {
    normalize: (value) =>
      isCategoryId(value) || isSubcategoryId(value) ? value : null,
  },
  status: { normalize: oneOf([...ADVOCACY_STATUSES, ...GOVERNMENT_STATUSES]) },
  wilayah: {
    normalize: (value) => (PUBLIC_REGION.test(value) ? value : null),
  },
  q: searchRule,
  urut: { normalize: oneOf(ISSUE_SORTS), default: "terbaru" },
  kursor: cursorRule,
}

const DEMAND_SCOPE_PARAMS = ["nasional", "daerah"] as const

// /tuntutan filters, readable URLs
export const DEMAND_LIST_QUERY: QuerySpec = {
  lingkup: { normalize: oneOf(DEMAND_SCOPE_PARAMS) },
  provinsi: { normalize: (value) => (/^\d{2}$/.test(value) ? value : null) },
  status: { normalize: oneOf(FULFILMENT_STATUSES) },
  q: searchRule,
  kursor: cursorRule,
}

const DATA_VIEWS = ["peta", "tabel"] as const
export type DashboardView = (typeof DATA_VIEWS)[number]

// Laporan default, Tuntutan second
const MAP_LAYERS = ["laporan", "tuntutan"] as const

// PLAN §5.8 allows these orders
export const ISSUE_RANKINGS = ["laporan", "terlama"] as const
export type IssueRanking = (typeof ISSUE_RANKINGS)[number]

// Map filters, table toggle
export const DATA_QUERY: QuerySpec = {
  kategori: { normalize: (value) => (isCategoryId(value) ? value : null) },
  status: { normalize: oneOf(GOVERNMENT_STATUSES) },
  lapisan: { normalize: oneOf(MAP_LAYERS), default: "laporan" },
  tampilan: { normalize: oneOf(DATA_VIEWS), default: "peta" },
  peringkat: { normalize: oneOf(ISSUE_RANKINGS), default: "laporan" },
}

const OG_IMAGE_QUERY: QuerySpec = {
  v: {
    normalize: (value) =>
      /^\d{1,9}$/.test(value) && Number(value) > 0
        ? String(Number(value))
        : null,
  },
}

const NO_PARAMS: QuerySpec = {}
const CONTENT_PAGES = new Set([
  "/",
  "/tentang",
  "/metode",
  "/privasi",
  "/pedoman",
])

/** Null: not a cacheable route. */
export function querySpecFor(pathname: string): QuerySpec | null {
  if (CONTENT_PAGES.has(pathname)) return NO_PARAMS
  if (pathname === "/isu") return ISSUE_LIST_QUERY
  if (pathname === "/data") return DATA_QUERY
  if (/^\/isu\/[^/]+$/.test(pathname)) return NO_PARAMS
  if (/^\/isu\/[^/]+\/og\.png$/.test(pathname)) return OG_IMAGE_QUERY
  if (pathname === "/tuntutan") return DEMAND_LIST_QUERY
  if (/^\/tuntutan\/[^/]+$/.test(pathname)) return NO_PARAMS
  if (/^\/tuntutan\/[^/]+\/og\.png$/.test(pathname)) return OG_IMAGE_QUERY
  if (/^\/tuntutan\/[^/]+\/dokumen\/[^/]+\.pdf$/.test(pathname)) {
    return NO_PARAMS
  }
  if (/^\/wilayah\/[^/]+\.json$/.test(pathname)) return NO_PARAMS
  if (/^\/logo\/[^/]+$/.test(pathname)) return NO_PARAMS
  return null
}

/** First valid value wins. */
function collect(
  params: URLSearchParams,
  spec: QuerySpec,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const [key, raw] of params) {
    if (!Object.hasOwn(spec, key) || result.has(key)) continue
    const rule = spec[key]
    const value = rule?.normalize(raw)
    if (value == null || value === "" || value === rule?.default) continue
    result.set(key, value)
  }
  return result
}

/** For loaders, .data skips middleware. */
export function readQuery<S extends QuerySpec>(
  params: URLSearchParams,
  spec: S,
): Partial<Record<keyof S & string, string>> {
  // Keys come only from spec.
  return Object.fromEntries(collect(params, spec)) as Partial<
    Record<keyof S & string, string>
  >
}

/** Takes URL.search, possibly empty. */
export function canonicalizeSearch(
  search: string,
  spec: QuerySpec,
): { search: string; changed: boolean } {
  // _routes, index: .data, POST
  const params = new URLSearchParams(search)
  const entries = [...collect(params, spec)].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )
  const query = new URLSearchParams(entries).toString()
  const canonical = query === "" ? "" : `?${query}`
  return { search: canonical, changed: canonical !== search }
}
