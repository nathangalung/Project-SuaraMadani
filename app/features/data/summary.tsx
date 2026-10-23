import type { CSSProperties } from "react"
import { useStagger } from "~/components/layout/use-reveal"
import { Card } from "~/components/ui/card"
import { Container } from "~/components/ui/container"
import { m } from "~/paraglide/messages.js"
import {
  type DashboardSnapshot,
  MIN_PUBLIC_N,
  VERIFY_WINDOW_DAYS,
} from "../../../shared/dashboard.ts"
import {
  formatDate,
  formatNumber,
  formatPercent,
} from "../../../shared/format.ts"
import type { DemandCounts } from "../demands/demands.server"
import { GOVERNMENT_TEXT } from "../issues/labels"
import { countText, durationText, formatDecimal } from "./format"

type Summary = Omit<
  DashboardSnapshot,
  "verifiedProvinces" | "verifiedProvinceTotals"
>

// Mockup ResponseRate tile look
export function ResolutionTile({ summary }: { summary: Summary }) {
  const { claimTotal, checked, confirmedShare } = summary.resolution
  // PLAN §5.8: counts together
  const counts = [
    {
      label: GOVERNMENT_TEXT.confirmed_resolved(),
      value: summary.resolution.confirmed,
    },
    { label: GOVERNMENT_TEXT.reopened(), value: summary.resolution.reopened },
    { label: m.data_resolution_pending(), value: summary.resolution.pending },
  ]
  return (
    <div className="flex h-full flex-col rounded-2xl bg-brand p-6 text-on-accent">
      <h3 className="pr-8 font-semibold">{m.data_resolution_title()}</h3>
      <div className="mt-6">
        {confirmedShare === null ? (
          <p className="font-bold text-3xl leading-tight">
            {m.data_not_enough()}
          </p>
        ) : (
          <>
            <p className="font-bold text-6xl leading-none sm:text-7xl">
              {formatDecimal(confirmedShare * 100)}
              <span className="text-4xl sm:text-5xl">%</span>
            </p>
            <p className="mt-2 text-sm">
              {m.data_resolution_checked({ n: countText(checked) })}
            </p>
          </>
        )}
        {confirmedShare === null && (
          <p className="mt-4 text-sm leading-snug">
            {m.data_resolution_few({ min: MIN_PUBLIC_N })}
          </p>
        )}
        {claimTotal !== 0 && (
          <div className="mt-4 border-on-accent/40 border-t pt-3 text-sm leading-snug">
            <p>{m.data_resolution_body({ total: countText(claimTotal) })}</p>
            <dl className="mt-2 flex flex-col gap-1">
              {counts.map((row) => (
                <div key={row.label} className="flex justify-between gap-3">
                  <dt>{row.label}</dt>
                  <dd className="whitespace-nowrap font-semibold tabular-nums">
                    {countText(row.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
      {confirmedShare !== null && (
        <div
          aria-hidden="true"
          className="mt-6 h-2.5 overflow-hidden rounded-full bg-ink/40 lg:mt-auto"
        >
          <div
            className="h-full bg-surface-raised"
            style={{ width: `${Math.min(100, confirmedShare * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function ModerationCard({ summary }: { summary: Summary }) {
  const { n, medianHours, p90Hours } = summary.verifyTime
  return (
    <Card className="flex h-full flex-col p-6">
      <h3 className="font-bold text-2xl">{m.data_moderation_title()}</h3>
      <p className="mt-1 text-ink-muted text-sm">
        {m.data_moderation_lead({ days: VERIFY_WINDOW_DAYS })}
      </p>
      {medianHours === null || p90Hours === null ? (
        <p className="mt-6 border-ink border-t-2 pt-4">
          {m.data_verify_few({ min: MIN_PUBLIC_N, days: VERIFY_WINDOW_DAYS })}
        </p>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-ink border-t-2 pt-4">
            <div className="flex flex-col justify-between">
              <dt className="mb-1 text-ink-muted text-sm">
                {m.data_median_label()}
              </dt>
              <dd className="font-bold text-4xl leading-none">
                {durationText(medianHours)}
              </dd>
            </div>
            <div className="flex flex-col justify-between">
              <dt className="mb-1 text-ink-muted text-sm">
                {m.data_p90_label()}
              </dt>
              <dd className="font-bold text-4xl leading-none">
                {durationText(p90Hours)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-ink-muted text-xs">
            {m.data_verify_n({ n: formatNumber(n) })}
          </p>
        </>
      )}
      <p className="mt-auto border-line-subtle border-t pt-4 text-sm">
        {m.data_queue({ n: formatNumber(summary.reports.queue) })}
      </p>
    </Card>
  )
}

type Tile = { label: string; value: string; note: string }

// Mockup StatTile in a dl
export function KeyNumbers({
  summary,
  demands,
}: {
  summary: Summary
  demands: DemandCounts
}) {
  const list = useStagger<HTMLDListElement>()
  const { reports, issues } = summary
  const tiles: Tile[] = [
    {
      label: m.data_key_reports(),
      value: formatNumber(reports.total),
      note: summary.firstReportAt
        ? m.data_key_reports_note({
            date: formatDate(new Date(summary.firstReportAt)),
          })
        : m.data_period_none(),
    },
    {
      label: m.data_key_verified(),
      value: formatNumber(reports.verified),
      note:
        reports.verifiedShare === null
          ? m.data_key_verified_few({ min: MIN_PUBLIC_N })
          : m.data_key_verified_note({
              share: formatPercent(reports.verifiedShare),
              n: formatNumber(reports.decided),
            }),
    },
    {
      label: m.data_key_issues(),
      value: formatNumber(issues.published),
      note: m.data_key_issues_note({ n: formatNumber(issues.mergedReports) }),
    },
    {
      label: m.data_key_ratio(),
      value:
        issues.reportsPerIssue === null
          ? "–"
          : formatDecimal(issues.reportsPerIssue),
      note:
        issues.reportsPerIssue === null
          ? m.data_key_ratio_few({ min: MIN_PUBLIC_N })
          : m.data_key_ratio_note(),
    },
    // Live, exact: public content
    {
      label: m.data_key_demands(),
      value: formatNumber(demands.total),
      note: m.data_key_demands_note({
        national: formatNumber(demands.national),
        regional: formatNumber(demands.regional),
      }),
    },
    {
      label: m.data_key_demands_active(),
      value: formatNumber(demands.active),
      note: m.data_key_demands_active_note(),
    },
    {
      label: m.data_key_demands_fulfilled(),
      value: formatNumber(demands.fulfilled),
      note: m.data_key_demands_fulfilled_note(),
    },
    {
      label: m.data_key_items_fulfilled(),
      value: formatNumber(demands.itemsFulfilled),
      note: m.data_key_items_fulfilled_note({
        n: formatNumber(demands.items),
      }),
    },
  ]
  return (
    <section
      aria-labelledby="angka-utama"
      className="bg-ink text-surface-raised"
    >
      <Container className="py-12">
        <h2
          id="angka-utama"
          className="font-bold font-heading text-[clamp(2rem,4.4vw,3rem)] leading-[1.1] [font-synthesis-weight:none]"
        >
          {m.data_key_title()}
        </h2>
        <dl
          ref={list}
          className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4"
        >
          {tiles.map((tile, index) => (
            <div
              key={tile.label}
              style={{ "--i": index } as CSSProperties}
              className="flex flex-col-reverse justify-end"
            >
              <dt className="mt-2 text-sm text-surface-raised/80">
                {tile.label}
                <span className="block text-surface-raised/70 text-xs">
                  {tile.note}
                </span>
              </dt>
              <dd className="font-bold text-[clamp(2rem,4.4vw,3rem)] leading-none">
                {tile.value}
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  )
}
