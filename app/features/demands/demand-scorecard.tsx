import { Link } from "react-router"
import { cn } from "~/components/ui/cn"
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

const BLOCK = "flex w-full flex-col gap-2 border-2 bg-surface-raised p-4"

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
      <span className="mt-auto flex flex-col gap-2">
        <span className="font-bold text-3xl tabular-nums">
          {formatNumber(count)}
        </span>
        <span className="font-ui text-ink-muted text-sm">
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
      <h2 id="demands-scorecard" className="font-bold text-lg">
        {m.demands_scorecard_title({
          count: formatNumber(scorecard.total),
        })}
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FULFILMENT_STATUSES.map((status) => {
          const count = scorecard.counts[status]
          const active = query.status === status
          return (
            <li key={status} className="flex">
              {count === 0 && !active ? (
                // Zero leads nowhere useful
                <div className={cn(BLOCK, "border-line-subtle")}>
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
                    kursor: undefined,
                  })}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    BLOCK,
                    "transition-colors duration-(--dur-hover) motion-reduce:transition-none",
                    active
                      ? "border-brand"
                      : "border-line-subtle hover:border-ink/40",
                  )}
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
