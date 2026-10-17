import { ChevronLeft, FileText, Flag, Info, MapPin } from "lucide-react"
import { lazy, Suspense } from "react"
import { data, isRouteErrorResponse, Link, redirect } from "react-router"
import { Badge } from "~/components/ui/badge"
import { ButtonLink } from "~/components/ui/button"
import { Container } from "~/components/ui/container"
import { demandHistory } from "~/features/demands/demand-history"
import { demandUrls, getDemandPage } from "~/features/demands/demands.server"
import {
  followDemand,
  isFollowingDemand,
  unfollowDemand,
} from "~/features/demands/follow.server"
import { ItemUpdates } from "~/features/demands/item-updates"
import { demandPlace, STATE_TEXT } from "~/features/demands/labels"
import {
  FulfilmentMark,
  ProgressSquares,
  ResponseMark,
} from "~/features/demands/status-mark"
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
const SECTION = "border-ink border-t-2 pt-6"
const H2 = "font-bold text-2xl"

const ANCHORS = [
  { id: "teks", label: m.demand_text_title },
  { id: "sub-tuntutan", label: m.demand_items_title },
  { id: "riwayat", label: m.issue_history_title },
  { id: "isu-terkait", label: m.demand_issues_title },
] as const

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
      <title>{`${demand.title} · ${siteName}`}</title>
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

      <section aria-labelledby="demand-title" className="bg-detail">
        <Container className="pt-8 pb-12 sm:pt-10">
          <Link
            to="/tuntutan"
            className="inline-flex items-center gap-1 font-semibold text-ink text-sm underline-offset-4 hover:underline"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {m.explore_tab_demands()}
          </Link>
          <p className="mt-5 flex flex-wrap gap-2">
            <Badge className="tabular-nums">{demand.code}</Badge>
            <Badge tone="subtle">{demandPlace(demand)}</Badge>
            {demand.state === "closed" ? (
              <Badge tone="ink">{STATE_TEXT.closed()}</Badge>
            ) : null}
          </p>
          <h1
            id="demand-title"
            className="mt-3 max-w-4xl font-bold text-[clamp(2rem,4.6vw,3.4rem)] text-ink leading-[1.08]"
          >
            {demand.title}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
            <FulfilmentMark status={demand.progress.status} />
            <ProgressSquares
              items={demand.items.map((item) => item.fulfilment)}
              label={m.demand_progress_line({
                done: demand.progress.fulfilled,
                total: demand.progress.total,
              })}
            />
            <span className="font-ui text-ink-soft text-sm">
              {m.demand_responded_count({
                done: demand.progress.responded,
                total: demand.progress.total,
              })}
            </span>
          </div>
          <p className="mt-5 flex items-start gap-1.5 text-ink-soft">
            <MapPin
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-brand"
            />
            {[
              m.demand_target({ target: demand.target }),
              m.demand_raised_on({ date: formatIsoDate(demand.raisedOn) }),
            ].join(" · ")}
          </p>
          <p className="mt-5 max-w-3xl whitespace-pre-line text-ink text-lg leading-relaxed">
            {demand.summary}
          </p>
          {closing ? (
            <p className="mt-4 max-w-3xl font-ui text-ink-soft">
              {m.demand_closed_line({
                date: formatIsoDate(closing.occurredOn),
              })}{" "}
              {closing.note}
            </p>
          ) : null}
        </Container>
      </section>

      <nav aria-labelledby="demand-on-page" className="bg-page">
        <Container className="pt-8">
          <h2 id="demand-on-page" className="font-bold text-lg">
            {m.issue_on_this_page()}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {ANCHORS.map((anchor) => (
              <li key={anchor.id}>
                <a href={`#${anchor.id}`} className={LINK}>
                  {anchor.label()}
                </a>
              </li>
            ))}
          </ul>
        </Container>
      </nav>

      <div className="bg-page">
        <Container className="grid gap-12 py-12 pb-24 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0 space-y-12">
            <section id="teks" aria-labelledby="teks-title" className={SECTION}>
              <h2 id="teks-title" className={H2}>
                {m.demand_text_title()}
              </h2>
              <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
                {m.demand_text_intro()}
              </p>
              <blockquote className="mt-4 whitespace-pre-line border-brand border-l-4 bg-surface-raised p-5 text-ink leading-relaxed">
                {demand.body}
              </blockquote>
            </section>

            <section
              id="sub-tuntutan"
              aria-labelledby="sub-title"
              className={SECTION}
            >
              <h2 id="sub-title" className={H2}>
                {m.demand_items_title()}
              </h2>
              <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
                {m.demand_items_intro()}
              </p>
              <ol className="mt-6 border-ink border-t-2">
                {demand.items.map((item) => (
                  <li
                    key={item.id}
                    id={`sub-${item.number}`}
                    className="scroll-mt-24 border-line-subtle border-b py-5 last:border-b-0"
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
                    <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                      <ResponseMark status={item.response} />
                      <FulfilmentMark status={item.fulfilment} />
                    </p>
                    {item.briefSummary || item.brief ? (
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

            <section
              id="riwayat"
              aria-labelledby="riwayat-title"
              className={SECTION}
            >
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

            <section
              id="isu-terkait"
              aria-labelledby="isu-terkait-title"
              className={SECTION}
            >
              <h2 id="isu-terkait-title" className={H2}>
                {m.demand_issues_title()}
              </h2>
              {demand.issues.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {demand.issues.map((issue) => (
                    <li key={issue.code}>
                      <Link to={`/isu/${issue.code}`} className={LINK}>
                        {issue.title}
                      </Link>{" "}
                      <span className="font-ui text-ink-muted text-sm tabular-nums">
                        {issue.code}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-ink-muted">{m.demand_issues_none()}</p>
              )}
            </section>
          </div>
          <aside className="space-y-8">
            <p className="flex items-start gap-3 border-line-subtle border-y py-5 text-ink-soft text-sm leading-relaxed">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {m.demand_method_note({ organization })}
            </p>
            <FollowCard code={demand.code} state={follow} kind="demand" />
            <p className="flex items-start gap-2 border-line-subtle border-t pt-5 text-ink-soft text-sm">
              <Flag aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {m.issue_complaint_note()}{" "}
                <Link to={`/tuntutan/${demand.code}/laporkan`} className={LINK}>
                  {m.issue_complaint_link()}
                </Link>
              </span>
            </p>
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
