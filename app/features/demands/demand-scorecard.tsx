import { Link } from "react-router"
import { SECTION_TITLE } from "~/components/layout/section-heading"
import { m } from "~/paraglide/messages.js"
import { sharePercent } from "../../../shared/demands.ts"
import { formatNumber } from "../../../shared/format.ts"
import {
  FULFILMENT_STATUSES,
  type FulfilmentStatus,
} from "../../../shared/status.ts"
import { demandsHref } from "./demand-href"
import type { DemandListQuery, Scorecard } from "./demands.server"
import { FulfilmentMark } from "./status-mark"

// Plain figures, no tiles
const BLOCK = "group flex w-full flex-col items-center gap-2 py-1 text-center"

function BlockBody({
  status,
  count,
  total,
}: {
  status: FulfilmentStatus
  count: number
  total: number
}) {
  return (
    <>
      <FulfilmentMark status={status} />
      {/* Numbers align across a row */}
      <span className="mt-auto flex flex-col items-center gap-2">
        <span className="font-bold text-3xl tabular-nums decoration-2 underline-offset-4 group-hover:underline group-aria-[current=true]:text-brand group-aria-[current=true]:underline">
          {formatNumber(count)}
        </span>
        <span className="text-ink-muted text-sm">
          {m.demands_scorecard_share({ percent: sharePercent(count, total) })}
        </span>
      </span>
    </>
  )
}

/** Block per status, PLAN §6.1. */
export function DemandScorecard({
  scorecard,
  query,
}: {
  scorecard: Scorecard
  query: DemandListQuery
}) {
  return (
    <section aria-labelledby="demands-scorecard">
      <h2 id="demands-scorecard" className={SECTION_TITLE}>
        {m.demands_scorecard_title({
          count: formatNumber(scorecard.total),
        })}
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        {FULFILMENT_STATUSES.map((status) => {
          const count = scorecard.counts[status]
          const active = query.status === status
          return (
            <li key={status} className="flex">
              {count === 0 && !active ? (
                // Zero leads nowhere useful
                <div className={BLOCK}>
                  <BlockBody
                    status={status}
                    count={count}
                    total={scorecard.total}
                  />
                </div>
              ) : (
                <Link
                  to={demandsHref({
                    ...query,
                    status: active ? undefined : status,
                    halaman: undefined,
                  })}
                  aria-current={active ? "true" : undefined}
                  className={BLOCK}
                >
                  <BlockBody
                    status={status}
                    count={count}
                    total={scorecard.total}
                  />
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
