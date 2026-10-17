import { PageHeader } from "~/components/layout/page-header"
import { SectionHeading } from "~/components/layout/section-heading"
import { ButtonLink } from "~/components/ui/button"
import { Container } from "~/components/ui/container"
import { Note } from "~/components/ui/note"
import { AboutData } from "~/features/data/about-data"
import { CategoryBreakdown, StatusFlow } from "~/features/data/breakdowns"
import { readDashboard } from "~/features/data/dashboard.server"
import { RankedIssues } from "~/features/data/issue-ranking"
import { MapExplorer } from "~/features/data/region-map"
import { AgencyResponse, ReasonTable } from "~/features/data/responses"
import {
  KeyNumbers,
  ModerationCard,
  ResolutionTile,
} from "~/features/data/summary"
import { TrendChart } from "~/features/data/trend-chart"
import { DemandDigest } from "~/features/demands/demand-digest"
import { demandOverview } from "~/features/demands/demands.server"
import { listIssueRanking } from "~/features/issues/issues.server"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { DATA_QUERY, readQuery } from "../../shared/canonical-query.ts"
import { LOW_DATA_REPORTS, REFRESH_MINUTES } from "../../shared/dashboard.ts"
import {
  formatDate,
  formatDateTime,
  formatNumber,
} from "../../shared/format.ts"
import { tenantContext } from "../context.ts"
import type { Route } from "./+types/data"

// Filters keep the activated control
export const handle = { keepFocusOnQuery: true }

// Snapshot, live ranking, cached
export async function loader({ request, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const query = readQuery(new URL(request.url).searchParams, DATA_QUERY)
  // Live: hides apply at once
  const demands = await demandOverview(tenant.id)
  const dashboard = await readDashboard(tenant.id, query, demands)
  return {
    dashboard,
    demands: { counts: demands.counts, latest: demands.latest },
    // Live, so redactions never linger
    ranking:
      dashboard.kind === "ready"
        ? await listIssueRanking(tenant.id, dashboard.map.ranking, new Date())
        : [],
    facts: {
      operator: tenant.name,
      campus: tenant.campusName,
      url: `${tenant.host}/data`,
    },
  }
}

function NextStep() {
  return (
    <p className="pb-20 text-center">
      <ButtonLink to="/isu" size="lg">
        {m.nav_issues()}
      </ButtonLink>
    </p>
  )
}

export default function DataPage({ loaderData }: Route.ComponentProps) {
  const { dashboard, demands, ranking, facts } = loaderData
  const title = useSiteTitle(m.nav_data())
  if (dashboard.kind === "empty") {
    return (
      <>
        <title>{title}</title>
        <PageHeader title={m.nav_data()} description={m.data_lead()} />
        <Container width="3xl" className="pt-6 pb-10 text-center">
          <h2 className="font-bold text-2xl">{m.data_empty_title()}</h2>
          <p className="mt-3 text-ink-soft text-lg">
            {m.data_empty_body({ minutes: REFRESH_MINUTES })}
          </p>
        </Container>
        <NextStep />
      </>
    )
  }
  const { summary, map } = dashboard
  const total = summary.reports.total
  return (
    <>
      <title>{title}</title>
      {/* Freshness lives in AboutData */}
      <PageHeader title={m.nav_data()} description={m.data_lead()} />
      {(dashboard.stale || total < LOW_DATA_REPORTS) && (
        <Container className="pt-6 pb-10">
          <div className="flex flex-col gap-3">
            {dashboard.stale && (
              <Note>
                {m.data_stale({
                  time: formatDateTime(new Date(dashboard.computedAt)),
                })}
              </Note>
            )}
            {total < LOW_DATA_REPORTS && (
              <Note tone="info">
                {summary.firstReportAt
                  ? m.data_low({
                      n: formatNumber(total),
                      date: formatDate(new Date(summary.firstReportAt)),
                    })
                  : m.data_low_none()}
              </Note>
            )}
          </div>
        </Container>
      )}
      {/* Counts first, then quality */}
      <KeyNumbers summary={summary} demands={demands.counts} />
      <Container className="py-12 sm:py-16">
        <h2 className="sr-only">{m.data_summary_title()}</h2>
        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ResolutionTile summary={summary} />
          <ModerationCard summary={summary} />
        </div>
        {/* Moderation outcome, not agency */}
        <div className="mt-6">
          <ReasonTable reasons={summary.reasons} />
        </div>
      </Container>
      <section aria-labelledby="tanggapan-instansi" className="bg-page">
        <Container className="py-16 sm:py-20">
          <SectionHeading
            id="tanggapan-instansi"
            title={m.data_response_title()}
            description={m.data_response_lead()}
            className="mb-10"
          />
          <AgencyResponse response={summary.response} />
        </Container>
      </section>
      {demands.latest.length > 0 && (
        <section aria-labelledby="tuntutan-publik">
          <Container className="py-16 sm:py-20">
            <SectionHeading
              id="tuntutan-publik"
              title={m.data_demands_title()}
              description={m.data_demands_lead()}
              action={
                <ButtonLink to="/tuntutan" variant="secondary">
                  {m.data_demands_all()}
                </ButtonLink>
              }
              className="mb-8"
            />
            <div className="mx-auto max-w-6xl">
              <DemandDigest demands={demands.latest} />
            </div>
          </Container>
        </section>
      )}
      <section
        aria-labelledby="peta-isu"
        className="bg-ink py-16 text-surface-raised sm:py-20"
      >
        <Container>
          <SectionHeading
            id="peta-isu"
            title={m.data_map_title()}
            description={m.data_map_lead()}
            inverse
            className="mb-10"
          />
          <MapExplorer map={map} />
        </Container>
      </section>
      <div className="bg-page">
        <section aria-labelledby="grafik">
          <Container className="py-16 sm:py-20">
            <SectionHeading
              id="grafik"
              title={m.data_charts_title()}
              description={m.data_charts_lead()}
              className="mb-10"
            />
            {/* Mockup row heights, status below */}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <TrendChart trend={summary.trend} total={summary.trendTotal} />
              <CategoryBreakdown summary={summary} />
            </div>
            <StatusFlow summary={summary} className="mt-6" />
          </Container>
        </section>
        <section aria-labelledby="peringkat-isu">
          <Container className="pb-16 sm:pb-20">
            <SectionHeading
              id="peringkat-isu"
              title={m.data_ranking_title()}
              description={m.data_ranking_lead()}
              className="mb-10"
            />
            <RankedIssues map={map} issues={ranking} />
          </Container>
        </section>
        <AboutData
          facts={facts}
          computedAt={dashboard.computedAt}
          nextAt={dashboard.nextAt}
          firstReportAt={summary.firstReportAt}
        />
        <NextStep />
      </div>
    </>
  )
}
