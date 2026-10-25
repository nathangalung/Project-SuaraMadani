import { Link } from "react-router"
import { cn } from "~/components/ui/cn"
import { Table, Td, Th } from "~/components/ui/table"
import { m } from "~/paraglide/messages.js"
import {
  ISSUE_RANKINGS,
  type IssueRanking,
} from "../../../shared/canonical-query.ts"
import { isCategoryId } from "../../../shared/categories.ts"
import { formatNumber } from "../../../shared/format.ts"
import { StageMark } from "../issues/issue-status"
import type { RankedIssue } from "../issues/issues.server"
import { CATEGORY_SHORT_TEXT } from "../report/category-labels"
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

function _metric(ranking: IssueRanking, issue: RankedIssue) {
  return ranking === "terlama"
    ? { value: issue.days, unit: m.data_ranking_unit_days() }
    : { value: issue.reportCount, unit: m.data_unit_reports() }
}

function placeOf(issue: RankedIssue): string {
  return issue.districtName
    ? `${issue.districtName}, ${issue.regencyName}`
    : issue.regencyName
}

const TAB =
  "block flex-1 whitespace-nowrap rounded-full px-4 py-2 text-center font-semibold transition-colors duration-(--dur-hover) motion-reduce:transition-none"

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"

// Pill tabs, ruled table
export function RankedIssues({
  map,
  issues,
}: {
  map: MapView
  issues: RankedIssue[]
}) {
  const active = map.ranking
  const params = paramsOf(map)
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={m.data_ranking_label()}>
        <ul className="flex w-full gap-1 overflow-x-auto rounded-full bg-surface-raised p-1">
          {ISSUE_RANKINGS.map((id) => (
            <li key={id} className="flex flex-1">
              <SectionLink
                section="peringkat-isu"
                to={dataHref({ ...params, peringkat: id })}
                aria-current={id === active ? "true" : undefined}
                className={cn(
                  TAB,
                  id === active
                    ? "bg-brand text-on-accent"
                    : "text-ink hover:bg-brand-soft",
                )}
              >
                {TAB_TEXT[id]()}
              </SectionLink>
            </li>
          ))}
        </ul>
      </nav>
      <p className="text-ink-soft">{NOTE_TEXT[active]()}</p>
      {issues.length === 0 ? (
        <p className="text-ink-soft">{m.data_ranking_empty()}</p>
      ) : (
        <Table caption={TAB_TEXT[active]()} captionHidden>
          <thead>
            <tr>
              <Th numeric>{m.data_ranking_col_number()}</Th>
              <Th>{m.data_ranking_col_issue()}</Th>
              <Th wide>{m.data_ranking_col_category()}</Th>
              <Th>{m.data_ranking_col_stage()}</Th>
              <Th numeric>
                {active === "terlama"
                  ? m.data_ranking_col_days()
                  : m.data_ranking_col_reports()}
              </Th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, index) => (
              <tr key={issue.code}>
                <Td numeric className="text-ink-muted">
                  {index + 1}
                </Td>
                <Td>
                  <Link to={`/isu/${issue.code}`} className={LINK}>
                    {issue.title}
                  </Link>
                  <span className="mt-1 block text-ink-muted text-sm">
                    {placeOf(issue)}
                  </span>
                </Td>
                <Td wide className="text-sm">
                  {isCategoryId(issue.categoryId)
                    ? CATEGORY_SHORT_TEXT[issue.categoryId]()
                    : null}
                </Td>
                <Td className="whitespace-nowrap">
                  <StageMark
                    advocacy={issue.advocacyStatus}
                    government={issue.govStatus}
                  />
                </Td>
                <Td numeric>
                  {formatNumber(
                    active === "terlama" ? issue.days : issue.reportCount,
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {active === "laporan" && issues.length > 0 && (
        <p>
          <Link to="/isu?urut=laporan" className={LINK}>
            {m.data_ranking_all()}
          </Link>
        </p>
      )}
    </div>
  )
}
