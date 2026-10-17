import { Check, MapIcon, Table2 } from "lucide-react"
import { useRef } from "react"
import { Form, Link, useNavigate } from "react-router"
import { Button } from "~/components/ui/button"
import { cn } from "~/components/ui/cn"
import { SelectControl } from "~/components/ui/select-control"
import { Table, Td, Th } from "~/components/ui/table"
import { useUrlFields } from "~/components/ui/url-fields"
import { m } from "~/paraglide/messages.js"
import {
  canonicalizeSearch,
  DATA_QUERY,
  ISSUE_LIST_QUERY,
  type QuerySpec,
} from "../../../shared/canonical-query.ts"
import { CATEGORY_IDS } from "../../../shared/categories.ts"
import {
  type Count,
  DEMAND_MAP_CLASSES,
  MAP_CLASSES,
  type MapClass,
  type MapClasses,
  MIN_PUBLIC_N,
  mapClass,
} from "../../../shared/dashboard.ts"
import { formatNumber } from "../../../shared/format.ts"
import {
  FULFILMENT_STATUSES,
  type FulfilmentStatus,
  GOVERNMENT_STATUSES,
} from "../../../shared/status.ts"
import { demandsHref } from "../demands/demand-href"
import { FulfilmentMark } from "../demands/status-mark"
import { GOVERNMENT_TEXT } from "../issues/labels"
import { CATEGORY_SHORT_TEXT } from "../report/category-labels"
import { DEMAND_FILL, MAP_FILL } from "./chart-theme"
import type { MapView, RegionRow } from "./dashboard.server"
import { barWidth, countText, filterSummary, HIDDEN_MAX } from "./format"
// Hashed asset, cached immutable
import provincesUrl from "./provinces.svg?url"
import { SectionLink } from "./section-link"

type Params = Record<string, string | undefined>

type ReportMap = Extract<MapView, { layer: "laporan" }>
type DemandMap = Extract<MapView, { layer: "tuntutan" }>

/** Every /data param, defaults dropped. */
export function paramsOf(map: MapView): Params {
  return {
    kategori: map.category === "all" ? undefined : map.category,
    status: map.status === "all" ? undefined : map.status,
    lapisan: map.layer,
    tampilan: map.view,
    peringkat: map.ranking,
  }
}

function href(path: string, params: Params, spec: QuerySpec): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  return `${path}${canonicalizeSearch(`?${search}`, spec).search}`
}

/** Canonical /data URL. */
// Heading id on /data
const MAP_SECTION = "peta-isu"

export function dataHref(params: Params): string {
  return href("/data", params, DATA_QUERY)
}

/** Region click opens its list. */
function regionHref(map: MapView, code: string): string {
  if (map.layer === "tuntutan") return demandsHref({ provinsi: code })
  return href(
    "/isu",
    {
      wilayah: code,
      kategori: paramsOf(map).kategori,
      status: paramsOf(map).status,
    },
    ISSUE_LIST_QUERY,
  )
}

const SEGMENT =
  "flex items-center gap-1.5 whitespace-nowrap px-4 py-3 font-ui text-sm transition-colors"

const LAYERS = [
  { id: "laporan", label: m.data_layer_reports },
  { id: "tuntutan", label: m.data_layer_demands },
] as const

