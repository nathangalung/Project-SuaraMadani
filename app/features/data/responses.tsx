import { Link } from "react-router"
import { Card } from "~/components/ui/card"
import { m } from "~/paraglide/messages.js"
import {
  MIN_PUBLIC_N,
  type ReasonCounts,
  type ResponseSummary,
  WAIT_BUCKETS,
  type WaitBucket,
} from "../../../shared/dashboard.ts"
import { formatNumber } from "../../../shared/format.ts"
import {
  publicRejectReasonText,
  UNVERIFIABLE_TEXT,
} from "../moderation/public-reason-labels"
import { DataTable } from "./chart-card"
import { countText, durationText, formatDecimal } from "./format"

const WAIT_TEXT: Record<WaitBucket, () => string> = {
  d0_7: m.data_wait_d0_7,
  d8_14: m.data_wait_d8_14,
  d15_30: m.data_wait_d15_30,
  d31_90: m.data_wait_d31_90,
  d91: m.data_wait_d91,
}

const days = (value: number) => durationText(value * 24)

/** PLAN §5.8, tables without JS. */
export function AgencyResponse({ response }: { response: ResponseSummary }) {
  const { firstResponse: first } = response
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="flex flex-col bg-brand p-6 text-on-accent">
        <h3 className="font-semibold">
          {m.data_response_rate_label({ days: response.days })}
        </h3>
        {response.share === null ? (
          <>
            <p className="mt-6 font-bold text-3xl leading-tight">
              {m.data_not_enough()}
            </p>
            <p className="mt-4 text-sm leading-snug">
              {m.data_response_few({ min: MIN_PUBLIC_N, days: response.days })}
            </p>
          </>
        ) : (
          <p className="mt-6 font-bold text-6xl leading-none sm:text-7xl">
            {formatDecimal(response.share * 100)}
            <span className="text-4xl sm:text-5xl">%</span>
          </p>
        )}
        <p className="mt-3 text-sm">
          {m.data_response_rate_of({
            responded: formatNumber(response.responded),
            due: formatNumber(response.due),
            days: response.days,
          })}
        </p>
      </div>
      <Card className="flex flex-col p-6">
        <h3 className="font-bold text-2xl">{m.data_first_response_title()}</h3>
        <p className="mt-1 font-ui text-ink-muted text-sm">
          {m.data_first_response_lead()}
        </p>
        {first.medianDays === null || first.p90Days === null ? (
          <p className="mt-6 border-ink border-t-2 pt-4">
            {m.data_first_response_few({ min: MIN_PUBLIC_N })}
          </p>
        ) : (
          <>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-ink border-t-2 pt-4">
              <div className="flex flex-col justify-between">
                <dt className="mb-1 font-ui text-ink-muted text-sm">
                  {m.data_response_median_label()}
                </dt>
                <dd className="font-bold text-4xl leading-none">
                  {days(first.medianDays)}
                </dd>
              </div>
              <div className="flex flex-col justify-between">
                <dt className="mb-1 font-ui text-ink-muted text-sm">
                  {m.data_response_p90_label()}
                </dt>
                <dd className="font-bold text-4xl leading-none">
                  {days(first.p90Days)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 font-ui text-ink-muted text-xs">
              {m.data_first_response_n({ n: formatNumber(first.n) })}
            </p>
          </>
        )}
      </Card>
      <Card className="p-6">
        <CardTitle>{m.data_waiting_caption()}</CardTitle>
        <DataTable
          caption={m.data_waiting_caption()}
          captionHidden
          columns={[m.data_waiting_col_age(), m.data_waiting_col_issues()]}
          rows={[
            ...WAIT_BUCKETS.map((bucket) => [
              WAIT_TEXT[bucket.id](),
              formatNumber(response.waiting[bucket.id]),
            ]),
            // Same set as the link
            [m.data_wait_unreferred(), formatNumber(response.unreferred)],
          ]}
        />
        <p className="mt-4 font-ui text-sm">
          <Link
            to="/isu?status=awaiting_response"
            className="font-semibold text-accent underline underline-offset-4 hover:no-underline"
          >
            {m.data_response_link()}
          </Link>
        </p>
      </Card>
      <Card className="p-6">
        <CardTitle>{m.data_overdue_caption()}</CardTitle>
        <OverdueTable response={response} />
      </Card>
    </div>
  )
}

function CardTitle({ children }: { children: string }) {
  return <h3 className="mb-4 font-bold text-2xl">{children}</h3>
}

/** Overdue agencies, then count. */
function OverdueTable({ response }: { response: ResponseSummary }) {
  const clear = formatNumber(response.clearAgencies)
  if (response.overdue.length === 0) {
    return (
      <p>
        {response.clearAgencies === 0
          ? m.data_overdue_none()
          : m.data_overdue_all_clear({ n: clear })}
      </p>
    )
  }
  return (
    <>
      <DataTable
        caption={m.data_overdue_caption()}
        captionHidden
        columns={[
          m.data_overdue_col_agency(),
          m.data_overdue_col_overdue(),
          m.data_overdue_col_referred(),
        ]}
        rows={response.overdue.map((row) => [
          row.agency,
          formatNumber(row.overdue),
          formatNumber(row.referred),
        ])}
      />
      {response.clearAgencies > 0 && (
        <p className="mt-3 font-ui text-sm">
          {m.data_overdue_clear({ n: clear })}
        </p>
      )}
      <p className="mt-3 font-ui text-ink-muted text-xs">
        {m.data_overdue_note()}
      </p>
    </>
  )
}

/** PLAN §5.10: counts per code. */
export function ReasonTable({ reasons }: { reasons: ReasonCounts }) {
  const rows = [
    ...Object.entries(reasons.rejected).map(([code, n]) => [
      publicRejectReasonText(code as keyof ReasonCounts["rejected"]),
      n,
    ]),
    ...Object.entries(reasons.unverifiable).map(([code, n]) => [
      UNVERIFIABLE_TEXT[code as keyof ReasonCounts["unverifiable"]](),
      n,
    ]),
  ].filter((row): row is [string, number | null] => row[1] !== 0)
  return (
    <Card className="p-6">
      <h3 className="font-bold text-2xl">{m.data_reasons_caption()}</h3>
      <p className="mt-1 mb-4 font-ui text-ink-muted text-sm">
        {m.data_reasons_lead()}
      </p>
      {rows.length === 0 ? (
        <p>{m.data_reasons_none()}</p>
      ) : (
        <DataTable
          caption={m.data_reasons_caption()}
          captionHidden
          columns={[m.data_reasons_col_reason(), m.data_reasons_col_reports()]}
          rows={rows.map(([label, n]) => [label, countText(n)])}
        />
      )}
    </Card>
  )
}
