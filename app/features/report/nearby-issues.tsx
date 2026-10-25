import { useEffect } from "react"
import { Link, useFetcher } from "react-router"
import { m } from "~/paraglide/messages.js"
import { formatNumber } from "../../../shared/format.ts"
import type { ListedIssue } from "../issues/issues.server"

// PLAN §5.6, §7 step 3
const SHOWN = 3
const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"

type Nearby = Pick<ListedIssue, "code" | "title" | "reportCount">

export function nearbyHref(regencyCode: string): string {
  return `/isu?wilayah=${encodeURIComponent(regencyCode)}`
}

/** Follow instead of a duplicate. */
export function NearbyList({
  issues,
  regency,
  href,
}: {
  issues: Nearby[]
  regency: string
  href: string
}) {
  if (issues.length === 0) return null
  return (
    <section aria-labelledby="isu-serupa">
      <h2 id="isu-serupa" className="font-bold text-lg">
        {m.report_nearby_title()}
      </h2>
      <p className="mt-1 text-ink-soft">{m.report_nearby_lead({ regency })}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {issues.slice(0, SHOWN).map((issue) => (
          <li key={issue.code}>
            <Link to={`/isu/${issue.code}`} className={LINK}>
              {issue.title}
            </Link>
            <p className="flex flex-wrap gap-x-4 font-ui text-ink-muted text-sm">
              <span>{issue.code}</span>
              <span>
                {m.report_nearby_reports({
                  n: formatNumber(issue.reportCount),
                })}
              </span>
              <Link to={`/isu/${issue.code}#ikuti`} className={LINK}>
                {m.report_nearby_follow()}
              </Link>
            </p>
          </li>
        ))}
      </ul>
      {issues.length > SHOWN ? (
        <p className="mt-3 font-ui text-sm">
          <Link to={href} className={LINK}>
            {m.report_nearby_more({ regency })}
          </Link>
        </p>
      ) : null}
    </section>
  )
}

type IssuesData = {
  result: { kind: string; issues?: Nearby[] }
  region: string | null
}

/** Loads /isu for the regency. */
export function NearbyIssues({ regencyCode }: { regencyCode?: string }) {
  const fetcher = useFetcher<IssuesData>()
  const { load } = fetcher
  useEffect(() => {
    if (regencyCode) void load(nearbyHref(regencyCode))
  }, [regencyCode, load])
  if (!regencyCode) return null
  const issues = fetcher.data?.result.issues ?? []
  return (
    <NearbyList
      issues={issues}
      regency={fetcher.data?.region ?? ""}
      href={nearbyHref(regencyCode)}
    />
  )
}
