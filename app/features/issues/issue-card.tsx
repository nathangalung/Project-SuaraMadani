import { FileText, MapPin } from "lucide-react"
import { Link } from "react-router"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import { labelOf, SUBCATEGORY_TEXT } from "../report/public-labels"
import { CategoryMark, StageMark } from "./issue-status"
import type { ListedIssue } from "./issues.server"

type Place = { regencyName: string; districtName: string | null }

export function placeOf(issue: Place): string {
  return issue.districtName
    ? `${issue.districtName}, ${issue.regencyName}`
    : issue.regencyName
}

/** Category, place, date, count. */
export function issueMeta(
  issue: Place & {
    subcategoryId: string
    publishedAt: Date
    reportCount: number
  },
): string {
  return [
    labelOf(SUBCATEGORY_TEXT, issue.subcategoryId),
    placeOf(issue),
    m.issue_opened({ date: formatDate(issue.publishedAt) }),
    m.issue_reports({ count: issue.reportCount }),
  ]
    .filter(Boolean)
    .join(" · ")
}

// Rounded card, pill statuses
export function IssueCard({ issue }: { issue: ListedIssue }) {
  const subcategory = labelOf(SUBCATEGORY_TEXT, issue.subcategoryId)
  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-line-subtle bg-surface-raised p-6 transition-[border-color,translate] duration-(--dur-hover) hover:-translate-y-0.5 hover:border-ink/40 has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-focus has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-solid motion-reduce:hover:translate-y-0">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center rounded-full bg-surface px-3 py-1">
          <CategoryMark categoryId={issue.categoryId} />
        </span>
        <span className="font-ui text-ink-muted text-xs tabular-nums">
          {issue.code}
        </span>
      </div>
      {subcategory ? (
        <p className="mt-5 font-ui text-ink-muted text-sm">{subcategory}</p>
      ) : null}
      <h3 className="mt-1 font-bold text-ink text-xl leading-snug">
        <Link
          to={`/isu/${issue.code}`}
          className="decoration-2 decoration-brand underline-offset-4 after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none group-hover:underline"
        >
          {issue.title}
        </Link>
      </h3>
      <p className="mt-2 line-clamp-3 text-ink-soft leading-relaxed">
        {issue.excerpt}
      </p>
      <div className="mt-auto pt-6">
        <span className="sr-only">{m.issue_stage_label()}: </span>
        <StageMark
          advocacy={issue.advocacyStatus}
          government={issue.govStatus}
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 font-ui text-ink-soft text-sm">
        <span className="flex min-w-0 items-center gap-1.5">
          <MapPin aria-hidden="true" className="size-4 shrink-0 text-brand" />
          <span className="truncate">{placeOf(issue)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <FileText aria-hidden="true" className="size-4 text-brand" />
          {m.issue_reports({ count: issue.reportCount })}
        </span>
      </div>
      <p className="mt-1 font-ui text-ink-muted text-xs">
        {m.issue_last_activity({ date: formatDate(issue.lastActivityAt) })}
      </p>
    </article>
  )
}
