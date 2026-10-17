import { m } from "~/paraglide/messages.js"
import type { TrendPoint } from "../../../shared/dashboard.ts"
import { formatNumber } from "../../../shared/format.ts"
import { ChartCard, DataTable } from "./chart-card"
import { TREND_COLOR } from "./chart-theme"
import { formatMonth } from "./format"
import { TrendLines } from "./trend-lines"

export function TrendChart({
  trend,
  total,
}: {
  trend: TrendPoint[]
  total: number
}) {
  const first = trend[0]?.month
  const last = trend.at(-1)?.month
  const table = (
    <DataTable
      caption={m.data_trend_caption()}
      columns={[
        m.data_col_month(),
        m.data_col_received(),
        m.data_col_verified(),
      ]}
      rows={trend.map((point) => [
        formatMonth(point.month, "long"),
        formatNumber(point.received),
        formatNumber(point.verified),
      ])}
    />
  )
  const series = [
    { key: "received", label: m.data_series_received() },
    { key: "verified", label: m.data_series_verified() },
  ] as const
  return (
    <ChartCard
      chart="monthly"
      title={m.data_trend_title()}
      description={
        last
          ? m.data_trend_lead({ month: formatMonth(last, "long") })
          : undefined
      }
      legend={
        <ul className="flex flex-wrap gap-4 font-ui text-sm">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-0.5 w-4"
                style={{ background: TREND_COLOR[s.key] }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      }
      table={table}
      meta={m.data_meta({
        unit: m.data_unit_reports(),
        period:
          first && last
            ? m.data_period_months({
                from: formatMonth(first, "long"),
                to: formatMonth(last, "long"),
              })
            : m.data_period_none(),
        n: formatNumber(total),
      })}
    >
      <div className="h-72 lg:h-full lg:min-h-72">
        <TrendLines trend={trend} labels={series} />
      </div>
    </ChartCard>
  )
}
