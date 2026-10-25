import { Check, ChevronDown, MapPin, Search } from "lucide-react"
import { useRef } from "react"
import { Form, Link } from "react-router"
import { Button } from "~/components/ui/button"
import { cn } from "~/components/ui/cn"
import { controlClass } from "~/components/ui/control"
import { Select } from "~/components/ui/select"
import { useUrlFields } from "~/components/ui/url-fields"
import { m } from "~/paraglide/messages.js"
import {
  canonicalizeSearch,
  ISSUE_LIST_QUERY,
  ISSUE_SORTS,
  SEARCH_MAX_LENGTH,
} from "../../../shared/canonical-query.ts"
import {
  CATEGORIES,
  type CategoryId,
  categoryOf,
  isCategoryId,
} from "../../../shared/categories.ts"
import { PUBLIC_STAGES } from "../../../shared/status.ts"
import { CATEGORY_SHORT_TEXT } from "../report/category-labels"
import { CATEGORY_TEXT, SUBCATEGORY_TEXT } from "../report/public-labels"
import type { RegionOption } from "../report/regions.server"
import type { IssueListQuery } from "./issues.server"
import { STAGE_TEXT } from "./labels"

const SORT_TEXT = {
  terbaru: m.issues_sort_terbaru,
  aktivitas: m.issues_sort_aktivitas,
  laporan: m.issues_sort_laporan,
} as const

/** Canonical order, no 301. */
export function issuesHref(query: IssueListQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value)
  }
  return `/isu${canonicalizeSearch(`?${params}`, ISSUE_LIST_QUERY).search}`
}

/** Chip state from one param. */
export function activeCategory(kategori?: string): CategoryId | undefined {
  if (!kategori) return undefined
  return isCategoryId(kategori) ? kategori : categoryOf(kategori)
}

// Rounded pills, text only
const CHIP =
  "inline-flex min-h-9 items-center gap-2 rounded-full border px-4 font-semibold font-ui text-sm transition-colors"

