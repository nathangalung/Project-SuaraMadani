import { ChevronLeft, FileText } from "lucide-react"
import { lazy, Suspense } from "react"
import { data, isRouteErrorResponse, Link, redirect } from "react-router"
import { SECTION_TITLE } from "~/components/layout/section-heading"
import { ButtonLink } from "~/components/ui/button"
import { Container } from "~/components/ui/container"
import { Fact } from "~/components/ui/fact"
import { CATEGORY_TEXT } from "~/features/demands/category-labels"
import { demandHistory } from "~/features/demands/demand-history"
import { demandUrls, getDemandPage } from "~/features/demands/demands.server"
import {
  followDemand,
  isFollowingDemand,
  unfollowDemand,
} from "~/features/demands/follow.server"
import { ItemUpdates } from "~/features/demands/item-updates"
import { demandPlace, STATE_TEXT } from "~/features/demands/labels"
import { RankLine } from "~/features/demands/rank-line"
import { FulfilmentMark } from "~/features/demands/status-mark"
import { FollowCard, signInToFollow } from "~/features/issues/follow-card"
import { Timeline } from "~/features/issues/timeline"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { normalizeDemandCode } from "../../../shared/demands.ts"
import { formatFileSize, formatIsoDate } from "../../../shared/format.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/detail"

// Root skips the site description
export const handle = { ownDescription: true }

export async function loader({ params, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const code = normalizeDemandCode(params.code)
  if (!code) throw data(null, { status: 404 })
  if (code !== params.code) throw redirect(`/tuntutan/${code}`, 301)
  // Drafts and other tenants: 404
  const demand = await getDemandPage(tenant.id, code)
  if (!demand) throw data(null, { status: 404 })
  // Sessions bypass the CDN
  const session = context.get(sessionContext)
  return {
    demand,
    follow: session
      ? {
          following: await isFollowingDemand(tenant.id, code, session.user.id),
          emailReady: session.user.emailVerified,
        }
      : null,
    organization: tenant.name,
    siteName: m.og_site_name({ name: tenant.name }),
    ...demandUrls(tenant.host, code, demand.version),
  }
}

// Follow or unfollow, then PRG
export async function action({ request, params, context }: Route.ActionArgs) {
  const tenant = context.get(tenantContext)
  const code = normalizeDemandCode(params.code)
  if (!code) throw data(null, { status: 404 })
  const session = context.get(sessionContext)
  if (!session) throw redirect(signInToFollow(code, "demand"), 303)
  const intent = (await request.formData()).get("intent")
  if (intent === "follow") {
    if (!(await followDemand(tenant.id, code, session.user.id))) {
      throw data(null, { status: 404 })
    }
  } else if (intent === "unfollow") {
    await unfollowDemand(tenant.id, code, session.user.id)
  } else {
    throw data(null, { status: 400 })
  }
  throw redirect(`/tuntutan/${code}#ikuti`, 303)
}

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"
// Space only, no rules
const H2 = SECTION_TITLE

// External brief, new tab
function BriefLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {m.demand_brief_link()}{" "}
      <span className="whitespace-nowrap">{m.link_new_tab()}</span>
    </a>
  )
}

