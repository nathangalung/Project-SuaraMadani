import { ChevronRight } from "lucide-react"
import { Link } from "react-router"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import { FulfilmentMark } from "../demands/status-mark"
import type { Followed } from "./followed.server"
import { StageMark } from "./issue-status"

const LIST =
  "mt-4 divide-y divide-line-subtle overflow-hidden rounded-2xl border border-line-subtle bg-surface-raised"
const ROW =
  "group flex items-center justify-between gap-4 px-6 py-4 text-ink transition-colors hover:bg-brand-soft"

function Updated({ at }: { at: Date }) {
  return (
    <span className="mt-1 block text-ink-muted text-sm">
      {m.followed_updated({ date: formatDate(at) })}
    </span>
  )
}

/** Followed items, no email. */
export function FollowedList({ followed }: { followed: Followed }) {
  const empty = followed.issues.length === 0 && followed.demands.length === 0
  return (
    <section aria-labelledby="yang-diikuti" className="mt-16">
      <h2 id="yang-diikuti" className="font-bold font-heading text-2xl">
        {m.followed_title()}
      </h2>
      <p className="mt-2 text-ink-soft">{m.followed_lead()}</p>
      {empty ? (
        <p className="mt-4 text-ink-muted">{m.followed_none()}</p>
      ) : null}
      {followed.issues.length > 0 ? (
        <>
          <h3 className="mt-8 font-semibold text-lg">{m.followed_issues()}</h3>
          <ul className={LIST}>
            {followed.issues.map((issue) => (
              <li key={issue.code}>
                <Link to={`/isu/${issue.code}`} className={ROW}>
                  <span className="min-w-0">
                    <span className="block font-semibold underline-offset-4 group-hover:underline">
                      {issue.title}
                    </span>
                    <Updated at={issue.updatedAt} />
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <StageMark {...issue.state} />
                    <ChevronRight aria-hidden="true" className="size-5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {followed.demands.length > 0 ? (
        <>
          <h3 className="mt-8 font-semibold text-lg">{m.followed_demands()}</h3>
          <ul className={LIST}>
            {followed.demands.map((demand) => (
              <li key={demand.code}>
                <Link to={`/tuntutan/${demand.code}`} className={ROW}>
                  <span className="min-w-0">
                    <span className="block font-semibold underline-offset-4 group-hover:underline">
                      {demand.title}
                    </span>
                    <Updated at={demand.updatedAt} />
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <FulfilmentMark status={demand.progress} />
                    <ChevronRight aria-hidden="true" className="size-5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