// Link pair, works without JS
function LayerSwitch({ map }: { map: MapView }) {
  const params = paramsOf(map)
  return (
    <nav aria-label={m.data_layer_label()}>
      <p
        aria-hidden="true"
        className="mb-1.5 font-semibold text-sm text-surface-raised/85"
      >
        {m.data_layer_label()}
      </p>
      <ul className="flex w-fit border border-ink/12 bg-surface-raised">
        {LAYERS.map(({ id, label }) => {
          const active = map.layer === id
          return (
            <li key={id} className="border-ink/10 border-r last:border-0">
              <SectionLink
                section={MAP_SECTION}
                // Report filters stay behind
                to={dataHref(
                  id === "tuntutan"
                    ? {
                        ...params,
                        kategori: undefined,
                        status: undefined,
                        lapisan: id,
                      }
                    : { ...params, lapisan: id },
                )}
                aria-current={active ? "true" : undefined}
                className={cn(
                  SEGMENT,
                  active
                    ? "bg-ink font-semibold text-surface-raised"
                    : "text-ink hover:bg-surface",
                )}
              >
                {active && <Check aria-hidden="true" className="size-4" />}
                {label()}
              </SectionLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// Mockup MapFilters, works without JS
function MapFilters({ map }: { map: ReportMap }) {
  const navigate = useNavigate()
  const params = paramsOf(map)
  const form = useRef<HTMLFormElement>(null)
  useUrlFields(form, { status: params.status ?? "" })
  const chips = [
    { id: undefined, label: m.issues_filter_all() },
    ...CATEGORY_IDS.map((id) => ({ id, label: CATEGORY_SHORT_TEXT[id]() })),
  ]
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
      <div className="min-w-0">
        <p
          id="peta-kategori"
          className="mb-1.5 font-semibold text-sm text-surface-raised/85"
        >
          {m.data_filter_category()}
        </p>
        <ul
          aria-labelledby="peta-kategori"
          className="flex overflow-x-auto border border-ink/12 bg-surface-raised"
        >
          {chips.map((chip) => {
            const active = (chip.id ?? "all") === map.category
            return (
              <li
                key={chip.id ?? "all"}
                className="border-ink/10 border-r last:border-0"
              >
                <SectionLink
                  section={MAP_SECTION}
                  to={dataHref({ ...params, kategori: chip.id })}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    SEGMENT,
                    active
                      ? "bg-brand font-semibold text-on-accent"
                      : "text-ink hover:bg-surface",
                  )}
                >
                  {active && <Check aria-hidden="true" className="size-4" />}
                  {chip.label}
                </SectionLink>
              </li>
            )
          })}
        </ul>
      </div>
      {/* Explicit apply, no auto-submit */}
      <form
        ref={form}
        method="get"
        action={`/data#${MAP_SECTION}`}
        onSubmit={(event) => {
          // Canonical URL, no 301
          event.preventDefault()
          const status = new FormData(event.currentTarget).get("status")
          navigate(
            dataHref({
              ...params,
              status: typeof status === "string" && status ? status : undefined,
            }),
            { preventScrollReset: true },
          )
        }}
        className="flex items-end gap-3 lg:flex-1 lg:justify-end"
      >
        {params.kategori && (
          <input type="hidden" name="kategori" value={params.kategori} />
        )}
        <div className="flex w-full flex-col gap-1.5 sm:w-64">
          <label
            htmlFor="peta-status"
            className="font-semibold text-sm text-surface-raised/85"
          >
            {m.data_filter_status()}
          </label>
          <SelectControl
            id="peta-status"
            name="status"
            defaultValue={params.status ?? ""}
          >
            <option value="">{m.data_filter_all_status()}</option>
            {GOVERNMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {GOVERNMENT_TEXT[status]()}
              </option>
            ))}
          </SelectControl>
        </div>
        {map.view === "tabel" && (
          <input type="hidden" name="tampilan" value="tabel" />
        )}
        {map.ranking === "terlama" && (
          <input type="hidden" name="peringkat" value="terlama" />
        )}
        <Button type="submit" variant="highlight" className="h-12">
          {m.data_filter_apply()}
        </Button>
      </form>
    </div>
  )
}

function classLabel(id: MapClass, classes: MapClasses): string {
  if (id === "none") return m.data_class_none()
  // Hidden range, report layer only
  if (id === "few" && classes === MAP_CLASSES) {
    return m.data_hidden_range({ max: HIDDEN_MAX })
  }
  const list: readonly { id: string; min: number }[] = classes
  const index = list.findIndex((step) => step.id === id)
  const step = list[index]
  const next = list[index + 1]
  if (!step) return ""
  if (!next) return m.data_class_open({ n: step.min })
  return step.min === next.min - 1
    ? String(step.min)
    : `${step.min}–${next.min - 1}`
}

type Cell = { code: string; name: string; count: Count | undefined }

/** Per layer: classes, colours, words. */
function layerOf(map: MapView) {
  return map.layer === "tuntutan"
    ? {
        classes: DEMAND_MAP_CLASSES,
        fill: DEMAND_FILL as Record<MapClass, string>,
        count: (n: Count | undefined) =>
          m.data_demand_count({ n: countText(n) }),
        label: m.data_demand_map_label(),
        legend: m.data_demand_legend_title(),
      }
    : {
        classes: MAP_CLASSES,
        fill: MAP_FILL,
        count: (n: Count | undefined) =>
          m.data_verified_count({ n: countText(n) }),
        label: m.data_map_label({
          filter: filterSummary(map.category, map.status),
        }),
        legend: m.data_legend_title(),
      }
}

function ChoroplethSvg({ map }: { map: MapView }) {
  const layer = layerOf(map)
  const regions: Cell[] = map.regions
  const hasGap = regions.some((region) => region.count === undefined)
  return (
    <div className="min-w-[36rem]">
      <svg
        viewBox={`0 0 ${map.width} ${map.height}`}
        className="block h-auto w-full"
      >
        <title>{layer.label}</title>
        {hasGap && (
          <defs>
            <pattern
              id="map-no-data"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="#dde2ea" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="#9aa3b8"
                strokeWidth="2"
              />
            </pattern>
          </defs>
        )}
        <g stroke="#ffffff" strokeWidth="1" strokeLinejoin="round">
          {regions.map((region) => (
            <a
              key={region.code}
              href={regionHref(map, region.code)}
              className="[&:focus-visible>use]:stroke-[3] [&:focus-visible>use]:stroke-ink [&:hover>use]:stroke-[2] [&:hover>use]:stroke-ink"
            >
              <title>
                {m.data_region_title({
                  name: region.name,
                  value:
                    region.count === undefined
                      ? m.data_no_data()
                      : layer.count(region.count),
                })}
              </title>
              <use
                href={`${provincesUrl}#p-${region.code}`}
                fill={layer.fill[mapClass(region.count, layer.classes)]}
              />
            </a>
          ))}
        </g>
      </svg>
    </div>
  )
}

function Legend({ map }: { map: MapView }) {
  const layer = layerOf(map)
  const ids: MapClass[] = layer.classes.map((step) => step.id)
  const regions: Cell[] = map.regions
  if (regions.some((region) => region.count === undefined)) {
    ids.push("none")
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-line-subtle border-t px-4 py-3 font-ui text-xs sm:px-5">
      <span className="font-semibold">{layer.legend}</span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
        {ids.map((id) => (
          <li key={id} className="flex items-center gap-1.5">
            <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3">
              <rect width="12" height="12" fill={layer.fill[id]} />
            </svg>
            {classLabel(id, layer.classes)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function sorted<T extends Cell>(regions: T[]): T[] {
  // Hidden cells sort below 5
  const rank = (count: Count | undefined) =>
    count === undefined ? -2 : count === null ? MIN_PUBLIC_N - 0.5 : count
  return [...regions].sort(
    (a, b) => rank(b.count) - rank(a.count) || a.name.localeCompare(b.name),
  )
}

const STATUS_COLUMN: Record<FulfilmentStatus, () => string> = {
  not_fulfilled: m.data_col_not_fulfilled,
  partially_fulfilled: m.data_col_partially_fulfilled,
  fulfilled: m.data_col_fulfilled,
  rejected: m.data_col_rejected,
}

function ProvinceName({ map, region }: { map: MapView; region: Cell }) {
  return (
    <th
      scope="row"
      className="border-line-subtle border-b px-3 py-2 text-left font-semibold"
    >
      <Link
        to={regionHref(map, region.code)}
        className="underline-offset-2 hover:underline"
      >
        {region.name}
      </Link>
    </th>
  )
}

function DemandTable({ map }: { map: DemandMap }) {
  return (
    <div className="p-4 sm:p-5">
      <Table
        caption={m.data_demand_province_caption()}
        className="font-ui text-sm"
      >
        <thead>
          <tr>
            <Th>{m.data_col_province()}</Th>
            <Th numeric>{m.data_col_demands()}</Th>
            {FULFILMENT_STATUSES.map((status) => (
              <Th key={status} numeric>
                {STATUS_COLUMN[status]()}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted(map.regions).map((region) => (
            <tr key={region.code}>
              <ProvinceName map={map} region={region} />
              <Td numeric className="font-semibold">
                {formatNumber(region.count)}
              </Td>
              {FULFILMENT_STATUSES.map((status) => (
                <Td key={status} numeric>
                  {formatNumber(region.byStatus[status])}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

function ProvinceTable({ map }: { map: ReportMap }) {
  return (
    <div className="p-4 sm:p-5">
      <Table caption={m.data_province_caption()} className="font-ui text-sm">
        <thead>
          <tr>
            <Th>{m.data_col_province()}</Th>
            <Th numeric>{m.data_col_reports()}</Th>
            {CATEGORY_IDS.map((id) => (
              <Th key={id} numeric>
                {CATEGORY_SHORT_TEXT[id]()}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted(map.regions).map((region: RegionRow) => (
            <tr key={region.code}>
              <ProvinceName map={map} region={region} />
              <Td numeric className="font-semibold">
                {countText(region.count)}
              </Td>
              {CATEGORY_IDS.map((id) => (
                <Td key={id} numeric>
                  {countText(region.byCategory[id])}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

// PLAN §5.9 search, no JS
function RegionSearch({ map }: { map: ReportMap }) {
  const params = paramsOf(map)
  const regions = [...map.regions].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <Form method="get" action="/isu" className="flex flex-col gap-2">
      {/* Canonical /isu param order */}
      {params.kategori && (
        <input type="hidden" name="kategori" value={params.kategori} />
      )}
      {params.status && (
        <input type="hidden" name="status" value={params.status} />
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cari-provinsi" className="font-semibold">
          {m.data_region_search()}
        </label>
        <SelectControl
          id="cari-provinsi"
          name="wilayah"
          defaultValue=""
          required
        >
          <option value="" disabled>
            {m.data_region_pick()}
          </option>
          {regions.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </SelectControl>
      </div>
      <Button type="submit" variant="secondary" className="self-start">
        {m.data_region_go()}
      </Button>
    </Form>
  )
}

function TopProvinces({ map }: { map: ReportMap }) {
  const top = sorted(map.regions)
    .filter((region) => typeof region.count === "number" && region.count > 0)
    .slice(0, 5)
  const max = top[0]?.count ?? 0
  const filter = filterSummary(map.category, map.status)
  return (
    <aside aria-labelledby="provinsi-teratas" className={ASIDE}>
      <div>
        <h3 id="provinsi-teratas" className="font-bold text-xl">
          {m.data_top_title()}
        </h3>
        <p className="font-ui text-ink-soft text-sm">
          {m.data_top_lead({ filter })}
        </p>
      </div>
      {top.length === 0 ? (
        <p className="text-sm">{m.data_top_none({ min: MIN_PUBLIC_N })}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {top.map((region, i) => (
            <li key={region.code}>
              <Link
                to={regionHref(map, region.code)}
                className="block px-2 py-2 transition-colors hover:bg-surface-raised"
              >
                <span className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center bg-brand font-semibold font-ui text-on-accent text-xs tabular-nums">
                      {i + 1}
                    </span>
                    {region.name}
                  </span>
                  <span className="whitespace-nowrap font-semibold tabular-nums">
                    {countText(region.count)}
                  </span>
                </span>
                <span className="mt-1.5 block h-2 bg-ink/8">
                  <span
                    className="block h-full bg-brand"
                    style={{ width: barWidth(region.count, max ?? 0) }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <RegionSearch map={map} />
      <div className="mt-auto flex flex-col gap-2 font-ui text-ink-soft text-xs leading-relaxed">
        <p>{m.data_map_note()}</p>
        <p>{m.data_coverage()}</p>
      </div>
    </aside>
  )
}

const ASIDE = "focus-light flex flex-col gap-4 bg-brand-soft p-5 text-ink"

// Beside the map
function NationalDemands({ map }: { map: DemandMap }) {
  // Small provinces barely show
  const provinces = sorted(map.regions)
    .filter((region) => typeof region.count === "number" && region.count > 0)
    .slice(0, 6)
  return (
    <aside aria-labelledby="tuntutan-nasional" className={ASIDE}>
      {provinces.length > 0 ? (
        <div>
          <h3 id="tuntutan-provinsi" className="font-bold text-xl">
            {m.data_demand_provinces_title()}
          </h3>
          <ul
            aria-labelledby="tuntutan-provinsi"
            className="mt-2 flex flex-col border-ink border-t-2"
          >
            {provinces.map((region) => (
              <li key={region.code} className="border-ink/15 border-b">
                <Link
                  to={regionHref(map, region.code)}
                  className="flex items-baseline justify-between gap-2 py-2 text-sm hover:underline"
                >
                  {region.name}
                  <span className="font-semibold tabular-nums">
                    {countText(region.count)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <h3 id="tuntutan-nasional" className="font-bold text-xl">
          {m.data_national_title()}
        </h3>
        <p className="font-ui text-ink-soft text-sm">
          {m.data_national_lead({ n: formatNumber(map.nationalTotal) })}
        </p>
      </div>
      {map.national.length === 0 ? (
        <p className="text-sm">{m.data_national_none()}</p>
      ) : (
        <>
          <ul className="flex flex-col border-ink border-t-2">
            {map.national.map((demand) => (
              <li key={demand.code} className="border-ink/15 border-b py-3">
                <Link
                  to={`/tuntutan/${demand.code}`}
                  className="block font-semibold leading-snug underline-offset-2 hover:underline"
                >
                  {demand.title}
                </Link>
                <FulfilmentMark status={demand.status} className="mt-1" />
              </li>
            ))}
          </ul>
          <Link
            to={demandsHref({ lingkup: "nasional" })}
            className="font-semibold text-accent text-sm underline underline-offset-4 hover:no-underline"
          >
            {m.data_national_all()}
          </Link>
        </>
      )}
    </aside>
  )
}

const VIEWS = [
  { id: "peta", label: m.data_view_map, Icon: MapIcon },
  { id: "tabel", label: m.data_view_table, Icon: Table2 },
] as const

// Mockup MapExplorer, server SVG
export function MapExplorer({ map }: { map: MapView }) {
  const params = paramsOf(map)
  const layer = layerOf(map)
  return (
    <div className="flex flex-col gap-6">
      <LayerSwitch map={map} />
      {map.layer === "laporan" && <MapFilters map={map} />}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start">
        <div className="focus-light min-w-0 border border-ink/12 bg-surface-raised text-ink">
          <div className="flex flex-wrap items-center justify-between gap-3 border-ink border-b-2 px-4 py-3 sm:px-5">
            <p className="flex items-center gap-2 font-ui text-sm">
              <span
                aria-hidden="true"
                className="size-3 rounded-full"
                style={{ background: layer.fill.mid }}
              />
              {layer.count(map.total)}
              {map.layer === "laporan" &&
                ` · ${filterSummary(map.category, map.status)}`}
            </p>
            <nav
              aria-label={m.data_view_label()}
              className="flex border-2 border-ink font-ui text-sm"
            >
              {VIEWS.map(({ id, label, Icon }) => (
                <SectionLink
                  key={id}
                  section={MAP_SECTION}
                  to={dataHref({ ...params, tampilan: id })}
                  aria-current={map.view === id ? "true" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5",
                    map.view === id
                      ? "bg-ink font-semibold text-surface-raised"
                      : "text-ink hover:bg-surface",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label()}
                </SectionLink>
              ))}
            </nav>
          </div>
          {map.view === "peta" ? (
            <>
              <a
                href="#peta-sumber"
                className="sr-only focus:not-sr-only focus:block focus:px-4 focus:py-2 focus:font-semibold"
              >
                {m.data_map_skip()}
              </a>
              {/* Map wider than phones */}
              <p className="px-4 pt-3 font-ui text-ink-muted text-xs md:hidden">
                {m.data_map_scroll()}
              </p>
              <div className="scroll-shadow-x overflow-x-auto p-2 sm:p-4">
                <ChoroplethSvg map={map} />
              </div>
              <Legend map={map} />
              {map.layer === "tuntutan" && (
                <p className="px-4 pb-3 font-ui text-ink-soft text-xs leading-relaxed sm:px-5">
                  {m.data_demand_map_note()}
                </p>
              )}
            </>
          ) : map.layer === "tuntutan" ? (
            <DemandTable map={map} />
          ) : (
            <ProvinceTable map={map} />
          )}
          <p
            id="peta-sumber"
            className="border-line-subtle border-t px-4 py-2.5 font-ui text-ink-muted text-xs sm:px-5"
          >
            {m.data_attr_boundary()}{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              className="underline underline-offset-2"
            >
              {m.data_attr_osm()}
            </a>
            , {m.data_attr_under()}{" "}
            <a
              href="https://opendatacommons.org/licenses/odbl/"
              className="underline underline-offset-2"
            >
              {m.data_attr_odbl()}
            </a>
            . {m.data_attr_codes()}
          </p>
        </div>
        {map.layer === "tuntutan" ? (
          <NationalDemands map={map} />
        ) : (
          <TopProvinces map={map} />
        )}
      </div>
    </div>
  )
}