// PLAN §6.1 order, no JS
export default function DemandDetail({ loaderData }: Route.ComponentProps) {
  const { demand, siteName, url, image, follow, organization } = loaderData
  const actor = m.demand_actor({ organization })
  const description = demand.summary.slice(0, 200)
  // Reopened: old reason is history
  const closing =
    demand.state === "closed"
      ? demand.events.findLast((event) => event.action === "close")
      : undefined
  return (
    <>
      <title>{`${demand.title} - ${siteName}`}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content={siteName} />
      <meta property="og:title" content={demand.title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />

      {/* Article head, no band */}
      <section aria-labelledby="demand-title" className="relative isolate">
        <div
          aria-hidden="true"
          className="header-bg absolute inset-0 -z-10 [mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_100%)]"
        />
        <Container className="pt-8 pb-10 sm:pt-10">
          <Link
            to="/tuntutan"
            className="inline-flex items-center gap-1 font-semibold text-ink text-sm underline-offset-4 hover:underline"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {m.explore_tab_demands()}
          </Link>
          <p className="mt-8 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[0.95rem] text-ink-soft">
            <span className="font-bold text-ink">{demandPlace(demand)}</span>
            {demand.category ? (
              <span>{CATEGORY_TEXT[demand.category]()}</span>
            ) : null}
            <span className="tabular-nums">{demand.code}</span>
            {demand.state === "closed" ? (
              <span className="font-semibold text-ink">
                {STATE_TEXT.closed()}
              </span>
            ) : null}
          </p>
          <h1
            id="demand-title"
            className="mt-3 font-bold font-heading text-[clamp(2rem,4.4vw,3rem)] text-ink leading-[1.1] [font-synthesis-weight:none]"
          >
            {demand.title}
          </h1>
          <h2 className="sr-only">{m.demand_facts_title()}</h2>
          <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
            <Fact term={m.demands_col_fulfilment()}>
              <FulfilmentMark status={demand.progress.status} />
            </Fact>
            <Fact term={m.demand_fact_raised()}>
              <span>{formatIsoDate(demand.raisedOn)}</span>
            </Fact>
            <div className="col-span-2 flex flex-col gap-1">
              <dt className="text-ink-muted text-sm">
                {m.demand_fact_target()}
              </dt>
              <dd>{demand.target}</dd>
            </div>
          </dl>
          <RankLine rank={demand.rank} className="mt-6" />
          <p className="mt-8 whitespace-pre-line text-ink text-lg leading-relaxed">
            {demand.summary}
          </p>
          {demand.briefUrl ? (
            <p className="mt-4">
              <BriefLink href={demand.briefUrl} />
            </p>
          ) : null}
          {closing ? (
            <p className="mt-4 font-ui text-ink-soft">
              {m.demand_closed_line({
                date: formatIsoDate(closing.occurredOn),
              })}{" "}
              {closing.note}
            </p>
          ) : null}
        </Container>
      </section>

      <div className="bg-page">
        <Container className="grid gap-12 py-12 pb-24 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0 space-y-16">
            <section id="sub-tuntutan" aria-labelledby="sub-title">
              <h2 id="sub-title" className={H2}>
                {m.demand_items_title()}
              </h2>
              <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
                {m.demand_items_intro()}
              </p>
              <ol className="mt-6 flex flex-col gap-8">
                {demand.items.map((item) => (
                  <li
                    key={item.id}
                    id={`sub-${item.number}`}
                    className="scroll-mt-24"
                  >
                    <h3 className="font-bold text-lg leading-snug">
                      {/* The list already numbers */}
                      <span
                        aria-hidden="true"
                        className="mr-2 font-ui text-accent tabular-nums"
                      >
                        {String(item.number).padStart(2, "0")}
                      </span>
                      {item.body}
                    </h3>
                    <p className="mt-3">
                      <FulfilmentMark status={item.fulfilment} />
                    </p>
                    {item.briefSummary || item.brief || item.briefUrl ? (
                      <>
                        <h4 className="mt-5 font-bold">
                          {m.demand_brief_title()}
                        </h4>
                        {item.briefSummary ? (
                          <p className="mt-1 whitespace-pre-line text-ink-soft leading-relaxed">
                            {item.briefSummary}
                          </p>
                        ) : null}
                        {item.brief ? (
                          <a
                            href={item.brief.url}
                            className="mt-2 inline-flex items-center gap-1.5 font-semibold text-accent hover:underline"
                          >
                            <FileText aria-hidden="true" className="size-4" />
                            {m.demand_brief_download({
                              size: formatFileSize(item.brief.byteSize),
                            })}
                          </a>
                        ) : null}
                        {item.briefUrl ? (
                          <p className="mt-2">
                            <BriefLink href={item.briefUrl} />
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    <h4 className="mt-5 font-bold">
                      {m.demand_updates_title()}
                    </h4>
                    <ItemUpdates
                      updates={demand.events
                        .filter((event) => event.item === item.number)
                        .toReversed()}
                      actor={actor}
                      withStatus
                    />
                  </li>
                ))}
              </ol>
            </section>

            <section id="riwayat" aria-labelledby="riwayat-title">
              <h2 id="riwayat-title" className={H2}>
                {m.issue_history_title()}
              </h2>
              <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
                {m.demand_history_intro()}
              </p>
              <Timeline
                className="mt-6 ml-1.5"
                entries={demandHistory(demand.events, actor)}
              />
            </section>
          </div>
          <aside className="space-y-10">
            <FollowCard code={demand.code} state={follow} kind="demand" />
          </aside>
        </Container>
      </div>
    </>
  )
}

// Error markup not first-load
const ErrorPage = lazy(() =>
  import("~/components/layout/error-page").then((module) => ({
    default: module.ErrorPage,
  })),
)

// Other statuses reach root
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const documentTitle = useSiteTitle(m.demand_not_found_title())
  if (!isRouteErrorResponse(error) || error.status !== 404) throw error
  return (
    <Suspense>
      <ErrorPage
        code={404}
        title={m.demand_not_found_title()}
        documentTitle={documentTitle}
        body={m.demand_not_found_body()}
        actions={
          <ButtonLink to="/tuntutan">{m.explore_tab_demands()}</ButtonLink>
        }
      />
    </Suspense>
  )
}
