import { SearchX } from "lucide-react"
import type { CSSProperties } from "react"
import { Link } from "react-router"
import { BoxedHeading } from "~/components/layout/boxed-heading"
import { useStagger } from "~/components/layout/use-reveal"
import { cn } from "~/components/ui/cn"
import type { ShowcaseIssue } from "~/features/issues/issues.server"
import { GOVERNMENT_TEXT } from "~/features/issues/labels"
import { m } from "~/paraglide/messages.js"
import type { GovernmentStatus } from "../../../shared/status.ts"

// Neighbouring cards never share colour
const CARD_BG = [
  "bg-ink",
  "bg-brand",
  "bg-pop-strong",
  "bg-brand",
  "bg-pop-strong",
  "bg-ink",
]

// Done reads green, rest plain
function chipOf(status: GovernmentStatus): string {
  return status === "confirmed_resolved"
    ? "bg-success-soft text-success-ink"
    : "bg-surface text-ink"
}

type ShowcaseProps = {
  id: string
  title: string
  rule: string
  issues: ShowcaseIssue[]
  empty: string
  emptyBody: string
  seeAll: { to: string; label: string }
}

function placeOf(issue: ShowcaseIssue): string {
  return issue.districtName
    ? `${issue.districtName}, ${issue.regencyName}`
    : issue.regencyName
}

function ShowcaseCard({
  issue,
  index,
}: {
  issue: ShowcaseIssue
  index: number
}) {
  return (
    <li
      style={{ "--i": index } as CSSProperties}
      className={cn(
        "group relative flex min-h-52 w-full flex-col rounded-lg p-5 sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)] text-on-accent has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-focus has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-solid",
        CARD_BG[index % CARD_BG.length],
      )}
    >
      <p
        className={cn(
          "self-start rounded px-2 py-0.5 font-bold font-ui text-sm",
          chipOf(issue.govStatus),
        )}
      >
        {GOVERNMENT_TEXT[issue.govStatus]()}
      </p>
      <h3 className="mt-3 font-bold text-lg leading-snug">
        <Link
          to={`/isu/${issue.code}`}
          className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          {issue.title}
        </Link>
      </h3>
      <p className="mt-1 mb-4 font-ui text-sm">
        {`${placeOf(issue)} · ${m.issue_reports({ count: issue.reportCount })}`}
      </p>
      <span
        aria-hidden="true"
        className="mt-auto self-start rounded-md border-2 border-current px-3.5 py-1 font-semibold font-ui text-sm transition-colors group-hover:bg-surface-raised group-hover:text-ink"
      >
        {m.home_card_view()}
      </span>
    </li>
  )
}

// Mockup IsuTerbaru
export function IssueShowcase({
  id,
  title,
  rule,
  issues,
  empty,
  emptyBody,
  seeAll,
}: ShowcaseProps) {
  const list = useStagger<HTMLUListElement>()
  return (
    <section aria-labelledby={id} className="px-6 py-14 sm:px-10 lg:py-20">
      <BoxedHeading id={id} tone="brand">
        {title}
      </BoxedHeading>
      <p className="mx-auto mt-4 max-w-2xl text-center text-ink text-lg leading-relaxed">
        {rule}
      </p>
      {issues.length > 0 ? (
        <>
          {/* Partial rows centre under heading */}
          <ul
            ref={list}
            className="mx-auto mt-12 flex max-w-6xl flex-wrap justify-center gap-4"
          >
            {issues.map((issue, index) => (
              <ShowcaseCard key={issue.code} issue={issue} index={index} />
            ))}
          </ul>
          <p className="mt-10 text-center">
            <Link
              to={seeAll.to}
              className="font-semibold text-accent underline underline-offset-4 hover:no-underline"
            >
              {seeAll.label}
            </Link>
          </p>
        </>
      ) : (
        <div className="mx-auto mt-12 flex max-w-6xl flex-col items-center border border-line-subtle bg-surface-raised px-6 py-16 text-center">
          <SearchX aria-hidden="true" className="size-10 text-brand" />
          <p className="mt-4 font-semibold text-lg">{empty}</p>
          <p className="mt-1 max-w-md text-ink-muted">{emptyBody}</p>
        </div>
      )}
    </section>
  )
}
