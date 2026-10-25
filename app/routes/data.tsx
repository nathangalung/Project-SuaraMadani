import { PageHeader } from "~/components/layout/page-header"
import { SectionHeading } from "~/components/layout/section-heading"
import { ButtonLink } from "~/components/ui/button"
import { Container } from "~/components/ui/container"
import { Note } from "~/components/ui/note"
import { readDashboard } from "~/features/data/dashboard.server"
import { RankedIssues } from "~/features/data/issue-ranking"
import { KeyFigures } from "~/features/data/key-figures"
import { MapExplorer } from "~/features/data/region-map"
import { AgencyResponse } from "~/features/data/responses"
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
  const dashboard = await readDashboard(tenant.id, query)
  return {
    dashboard,
    demands: { counts: demands.counts },
    // Live, so redactions never linger
    ranking:
      dashboard.kind === "ready"
        ? await listIssueRanking(tenant.id, dashboard.map.ranking, new Date())
        : [],
  }
}

function NextStep() {
  return (
    <div className="flex justify-center pt-4 pb-10 lg:pt-8">
      <ButtonLink to="/isu" variant="highlight" size="lg">
        {m.nav_issues()}
      </ButtonLink>
    </div>
  )
}

export default function DataPage({ loaderData }: Route.ComponentProps) {
  const { dashboard, demands, ranking } = loaderData
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
      <Container className="pt-16 sm:pt-20">
        <KeyFigures reports={dashboard.stageReports} demands={demands.counts} />
      </Container>
      {/* Figures, then map */}
      <section aria-labelledby="peta-isu" className="py-16 sm:py-20">
        <Container>
          <SectionHeading
            id="peta-isu"
            title={m.data_map_title()}
            description={m.data_map_lead()}
            className="mb-10"
          />
          <MapExplorer map={map} />
        </Container>
      </section>
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
      <div className="bg-page">
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
        <NextStep />
      </div>
    </>
  )
}
