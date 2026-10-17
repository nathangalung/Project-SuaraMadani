import { ChevronDown, Search } from "lucide-react"
import { useRef } from "react"
import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import { cn } from "~/components/ui/cn"
import { controlClass } from "~/components/ui/control"
import { Select } from "~/components/ui/select"
import { useUrlFields } from "~/components/ui/url-fields"
import { m } from "~/paraglide/messages.js"
import { SEARCH_MAX_LENGTH } from "../../../shared/canonical-query.ts"
import { FULFILMENT_STATUSES } from "../../../shared/status.ts"
import type { DemandListQuery } from "./demands.server"
import { FULFILMENT_TEXT } from "./labels"

// GET form, works without JS
export function DemandFilters({
  query,
  provinces,
}: {
  query: DemandListQuery
  provinces: { code: string; name: string }[]
}) {
  const form = useRef<HTMLFormElement>(null)
  // Phones: open when filtered
  const chosen = Boolean(query.lingkup || query.provinsi || query.status)
  useUrlFields(form, {
    q: query.q ?? "",
    lingkup: query.lingkup ?? "",
    provinsi: query.provinsi ?? "",
    status: query.status ?? "",
  })
  return (
    <Form
      ref={form}
      method="get"
      action="/tuntutan"
      className="border-ink border-y-2 bg-surface-raised/60 p-4 sm:p-5"
    >
      <h2 className="sr-only">{m.demands_filter_title()}</h2>
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="demands-q" className="font-semibold">
            {m.demands_search_label()}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-[1.125rem] -translate-y-1/2 text-ink-muted"
            />
            <input
              id="demands-q"
              name="q"
              type="search"
              defaultValue={query.q ?? ""}
              maxLength={SEARCH_MAX_LENGTH}
              aria-describedby="demands-q-hint"
              className={cn(controlClass, "h-12 w-full pl-11")}
            />
          </div>
          <p
            id="demands-q-hint"
            className="font-ui text-[0.95rem] text-ink-muted"
          >
            {m.demands_search_hint()}
          </p>
        </div>
        {/* sm+: always shown, CSS only */}
        <details
          open={chosen}
          className="group lg:col-span-2 lg:row-start-2 sm:[&::details-content]:[content-visibility:visible]"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold sm:supports-[selector(::details-content)]:hidden [&::-webkit-details-marker]:hidden">
            {m.demands_filter_more()}
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="mt-2 grid grid-cols-1 items-start gap-4 sm:mt-0 sm:grid-cols-3">
            <Select
              id="demands-scope"
              name="lingkup"
              label={m.demands_filter_scope()}
              defaultValue={query.lingkup ?? ""}
            >
              <option value="">{m.demands_filter_all()}</option>
              <option value="nasional">{m.demand_scope_national()}</option>
              <option value="daerah">{m.demand_scope_regional()}</option>
            </Select>
            <Select
              id="demands-province"
              name="provinsi"
              label={m.demands_filter_province()}
              defaultValue={query.provinsi ?? ""}
            >
              <option value="">{m.demands_filter_all_provinces()}</option>
              {provinces.map((province) => (
                <option key={province.code} value={province.code}>
                  {province.name}
                </option>
              ))}
            </Select>
            <Select
              id="demands-status"
              name="status"
              label={m.demands_filter_status()}
              defaultValue={query.status ?? ""}
            >
              <option value="">{m.demands_filter_all()}</option>
              {FULFILMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {FULFILMENT_TEXT[status]()}
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
    </Form>
  )
}
