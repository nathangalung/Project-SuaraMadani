import { ChevronRight } from "lucide-react"
import type { CSSProperties } from "react"
import { Link } from "react-router"
import { useStagger } from "~/components/layout/use-reveal"
import { Card } from "~/components/ui/card"
import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"
import {
  ISSUE_RANKINGS,
  type IssueRanking,
} from "../../../shared/canonical-query.ts"
import { REFRESH_MINUTES } from "../../../shared/dashboard.ts"
import { formatNumber } from "../../../shared/format.ts"
import { CategoryBadge, GovernmentBadge } from "../issues/issue-status"
import type { RankedIssue } from "../issues/issues.server"
import type { MapView } from "./dashboard.server"
import { dataHref, paramsOf } from "./region-map"
import { SectionLink } from "./section-link"

const TAB_TEXT: Record<IssueRanking, () => string> = {
  laporan: m.data_ranking_laporan,
  terlama: m.data_ranking_terlama,
}

const NOTE_TEXT: Record<IssueRanking, () => string> = {
  laporan: m.data_ranking_laporan_note,
  terlama: m.data_ranking_terlama_note,
}

function metric(ranking: IssueRanking, issue: RankedIssue) {
  return ranking === "terlama"
    ? { value: issue.days, unit: m.data_ranking_unit_days() }
    : { value: issue.reportCount, unit: m.data_unit_reports() }
}

function placeOf(issue: RankedIssue): string {
  return issue.districtName
    ? `${issue.districtName}, ${issue.regencyName}`
    : issue.regencyName
}

// Mockup IssueRanking, URL tabs
export function RankedIssues({
  map,
  issues,
}: {
  map: MapView
  issues: RankedIssue[]
}) {
  const list = useStagger<HTMLOListElement>()
  const active = map.ranking
  const params = paramsOf(map)
  return (
    <Card className="overflow-hidden">
      <nav
        aria-label={m.data_ranking_label()}
        className="border-ink border-b-2 bg-surface"
      >
        <ul className="flex overflow-x-auto">
          {ISSUE_RANKINGS.map((id) => (
            <li key={id} className="shrink-0">
              <SectionLink
                section="peringkat-isu"
                to={dataHref({ ...params, peringkat: id })}
                aria-current={id === active ? "true" : undefined}
                className={cn(
                  "block whitespace-nowrap px-4 py-3.5 font-ui text-sm transition-colors",
                  id === active
                    ? "bg-brand font-semibold text-on-accent"
                    : "text-ink hover:bg-ink/5",
                )}
              >
                {TAB_TEXT[id]()}
              </SectionLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="p-4 sm:p-6">
        <p className="pb-3 text-ink-soft text-sm">{NOTE_TEXT[active]()}</p>
        {issues.length === 0 ? (
          <p className="py-6 text-ink-soft text-sm">{m.data_ranking_empty()}</p>
        ) : (
          <ol ref={list} className="flex flex-col">
            {issues.map((issue, index) => {
              const { value, unit } = metric(active, issue)
              return (
                <li
                  key={issue.code}
                  style={{ "--i": index } as CSSProperties}
                  className="border-ink/10 border-t first:border-0"
                >
                  <Link
                    to={`/isu/${issue.code}`}
                    className="group grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3.5 transition-colors hover:bg-surface sm:gap-4"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-10 place-items-center bg-brand font-bold text-lg text-on-accent tabular-nums"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold leading-snug decoration-2 decoration-brand underline-offset-4 group-hover:underline">
                        {issue.title}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5 font-ui text-ink-soft text-xs">
                        <CategoryBadge categoryId={issue.categoryId} />
                        <GovernmentBadge status={issue.govStatus} />
                        <span>{placeOf(issue)}</span>
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-right">
                      <span>
                        <span className="block font-bold text-lg tabular-nums leading-tight">
                          {formatNumber(value)}
                        </span>
                        <span className="block max-w-20 font-ui text-ink-soft text-xs leading-tight sm:max-w-none">
                          {unit}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="hidden size-4 text-ink-muted transition-transform group-hover:translate-x-0.5 sm:block"
                      />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        )}
        {active === "laporan" && issues.length > 0 && (
          <p className="mt-4">
            <Link
              to="/isu?urut=laporan"
              className="font-semibold text-accent text-sm underline underline-offset-4 hover:no-underline"
            >
              {m.data_ranking_all()}
            </Link>
          </p>
        )}
      </div>
      <p className="border-line-subtle border-t px-4 py-3 font-ui text-ink-muted text-xs sm:px-6">
        {m.data_ranking_meta({ n: formatNumber(issues.length) })}
        <span className="mt-1 block">
          {m.data_ranking_source({ minutes: REFRESH_MINUTES })}
        </span>
      </p>
    </Card>
  )
}
