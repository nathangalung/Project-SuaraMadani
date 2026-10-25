import { SearchX } from "lucide-react"
import { data, Link, redirect } from "react-router"
import { PageHeader } from "~/components/layout/page-header"
import { SECTION_TITLE } from "~/components/layout/section-heading"
import { ButtonLink } from "~/components/ui/button"
import { Container } from "~/components/ui/container"
import { Note } from "~/components/ui/note"
import { Pagination } from "~/components/ui/pagination"
import { ExploreTabs } from "~/features/demands/explore-tabs"
import { IssueCard } from "~/features/issues/issue-card"
import { IssueFilters, issuesHref } from "~/features/issues/issue-filters"
import {
  listPublishedIssues,
  regionName,
} from "~/features/issues/issues.server"
import { useSiteTitle } from "~/features/report/page-title"
import { regionChoices } from "~/features/report/regions.server"
import { m } from "~/paraglide/messages.js"
import { ISSUE_LIST_QUERY, readQuery } from "../../../shared/canonical-query.ts"
import { tenantContext } from "../../context.ts"
import type { Route } from "./+types/list"

// Hono sets cache headers
export async function loader({ request, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const url = new URL(request.url)
  const query = readQuery(url.searchParams, ISSUE_LIST_QUERY)
  const [result, region, regions] = await Promise.all([
    listPublishedIssues(tenant.id, query),
    query.wilayah ? regionName(query.wilayah) : null,
    regionChoices(query.wilayah),
  ])
  // Unknown region filters nothing visible
  if (query.wilayah && !region) {
    const { wilayah: _drop, ...rest } = query
    throw redirect(issuesHref(rest), 301)
  }
  if (result.kind === "busy") {
    throw data(null, { status: 503, headers: { "Retry-After": "5" } })
  }
  // Data-dependent, so 302
  if (result.kind === "results" && result.page > result.pageCount) {
    throw redirect(issuesHref({ ...query, halaman: String(result.pageCount) }))
  }
  return { query, result, region, regions }
}

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"

// Filtered and empty differ
function EmptyResults({ filtered }: { filtered: boolean }) {
  return (
    <div className="mt-5 flex flex-col items-center border border-line-subtle bg-surface-raised px-6 py-16 text-center">
      <SearchX aria-hidden="true" className="size-10 text-brand" />
      <p className="mt-4 font-semibold text-lg">
        {filtered ? m.issues_empty() : m.issues_none()}
      </p>
      <p className="mt-1 max-w-md text-ink-muted">
        {filtered ? m.issues_empty_hint() : m.issues_none_hint()}
      </p>
      <p className="mt-6 flex flex-wrap justify-center gap-3">
        {filtered ? (
          <ButtonLink to="/isu" variant="secondary">
            {m.issues_clear_filters()}
          </ButtonLink>
        ) : null}
        <ButtonLink to="/lapor">{m.report_start()}</ButtonLink>
      </p>
    </div>
  )
}

export default function IssueList({ loaderData }: Route.ComponentProps) {
  const { query, result, region } = loaderData
  const filtered = Boolean(
    query.kategori || query.status || query.q || query.wilayah,
  )
  return (
    <>
      <title>{useSiteTitle(m.issues_title())}</title>
      <PageHeader title={m.issues_title()} description={m.issues_lead()}>
        <ExploreTabs current="isu" />
      </PageHeader>
      <div className="mt-6 bg-page sm:mt-10">
        <Container className="pt-8 pb-24 sm:pt-12">
          <IssueFilters
            query={query}
            regionName={region ?? undefined}
            regions={loaderData.regions}
          />
          <section aria-labelledby="issues-results" className="mt-12">
            {result.kind === "results" ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="issues-results" className={SECTION_TITLE}>
                    {result.page > 1
                      ? m.issues_results_page({ page: result.page })
                      : m.issues_results_title()}
                  </h2>
                  {filtered && result.issues.length > 0 ? (
                    <Link to="/isu" className={LINK}>
                      {m.issues_clear_filters()}
                    </Link>
                  ) : null}
                </div>
                {result.issues.length === 0 ? (
                  <EmptyResults filtered={filtered} />
                ) : (
                  <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {result.issues.map((issue) => (
                      <li key={issue.code}>
                        <IssueCard issue={issue} />
                      </li>
                    ))}
                  </ul>
                )}
                <Pagination
                  page={result.page}
                  pageCount={result.pageCount}
                  href={(page) =>
                    issuesHref({ ...query, halaman: String(page) })
                  }
                  className="mt-10"
                />
                {result.issues.length > 0 ? (
                  <p className="mt-16 text-ink-soft">
                    {m.issues_closing()}{" "}
                    <Link to="/lapor" className={LINK}>
                      {m.report_start()}
                    </Link>
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <h2 id="issues-results" className="sr-only">
                  {m.issues_results_title()}
                </h2>
                <Note>{m.issues_short_query()}</Note>
              </>
            )}
          </section>
        </Container>
      </div>
    </>
  )
}
