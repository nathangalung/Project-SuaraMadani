import { Link } from "react-router"
import { m } from "~/paraglide/messages.js"
import { cn } from "./cn"

// Secondary button, rounded full
const PAGE_LINK =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border-2 border-ink bg-surface-raised px-5 font-semibold text-ink no-underline transition-[background-color,color] hover:bg-ink hover:text-surface-raised motion-reduce:transition-none"

/** Previous, position, next. Plain links. */
export function Pagination({
  page,
  pageCount,
  href,
  className,
}: {
  page: number
  pageCount: number
  href: (page: number) => string
  className?: string
}) {
  if (pageCount <= 1) return null
  return (
    <nav
      aria-label={m.issues_pagination_label()}
      className={cn(
        "grid grid-cols-2 items-center gap-4 sm:grid-cols-[1fr_auto_1fr]",
        className,
      )}
    >
      {page > 1 ? (
        <Link
          to={href(page - 1)}
          rel="prev"
          className={cn(
            PAGE_LINK,
            "col-start-1 row-start-2 justify-self-start sm:row-start-1",
          )}
        >
          {m.issues_prev()}
        </Link>
      ) : null}
      <p className="col-span-2 row-start-1 text-center text-ink-soft sm:col-span-1 sm:col-start-2">
        {m.issues_page_of({ page, pages: pageCount })}
      </p>
      {page < pageCount ? (
        <Link
          to={href(page + 1)}
          rel="next"
          className={cn(
            PAGE_LINK,
            "col-start-2 row-start-2 justify-self-end sm:col-start-3 sm:row-start-1",
          )}
        >
          {m.issues_next()}
        </Link>
      ) : null}
    </nav>
  )
}
