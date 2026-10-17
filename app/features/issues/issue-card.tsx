import { FileText, MapPin } from "lucide-react"
import { Link } from "react-router"
import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import { labelOf, SUBCATEGORY_TEXT } from "../report/public-labels"
import {
  CategoryBadge,
  GovernmentBadge,
  VerificationBadge,
} from "./issue-status"
import type { ListedIssue } from "./issues.server"

type Place = { regencyName: string; districtName: string | null }

function placeOf(issue: Place): string {
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

// Title link covers the card
export function IssueCard({
  issue,
  className,
}: {
  issue: ListedIssue
  className?: string
}) {
  return (
    <article
      className={cn(
        "group relative flex flex-col border border-line-subtle bg-surface-raised transition-colors hover:border-ink has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-focus has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-solid",
        className,
      )}
    >
      <div className="border-ink/8 border-b px-5 pt-5 pb-4">
        <ul className="flex flex-wrap gap-1.5">
          <li>
            <CategoryBadge categoryId={issue.categoryId} />
          </li>
          <li>
            <VerificationBadge label={issue.verificationLabel} />
          </li>
          <li>
            <GovernmentBadge status={issue.govStatus} />
          </li>
        </ul>
        <p className="mt-3 font-semibold font-ui text-ink-muted text-sm">
          {labelOf(SUBCATEGORY_TEXT, issue.subcategoryId)}
        </p>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-bold text-ink text-lg leading-snug">
          <Link
            to={`/isu/${issue.code}`}
            className="decoration-2 decoration-brand underline-offset-4 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-hover:underline"
          >
            {issue.title}
          </Link>
        </h3>
        <p className="mt-2 line-clamp-2 font-ui text-[0.95rem] text-ink-soft leading-relaxed">
          {issue.excerpt}
        </p>
        <p className="mt-3 flex items-center gap-1.5 font-ui text-[0.95rem] text-ink-soft">
          <MapPin aria-hidden="true" className="size-4 shrink-0 text-brand" />
          <span className="truncate">{placeOf(issue)}</span>
        </p>
        <div className="mt-auto pt-4">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-ink/10 border-t pt-3.5 font-ui text-[0.95rem] text-ink-soft">
            <span className="flex items-center gap-1.5">
              <FileText aria-hidden="true" className="size-4 text-brand" />
              {m.issue_reports({ count: issue.reportCount })}
            </span>
            <span className="ml-auto text-ink-muted text-xs">
              {m.issue_last_activity({
                date: formatDate(issue.lastActivityAt),
              })}
            </span>
          </p>
          <p className="mt-2 font-ui text-ink-muted text-xs tabular-nums">
            {issue.code}
          </p>
        </div>
      </div>
    </article>
  )
}
