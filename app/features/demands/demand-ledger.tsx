import { Link } from "react-router"
import { m } from "~/paraglide/messages.js"
import { formatIsoDate } from "../../../shared/format.ts"
import { CATEGORY_TEXT } from "./category-labels"
import type { ListedDemand } from "./demands.server"
import { demandPlace } from "./labels"
import { FulfilmentMark } from "./status-mark"

// Rounded card, like IssueCard
export function DemandCard({ demand }: { demand: ListedDemand }) {
  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-line-subtle bg-surface-raised p-6 transition-[border-color,translate] duration-(--dur-hover) hover:-translate-y-0.5 hover:border-ink/40 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-focus has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-solid motion-reduce:hover:translate-y-0">
      {demand.category ? (
        <span className="self-start rounded-full bg-surface px-3 py-1 text-sm">
          {CATEGORY_TEXT[demand.category]()}
        </span>
      ) : null}
      <p className="mt-5 font-semibold text-ink-soft text-sm tabular-nums">
        {demand.code}
      </p>
      <h3 className="mt-1 font-bold text-ink text-xl leading-snug">
        <Link
          to={`/tuntutan/${demand.code}`}
          className="decoration-2 decoration-brand underline-offset-4 after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none group-hover:underline"
        >
          {demand.title}
        </Link>
      </h3>
      <p className="mt-2 line-clamp-3 text-ink-soft leading-relaxed">
        {demand.summary}
      </p>
      <div className="mt-auto pt-6">
        <FulfilmentMark status={demand.progress.status} />
      </div>
      <p className="mt-2 text-ink-muted text-sm">
        {m.demand_progress_line({
          done: demand.progress.fulfilled,
          total: demand.progress.total,
        })}
      </p>
      <p className="mt-4 text-ink-soft text-sm">{demandPlace(demand)}</p>
      <p className="mt-1 text-ink-muted text-xs">
        {m.demand_raised_on({ date: formatIsoDate(demand.raisedOn) })}
      </p>
      {demand.briefs > 0 ? (
        <Link
          to={`/tuntutan/${demand.code}#sub-${demand.firstBrief ?? 1}`}
          className="relative z-10 mt-3 self-start text-accent text-sm underline underline-offset-4 hover:no-underline"
        >
          {m.demand_brief_count({ count: demand.briefs })}
        </Link>
      ) : null}
    </article>
  )
}

/** Card grid, like /isu. */
export function DemandLedger({ demands }: { demands: ListedDemand[] }) {
  return (
    <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {demands.map((demand) => (
        <li key={demand.code}>
          <DemandCard demand={demand} />
        </li>
      ))}
    </ul>
  )
}
