import { FileText, MapPin } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router"
import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"
import { formatIsoDate } from "../../../shared/format.ts"
import type { ListedDemand } from "./demands.server"
import { demandPlace, STATE_TEXT } from "./labels"
import { FulfilmentMark } from "./status-mark"

const COLUMNS = "md:grid-cols-[3rem_minmax(0,1fr)_10rem_10rem_8rem]"
const HEAD = "font-semibold font-ui text-ink-soft text-sm"

// Visible on phones, read everywhere
function CellLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-semibold font-ui text-sm md:sr-only">
      {children}
      <span aria-hidden="true">: </span>
    </span>
  )
}

/** Mockup register, stacks on phones. */
export function DemandLedger({
  demands,
  start = 0,
}: {
  demands: ListedDemand[]
  // Numbering continues per page
  start?: number
}) {
  return (
    <div className="border-ink border-t-2">
      {/* Sighted column heads only */}
      <div
        aria-hidden="true"
        className={cn(
          "hidden gap-4 border-ink/15 border-b py-2.5 md:grid",
          COLUMNS,
        )}
      >
        <span className={HEAD}>{m.demands_col_number()}</span>
        <span className={HEAD}>{m.demands_col_demand()}</span>
        <span className={HEAD}>{m.demands_col_response()}</span>
        <span className={HEAD}>{m.demands_col_fulfilment()}</span>
        <span className={cn(HEAD, "text-right")}>
          {m.demands_col_document()}
        </span>
      </div>
      <ol aria-label={m.demands_ledger_label()} start={start + 1}>
        {demands.map((demand, index) => (
          <li
            key={demand.code}
            className={cn(
              "grid gap-x-4 gap-y-2 border-ink/15 border-b py-5",
              COLUMNS,
            )}
          >
            <span
              aria-hidden="true"
              className="font-semibold font-ui text-accent text-lg tabular-nums"
            >
              {String(start + index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <h3 className="font-bold text-lg leading-snug">
                <Link
                  to={`/tuntutan/${demand.code}`}
                  className="decoration-2 decoration-brand underline-offset-4 hover:underline"
                >
                  {demand.title}
                </Link>
              </h3>
              <p className="mt-1.5 text-ink-soft leading-relaxed">
                {demand.summary}
              </p>
              <p className="mt-1.5 flex items-start gap-1.5 font-ui text-ink-muted text-sm">
                <MapPin
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-brand"
                />
                <span>
                  {[
                    demandPlace(demand),
                    m.demand_raised_on({
                      date: formatIsoDate(demand.raisedOn),
                    }),
                    // Linking is optional
                    demand.issueCount > 0
                      ? m.demand_issue_count({ count: demand.issueCount })
                      : null,
                    demand.state === "closed" ? STATE_TEXT.closed() : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </p>
            </div>
            <p className="font-ui text-sm md:pt-1">
              <CellLabel>{m.demands_col_response()}</CellLabel>
              {/* Label already says direspons */}
              <span className="md:hidden">
                {m.demand_responded_short({
                  done: demand.progress.responded,
                  total: demand.progress.total,
                })}
              </span>
              <span className="max-md:hidden">
                {m.demand_responded_count({
                  done: demand.progress.responded,
                  total: demand.progress.total,
                })}
              </span>
            </p>
            <div className="md:pt-1">
              <CellLabel>{m.demands_col_fulfilment()}</CellLabel>
              <FulfilmentMark status={demand.progress.status} />
              <span className="mt-0.5 block font-ui text-ink-muted text-sm">
                {m.demand_progress_line({
                  done: demand.progress.fulfilled,
                  total: demand.progress.total,
                })}
              </span>
            </div>
            <p className="font-ui text-sm md:pt-1 md:text-right">
              <CellLabel>{m.demands_col_document()}</CellLabel>
              {demand.briefs > 0 ? (
                <Link
                  to={`/tuntutan/${demand.code}#sub-${demand.firstBrief ?? 1}`}
                  className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline"
                >
                  <FileText aria-hidden="true" className="size-4" />
                  {m.demand_brief_count({ count: demand.briefs })}
                </Link>
              ) : (
                <span className="text-ink-muted">{m.demand_brief_none()}</span>
              )}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
