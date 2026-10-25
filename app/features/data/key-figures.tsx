import { SECTION_TITLE } from "~/components/layout/section-heading"
import type { DemandCounts } from "~/features/demands/demands.server"
import { m } from "~/paraglide/messages.js"
import type { Count, StatusFilter } from "../../../shared/dashboard.ts"
import { formatNumber } from "../../../shared/format.ts"
import { countText } from "./format"

type Figure = { label: string; value: string; note?: string }

function Figures({ items }: { items: Figure[] }) {
  return (
    <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col-reverse justify-end rounded-2xl border border-line-subtle bg-surface-raised p-6"
        >
          <dt className="mt-3">
            <span className="block font-semibold text-ink">{item.label}</span>
            {item.note ? (
              <span className="mt-1 block text-ink-muted text-sm">
                {item.note}
              </span>
            ) : null}
          </dt>
          <dd className="font-heading text-5xl text-brand tabular-nums leading-none">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Plain counts, team 25 Oct. */
export function KeyFigures({
  reports,
  demands,
}: {
  reports: Record<StatusFilter, Count>
  demands: DemandCounts
}) {
  const report = (stage: StatusFilter) => countText(reports[stage])
  return (
    <section aria-labelledby="angka-laporan" className="flex flex-col gap-12">
      <div>
        <h2 id="angka-laporan" className={SECTION_TITLE}>
          {m.data_figures_reports()}
        </h2>
        <Figures
          items={[
            { label: m.data_figure_verified(), value: report("all") },
            { label: m.data_figure_referred(), value: report("referred") },
            {
              label: m.data_figure_in_progress(),
              value: report("in_progress"),
            },
            { label: m.data_figure_done(), value: report("done") },
          ]}
        />
      </div>
      <div>
        <h2 className={SECTION_TITLE}>{m.data_figures_demands()}</h2>
        <Figures
          items={[
            {
              label: m.data_figure_demands(),
              value: formatNumber(demands.total),
            },
            {
              label: m.data_figure_demands_active(),
              value: formatNumber(demands.active),
            },
            {
              label: m.data_figure_demands_fulfilled(),
              value: formatNumber(demands.fulfilled),
            },
            {
              label: m.data_figure_items_fulfilled(),
              value: formatNumber(demands.itemsFulfilled),
              note: m.data_figure_items_note({
                n: formatNumber(demands.items),
              }),
            },
          ]}
        />
      </div>
    </section>
  )
}