// Server links, no JS
function CategoryChips({ query }: { query: IssueListQuery }) {
  const active = activeCategory(query.kategori)
  const chips: { id?: CategoryId; label: string }[] = [
    { label: m.issues_filter_all() },
    ...CATEGORIES.map((category) => ({
      id: category.id,
      label: CATEGORY_SHORT_TEXT[category.id](),
    })),
  ]
  return (
    <div className="mb-5">
      <p id="issues-category" className="font-semibold">
        {m.issues_filter_category()}
      </p>
      <ul
        aria-labelledby="issues-category"
        className="mt-2 flex flex-wrap gap-2"
      >
        {chips.map((chip) => {
          const selected = chip.id === active
          return (
            <li key={chip.id ?? "all"}>
              <Link
                to={issuesHref({
                  ...query,
                  kategori: chip.id,
                  halaman: undefined,
                })}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  CHIP,
                  selected
                    ? "border-ink bg-ink text-surface-raised"
                    : "border-line-subtle bg-surface text-ink hover:border-ink/40",
                )}
              >
                {chip.label}
                {selected && <Check aria-hidden="true" className="size-4" />}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// One param holds both levels
function SubcategorySelect({ query }: { query: IssueListQuery }) {
  const active = activeCategory(query.kategori)
  const category = CATEGORIES.find((c) => c.id === active)
  return (
    <Select
      id="issues-category"
      name="kategori"
      label={m.issues_filter_subcategory()}
      defaultValue={query.kategori ?? ""}
    >
      <option value={category?.id ?? ""}>
        {m.issues_filter_all_subcategories()}
      </option>
      {category
        ? category.subcategories.map((sub) => (
            <option key={sub.id} value={sub.id}>
              {SUBCATEGORY_TEXT[sub.id]()}
            </option>
          ))
        : CATEGORIES.map((c) => (
            <optgroup key={c.id} label={CATEGORY_TEXT[c.id]()}>
              {c.subcategories.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {SUBCATEGORY_TEXT[sub.id]()}
                </option>
              ))}
            </optgroup>
          ))}
    </Select>
  )
}

// GET form, works without JS
export type RegionChoices = {
  provinces: RegionOption[]
  // Children of the chosen province
  regencies: RegionOption[]
}

// Two submits, no JS
function RegionSelect({
  query,
  regions,
  regionName,
}: {
  query: IssueListQuery
  regions: RegionChoices
  regionName?: string
}) {
  const current = query.wilayah ?? ""
  const province = regions.provinces.find((p) => p.code === current.slice(0, 2))
  const listed = regions.regencies.some((r) => r.code === current)
  // Hint below, selects stay aligned
  return (
    <div className="flex flex-col gap-1.5">
      <Select
        id="issues-region"
        name="wilayah"
        label={m.issues_filter_region()}
        defaultValue={current}
      >
        <option value="">{m.issues_filter_region_all()}</option>
        {regions.provinces.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
        {province && regions.regencies.length > 0 ? (
          <optgroup
            label={m.issues_filter_regencies({ province: province.name })}
          >
            {regions.regencies.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
            {/* Kecamatan from a map link */}
            {current.length > 5 && !listed && regionName ? (
              <option value={current}>{regionName}</option>
            ) : null}
          </optgroup>
        ) : null}
      </Select>
    </div>
  )
}

export function IssueFilters({
  query,
  regionName,
  regions,
}: {
  query: IssueListQuery
  regionName?: string
  regions: RegionChoices
}) {
  const form = useRef<HTMLFormElement>(null)
  // Phones: closed unless chosen
  const chosen = Boolean(
    query.kategori ||
      query.status ||
      query.wilayah ||
      (query.urut && query.urut !== "terbaru"),
  )
  useUrlFields(form, {
    q: query.q ?? "",
    kategori: query.kategori ?? "",
    status: query.status ?? "",
    urut: query.urut ?? "terbaru",
    wilayah: query.wilayah ?? "",
  })
  return (
    <Form
      ref={form}
      method="get"
      action="/isu"
      className="rounded-2xl border border-line-subtle bg-surface-raised p-5 sm:p-6"
    >
      <h2 className="sr-only">{m.issues_filter_title()}</h2>
      {/* Links act at once */}
      <CategoryChips query={query} />
      {/* lg: search, button, then selects */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="issues-q" className="font-semibold">
            {m.issues_search_label()}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-[1.125rem] -translate-y-1/2 text-ink-muted"
            />
            <input
              id="issues-q"
              name="q"
              type="search"
              defaultValue={query.q ?? ""}
              maxLength={SEARCH_MAX_LENGTH}
              aria-describedby="issues-q-hint"
              className={cn(controlClass, "h-12 w-full pl-11")}
            />
          </div>
          <p
            id="issues-q-hint"
            className="font-ui text-[0.95rem] text-ink-muted"
          >
            {m.issues_search_hint()}
          </p>
        </div>
        {/* sm+: always shown, CSS only */}
        <details
          open={chosen}
          className="group lg:col-span-2 lg:row-start-2 sm:[&::details-content]:[content-visibility:visible]"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold sm:supports-[selector(::details-content)]:hidden [&::-webkit-details-marker]:hidden">
            {m.issues_filter_more()}
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="mt-2 grid grid-cols-1 items-start gap-4 sm:mt-0 sm:grid-cols-2 lg:grid-cols-4">
            <SubcategorySelect query={query} />
            <RegionSelect
              query={query}
              regions={regions}
              regionName={regionName}
            />
            <Select
              id="issues-status"
              name="status"
              label={m.issues_filter_status()}
              defaultValue={query.status ?? ""}
            >
              <option value="">{m.issues_filter_all()}</option>
              {PUBLIC_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_TEXT[stage]()}
                </option>
              ))}
            </Select>
            <Select
              id="issues-sort"
              name="urut"
              label={m.issues_sort_label()}
              defaultValue={query.urut ?? "terbaru"}
            >
              {ISSUE_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_TEXT[sort]()}
                </option>
              ))}
            </Select>
          </div>
        </details>
        <div className="lg:col-start-2 lg:row-start-1 lg:pt-[1.875rem]">
          <Button type="submit" className="h-12 w-full sm:w-auto">
            {m.issues_apply()}
          </Button>
        </div>
      </div>
      {query.wilayah && regionName ? (
        <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-ui text-[0.95rem]">
          <span className="flex items-center gap-1.5">
            <MapPin aria-hidden="true" className="size-4 shrink-0 text-brand" />
            <span>
              <span className="font-semibold">{m.issues_filter_region()}:</span>{" "}
              {regionName}
            </span>
          </span>
          <Link
            to={issuesHref({
              ...query,
              wilayah: undefined,
              halaman: undefined,
            })}
            className="font-semibold text-accent underline underline-offset-4 hover:no-underline"
          >
            {m.issues_region_clear()}
          </Link>
        </p>
      ) : null}
    </Form>
  )
}
