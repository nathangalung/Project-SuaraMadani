import { FileText } from "lucide-react"
import type { CSSProperties } from "react"
import { Link } from "react-router"
import { useStagger } from "~/components/layout/use-reveal"
import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"
import type { LatestDemand } from "./demands.server"
import { demandPlace, STATE_TEXT } from "./labels"
import { FulfilmentMark, ProgressSquares } from "./status-mark"

/** Compact register, home and /data. */
export function DemandDigest({
  demands,
  ruled = true,
}: {
  demands: LatestDemand[]
  // Panel draws its own rule
  ruled?: boolean
}) {
  const list = useStagger<HTMLOListElement>()
  return (
    <ol ref={list} className={cn(ruled && "border-ink border-t-2")}>
      {demands.map((demand, index) => (
        <li
          key={demand.code}
          style={{ "--i": index } as CSSProperties}
          className="grid gap-x-4 gap-y-2 border-ink/15 border-b py-5 sm:grid-cols-[2.5rem_minmax(0,1fr)]"
        >
          <span
            aria-hidden="true"
            className="font-semibold font-ui text-accent text-lg tabular-nums"
          >
            {String(index + 1).padStart(2, "0")}
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
            <p className="mt-1 font-ui text-ink-muted text-sm">
              {demand.state === "closed"
                ? `${demandPlace(demand)} · ${STATE_TEXT.closed()}`
                : demandPlace(demand)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <FulfilmentMark status={demand.progress.status} />
              <ProgressSquares
                items={demand.marks}
                label={m.demand_progress_line({
                  done: demand.progress.fulfilled,
                  total: demand.progress.total,
                })}
              />
              {demand.briefs > 0 && (
                <Link
                  to={`/tuntutan/${demand.code}#sub-tuntutan`}
                  className="inline-flex items-center gap-1.5 font-semibold font-ui text-accent text-sm hover:underline"
                >
                  <FileText aria-hidden="true" className="size-4" />
                  {m.demand_brief_count({ count: demand.briefs })}
                </Link>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
