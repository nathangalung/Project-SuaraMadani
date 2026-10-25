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
  MAP_CLASSES,
  type MapClass,
  MIN_PUBLIC_N,
  mapClass,
} from "../../../shared/dashboard.ts"
import { PUBLIC_STAGES } from "../../../shared/status.ts"
import { STAGE_TEXT } from "../issues/labels"
import { CATEGORY_SHORT_TEXT } from "../report/category-labels"
import { MAP_FILL } from "./chart-theme"
import type { MapView, RegionRow } from "./dashboard.server"
import { barWidth, countText, filterSummary, HIDDEN_MAX } from "./format"
// Hashed asset, cached immutable
import provincesUrl from "./provinces.svg?url"
import { SectionLink } from "./section-link"

type Params = Record<string, string | undefined>

/** Every /data param, defaults dropped. */
export function paramsOf(map: MapView): Params {
  return {
    kategori: map.category === "all" ? undefined : map.category,
    status: map.status === "all" ? undefined : map.status,
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
  "flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors"

// Mockup MapFilters, works without JS
function MapFilters({ map }: { map: MapView }) {
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
        <p id="peta-kategori" className="mb-1.5 font-semibold text-ink text-sm">
          {m.data_filter_category()}
        </p>
        <ul
          aria-labelledby="peta-kategori"
          className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-surface-raised p-1"
        >
          {chips.map((chip) => {
            const active = (chip.id ?? "all") === map.category
            return (
              <li key={chip.id ?? "all"}>
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
            className="font-semibold text-ink text-sm"
          >
            {m.data_filter_status()}
          </label>
          <SelectControl
            id="peta-status"
            name="status"
            defaultValue={params.status ?? ""}
          >
            <option value="">{m.data_filter_all_status()}</option>
            {PUBLIC_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_TEXT[stage]()}
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

function classLabel(id: MapClass): string {
  if (id === "none") return m.data_class_none()
  if (id === "few") return m.data_hidden_range({ max: HIDDEN_MAX })
  const list: readonly { id: string; min: number }[] = MAP_CLASSES
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

function verifiedCount(n: Count | undefined): string {
  return m.data_verified_count({ n: countText(n) })
}

function ChoroplethSvg({ map }: { map: MapView }) {
  const regions: Cell[] = map.regions
  const hasGap = regions.some((region) => region.count === undefined)
  return (
    <div className="w-full min-w-[36rem]">
      <svg
        viewBox={`0 0 ${map.width} ${map.height}`}
        className="block h-auto w-full"
      >
        <title>
          {m.data_map_label({
            filter: filterSummary(map.category, map.status),
          })}
        </title>
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
                      : verifiedCount(region.count),
                })}
              </title>
              <use
                href={`${provincesUrl}#p-${region.code}`}
                fill={MAP_FILL[mapClass(region.count)]}
              />
            </a>
          ))}
        </g>
      </svg>
    </div>
  )
}

function Legend({ map }: { map: MapView }) {
  const ids: MapClass[] = MAP_CLASSES.map((step) => step.id)
  const regions: Cell[] = map.regions
  if (regions.some((region) => region.count === undefined)) {
    ids.push("none")
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-line-subtle border-t px-4 py-3 text-xs sm:px-5">
      <span className="font-semibold">{m.data_legend_title()}</span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
        {ids.map((id) => (
          <li key={id} className="flex items-center gap-1.5">
            <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3">
              <rect width="12" height="12" fill={MAP_FILL[id]} />
            </svg>
            {classLabel(id)}
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

function ProvinceName({ map, region }: { map: MapView; region: Cell }) {
  return (
    <th
      scope="row"
      className="border-line-subtle border-r border-b px-4 py-3 text-left font-semibold"
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

function ProvinceTable({ map }: { map: MapView }) {
  return (
    <div className="p-4 sm:p-5">
      <Table caption={m.data_province_caption()} className=" text-sm">
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
function RegionSearch({ map }: { map: MapView }) {
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

function TopProvinces({ map }: { map: MapView }) {
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
        <p className=" text-ink-soft text-sm">{m.data_top_lead({ filter })}</p>
      </div>
      {top.length === 0 ? (
        <p className="text-sm">{m.data_top_none({ min: MIN_PUBLIC_N })}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {top.map((region, i) => (
            <li key={region.code}>
              <Link
                to={regionHref(map, region.code)}
                className="block rounded-xl px-2 py-2 transition-colors hover:bg-surface-raised"
              >
                <span className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-full bg-brand font-semibold text-on-accent text-xs tabular-nums">
                      {i + 1}
                    </span>
                    {region.name}
                  </span>
                  <span className="whitespace-nowrap font-semibold tabular-nums">
                    {countText(region.count)}
                  </span>
                </span>
                <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-ink/8">
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
    </aside>
  )
}

const ASIDE =
  "focus-light flex flex-col gap-4 rounded-2xl bg-brand-soft p-5 text-ink"

const VIEWS = [
  { id: "peta", label: m.data_view_map, Icon: MapIcon },
  { id: "tabel", label: m.data_view_table, Icon: Table2 },
] as const

// Mockup MapExplorer, server SVG
export function MapExplorer({ map }: { map: MapView }) {
  const params = paramsOf(map)
  return (
    <div className="flex flex-col gap-6">
      <MapFilters map={map} />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="focus-light flex min-w-0 flex-col overflow-hidden rounded-2xl border border-ink/12 bg-surface-raised text-ink">
          <div className="flex flex-wrap items-center justify-between gap-3 border-ink border-b-2 px-4 py-3 sm:px-5">
            <p className="text-sm">
              {verifiedCount(map.total)}
              {`, ${filterSummary(map.category, map.status)}`}
            </p>
            <nav
              aria-label={m.data_view_label()}
              className="flex gap-1 rounded-full border-2 border-ink p-0.5 text-sm"
            >
              {VIEWS.map(({ id, label, Icon }) => (
                <SectionLink
                  key={id}
                  section={MAP_SECTION}
                  to={dataHref({ ...params, tampilan: id })}
                  aria-current={map.view === id ? "true" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1",
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
              <p className="px-4 pt-3 text-ink-muted text-xs md:hidden">
                {m.data_map_scroll()}
              </p>
              {/* Grows to the aside height */}
              <div className="scroll-shadow-x flex flex-1 items-center overflow-x-auto p-2 sm:p-4">
                <ChoroplethSvg map={map} />
              </div>
              <Legend map={map} />
            </>
          ) : (
            <ProvinceTable map={map} />
          )}
          <p
            id="peta-sumber"
            className="border-line-subtle border-t px-4 py-2.5 text-ink-muted text-xs sm:px-5"
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
        <TopProvinces map={map} />
      </div>
    </div>
  )
}
