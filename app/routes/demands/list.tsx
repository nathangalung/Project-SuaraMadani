import { Scale } from "lucide-react"
import { Link, redirect } from "react-router"
import { PageHeader } from "~/components/layout/page-header"
import { ButtonLink } from "~/components/ui/button"
import { Container } from "~/components/ui/container"
import { Note } from "~/components/ui/note"
import { DemandFilters } from "~/features/demands/demand-filters"
import { demandsHref } from "~/features/demands/demand-href"
import { DemandLedger } from "~/features/demands/demand-ledger"
import { DemandScorecard } from "~/features/demands/demand-scorecard"
import {
  demandProvinces,
  demandScorecard,
  listPublishedDemands,
} from "~/features/demands/demands.server"
import { ExploreTabs } from "~/features/demands/explore-tabs"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import {
  DEMAND_LIST_QUERY,
  readQuery,
} from "../../../shared/canonical-query.ts"
import { DEMAND_PAGE_SIZE } from "../../../shared/demands.ts"
import { tenantContext } from "../../context.ts"
import type { Route } from "./+types/list"

// Hono sets cache headers
export async function loader({ request, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const query = readQuery(new URL(request.url).searchParams, DEMAND_LIST_QUERY)
  const [result, scorecard, provinces] = await Promise.all([
    listPublishedDemands(tenant.id, query),
    demandScorecard(tenant.id),
    demandProvinces(tenant.id, query.provinsi),
  ])
  if (result.kind === "bad_cursor") {
    const { kursor: _drop, ...rest } = query
    throw redirect(demandsHref(rest), 301)
  }
  return { query, result, scorecard, provinces, organization: tenant.name }
}

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"

export default function DemandList({ loaderData }: Route.ComponentProps) {
  const { query, result, scorecard, provinces } = loaderData
  const filtered = Boolean(
    query.lingkup ||
      query.provinsi ||
      query.kategori ||
      query.status ||
      query.q,
  )
  const province = provinces.find((p) => p.code === query.provinsi)?.name
  return (
    <>
      <title>{useSiteTitle(m.demands_title())}</title>
      <PageHeader
        title={m.demands_title()}
        description={m.demands_lead({ organization: loaderData.organization })}
      >
        <ExploreTabs current="tuntutan" />
      </PageHeader>
      <div className="mt-6 bg-page sm:mt-10">
        <Container className="space-y-10 pt-8 pb-24 sm:pt-12">
          {/* Nothing to count or filter */}
          {scorecard.total > 0 || filtered ? (
            <>
              <DemandScorecard scorecard={scorecard} query={query} />
              <DemandFilters query={query} provinces={provinces} />
            </>
          ) : null}
          <section aria-labelledby="demands-results">
            {result.kind === "results" ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="demands-results" className="font-bold text-lg">
                    {result.page > 1
                      ? m.demands_results_page({ page: result.page })
                      : m.demands_results_title()}
                  </h2>
                  {filtered && result.demands.length > 0 ? (
                    <Link to="/tuntutan" className={LINK}>
                      {m.issues_clear_filters()}
                    </Link>
                  ) : null}
                </div>
                {result.demands.length === 0 ? (
                  <div className="mt-5 flex flex-col items-center border border-line-subtle bg-surface-raised px-6 py-16 text-center">
                    <Scale aria-hidden="true" className="size-10 text-brand" />
                    <p className="mt-4 font-semibold text-lg">
                      {!filtered
                        ? m.demands_none()
                        : province
                          ? m.demands_empty_province({ province })
                          : m.demands_empty()}
                    </p>
                    {filtered ? null : (
                      <p className="mt-1 max-w-md text-ink-muted">
                        {m.demands_none_hint()}
                      </p>
                    )}
                    <p className="mt-6">
                      {filtered ? (
                        <ButtonLink to="/tuntutan" variant="secondary">
                          {m.issues_clear_filters()}
                        </ButtonLink>
                      ) : (
                        <ButtonLink to="/lapor" variant="secondary">
                          {m.report_start()}
                        </ButtonLink>
                      )}
                    </p>
                  </div>
                ) : (
                  <DemandLedger
                    demands={result.demands}
                    start={(result.page - 1) * DEMAND_PAGE_SIZE}
                  />
                )}
                {result.capped ? (
                  <Note className="mt-8">{m.demands_page_cap()}</Note>
                ) : null}
                {result.page > 1 || result.nextCursor ? (
                  <nav
                    aria-label={m.issues_pagination_label()}
                    className="mt-10 flex flex-wrap gap-6"
                  >
                    {result.page > 1 ? (
                      <Link
                        to={demandsHref({ ...query, kursor: undefined })}
                        className={LINK}
                      >
                        {m.issues_first()}
                      </Link>
                    ) : null}
                    {result.nextCursor ? (
                      <Link
                        to={demandsHref({
                          ...query,
                          kursor: result.nextCursor,
                        })}
                        className={LINK}
                      >
                        {m.issues_next()}
                      </Link>
                    ) : null}
                  </nav>
                ) : null}
                {result.demands.length > 0 ? (
                  // Ledger already ends ruled
                  <p className="mt-10 text-ink-soft">
                    {m.demands_closing()}{" "}
                    <Link to="/lapor" className={LINK}>
                      {m.report_start()}
                    </Link>
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <h2 id="demands-results" className="sr-only">
                  {m.demands_results_title()}
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
