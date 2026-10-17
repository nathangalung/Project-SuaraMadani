import { m } from "~/paraglide/messages.js"
import { CATEGORY_IDS } from "../../../shared/categories.ts"
import {
  type Count,
  type DashboardSnapshot,
  publicShare,
} from "../../../shared/dashboard.ts"
import {
  formatDate,
  formatNumber,
  formatPercent,
} from "../../../shared/format.ts"
import type { GovernmentStatus } from "../../../shared/status.ts"
import { GOVERNMENT_TEXT } from "../issues/labels"
import { CATEGORY_SHORT_TEXT } from "../report/category-labels"
import { ChartCard, DataTable } from "./chart-card"
import { CATEGORY_COLOR, SIDE_STATUS_COLOR, STATUS_RAMP } from "./chart-theme"
import { barWidth, countText } from "./format"

type Summary = Omit<
  DashboardSnapshot,
  "verifiedProvinces" | "verifiedProvinceTotals"
>

function maxOf(counts: Count[]): number {
  return Math.max(0, ...counts.map((count) => count ?? 0))
}

function issueMeta(summary: Summary): string {
  return m.data_meta({
    unit: m.data_unit_issues(),
    period: summary.firstReportAt
      ? m.data_period_since({
          date: formatDate(new Date(summary.firstReportAt)),
        })
      : m.data_period_none(),
    n: formatNumber(summary.issues.published),
  })
}

// HTML bars, no chart JS
export function CategoryBreakdown({ summary }: { summary: Summary }) {
  const rows = CATEGORY_IDS.map((id) => ({
    id,
    label: CATEGORY_SHORT_TEXT[id](),
    count: summary.categories[id],
  }))
  const total = summary.issues.published
  const max = maxOf(rows.map((row) => row.count))
  // Share only from exact cells
  const share = (count: Count) => {
    const ratio = count === null ? null : publicShare(count, total)
    return ratio === null ? "–" : formatPercent(ratio)
  }
  return (
    <ChartCard
      chart="category"
      title={m.data_category_title()}
      description={m.data_category_lead()}
      meta={issueMeta(summary)}
      table={
        <DataTable
          caption={m.data_category_caption()}
          columns={[
            m.data_col_category(),
            m.data_col_issues(),
            m.data_col_share(),
          ]}
          rows={rows.map((row) => [
            row.label,
            countText(row.count),
            share(row.count),
          ])}
        />
      }
    >
      <ul className="flex flex-col gap-4">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="flex items-baseline justify-between gap-2 font-ui text-sm">
              <span>{row.label}</span>
              <span className="text-ink-muted tabular-nums">
                {share(row.count)}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-[1fr_3.5rem] items-center gap-2">
              <span className="block h-3">
                <span
                  className="block h-full"
                  style={{
                    width: barWidth(row.count, max),
                    background: CATEGORY_COLOR[row.id],
                  }}
                />
              </span>
              <span className="whitespace-nowrap text-right font-semibold font-ui text-sm tabular-nums">
                {countText(row.count)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}

// Ordinal pipeline, then side exits
const PIPELINE: GovernmentStatus[] = [
  "awaiting_response",
  "responded",
  "in_progress",
  "claimed_resolved",
  "confirmed_resolved",
]
const SIDE: GovernmentStatus[] = [
  "reopened",
  "not_competent",
  "not_followed_up",
  "closed",
]

function StatusBars({
  statuses,
  counts,
  max,
  start,
  color,
}: {
  statuses: GovernmentStatus[]
  counts: Summary["statuses"]
  max: number
  start: number
  color: (index: number) => string
}) {
  return (
    <ol start={start} className="flex flex-col gap-3">
      {statuses.map((status, i) => (
        <li
          key={status}
          className="grid grid-cols-[minmax(0,10.75rem)_1fr] items-center gap-3 font-ui text-sm"
        >
          <span className="truncate">
            <span className="mr-1.5 text-ink-muted tabular-nums">
              {start + i}
            </span>
            {GOVERNMENT_TEXT[status]()}
          </span>
          <span className="grid grid-cols-[1fr_2.75rem] items-center gap-2">
            <span className="block h-3">
              <span
                className="block h-full"
                style={{
                  width: barWidth(counts[status], max),
                  background: color(i),
                }}
              />
            </span>
            <span className="whitespace-nowrap text-right font-semibold tabular-nums">
              {countText(counts[status])}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export function StatusFlow({
  summary,
  className,
}: {
  summary: Summary
  className?: string
}) {
  const counts = summary.statuses
  const max = maxOf([...PIPELINE, ...SIDE].map((status) => counts[status]))
  return (
    <ChartCard
      chart="status"
      className={className}
      title={m.data_status_title()}
      description={m.data_status_lead()}
      meta={issueMeta(summary)}
      table={
        <DataTable
          caption={m.data_status_caption()}
          columns={[m.data_col_status(), m.data_col_issues()]}
          rows={[...PIPELINE, ...SIDE].map((status) => [
            GOVERNMENT_TEXT[status](),
            countText(counts[status]),
          ])}
        />
      }
    >
      <div className="grid gap-x-10 lg:grid-cols-2">
        <StatusBars
          statuses={PIPELINE}
          counts={counts}
          max={max}
          start={1}
          color={(i) => STATUS_RAMP[i] ?? STATUS_RAMP[0]}
        />
        <div>
          <p className="mt-5 mb-3 border-line-subtle border-t pt-3 font-semibold font-ui text-ink-muted text-xs lg:mt-0">
            {m.data_status_other()}
          </p>
          <StatusBars
            statuses={SIDE}
            counts={counts}
            max={max}
            start={PIPELINE.length + 1}
            color={() => SIDE_STATUS_COLOR}
          />
        </div>
      </div>
    </ChartCard>
  )
}
