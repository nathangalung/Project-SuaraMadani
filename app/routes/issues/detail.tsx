import { ChevronLeft, Flag, Lock } from "lucide-react"
import { lazy, Suspense } from "react"
import { data, isRouteErrorResponse, Link, redirect } from "react-router"
import { SECTION_TITLE } from "~/components/layout/section-heading"
import { ButtonLink } from "~/components/ui/button"
import { Container } from "~/components/ui/container"
import { Fact } from "~/components/ui/fact"
import {
  demandsForIssue,
  type LatestDemand,
} from "~/features/demands/demands.server"
import { FulfilmentMark } from "~/features/demands/status-mark"
import {
  followIssue,
  isFollowing,
  unfollowIssue,
} from "~/features/issues/follow.server"
import { FollowCard, signInToFollow } from "~/features/issues/follow-card"
import { placeOf } from "~/features/issues/issue-card"
import { normalizeIssueCode } from "~/features/issues/issue-code"
import { IssueEvidence } from "~/features/issues/issue-evidence"
import { ReferralLines, ResponseList } from "~/features/issues/issue-record"
import { CategoryMark, StageMark } from "~/features/issues/issue-status"
import {
  getIssuePage,
  getTakenDown,
  issueUrls,
} from "~/features/issues/issues.server"
import { evidenceViews } from "~/features/issues/public-evidence.server"
import { latestReferral } from "~/features/issues/record.server"
import { StatusTracker } from "~/features/issues/status-tracker"
import { issueHistory, Timeline } from "~/features/issues/timeline"
import { useSiteTitle } from "~/features/report/page-title"
import { labelOf, SUBCATEGORY_TEXT } from "~/features/report/public-labels"
import { m } from "~/paraglide/messages.js"
import type {
  StandardReason,
  TakedownReason,
} from "../../../shared/complaints.ts"
import { formatDate } from "../../../shared/format.ts"
import { referralWait, standardAnchor } from "../../../shared/moderation.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/detail"

// Root skips the site description
export const handle = { ownDescription: true }

export async function loader({ params, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const code = normalizeIssueCode(params.code)
  if (!code) throw data(null, { status: 404 })
  if (code !== params.code) throw redirect(`/isu/${code}`, 301)
  // Unpublished and other tenants: 404
  const issue = await getIssuePage(tenant.id, code)
  if (!issue) {
    const gone = await getTakenDown(tenant.id, code)
    if (gone) {
      throw data(
        { takenDownAt: gone.takenDownAt.toISOString(), reason: gone.reason },
        { status: 410 },
      )
    }
    throw data(null, { status: 404 })
  }
  const referral = latestReferral(issue.record, "referral")
  const urls = issueUrls(tenant.host, code, issue.version)
  // Sessions bypass the CDN
  const session = context.get(sessionContext)
  const { evidence: stored, ...page } = issue
  const evidence = evidenceViews(stored, tenant.host)
  return {
    demands: await demandsForIssue(tenant.id, code),
    evidence,
    follow: session
      ? {
          following: await isFollowing(tenant.id, code, session.user.id),
          emailReady: session.user.emailVerified,
        }
      : null,
    issue: page,
    referral,
    escalation: latestReferral(issue.record, "escalation"),
    // Read time, never stored
    wait: referral ? referralWait(referral, issue.govStatus, new Date()) : null,
    siteName: m.og_site_name({ name: tenant.name }),
    ...urls,
  }
}

// Follow or unfollow, then PRG
export async function action({ request, params, context }: Route.ActionArgs) {
  const tenant = context.get(tenantContext)
  const code = normalizeIssueCode(params.code)
  if (!code) throw data(null, { status: 404 })
  const session = context.get(sessionContext)
  if (!session) throw redirect(signInToFollow(code), 303)
  const intent = (await request.formData()).get("intent")
  if (intent === "follow") {
    if (!(await followIssue(tenant.id, code, session.user.id))) {
      throw data(null, { status: 404 })
    }
  } else if (intent === "unfollow") {
    await unfollowIssue(tenant.id, code, session.user.id)
  } else {
    throw data(null, { status: 400 })
  }
  throw redirect(`/isu/${code}#ikuti`, 303)
}

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"
// Space only, no rules
const H2 = SECTION_TITLE

const ANCHORS = [
  { id: "tanggapan", label: m.issue_response_title },
  { id: "status", label: m.issue_stage_title },
  { id: "riwayat", label: m.issue_history_title },
  { id: "bukti", label: m.issue_evidence_title },
] as const

/** Tuntutan that cite this issue. */
function PartOfDemands({ demands }: { demands: LatestDemand[] }) {
  if (demands.length === 0) return null
  return (
    <section aria-labelledby="issue-demands">
      <h2 id="issue-demands" className="font-bold text-lg">
        {m.issue_demands_title()}
      </h2>
      <ul className="mt-3 flex flex-col gap-4">
        {demands.map((demand) => (
          <li key={demand.code}>
            <Link
              to={`/tuntutan/${demand.code}`}
              className="font-semibold leading-snug decoration-2 decoration-brand underline-offset-4 hover:underline"
            >
              {demand.title}
            </Link>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <FulfilmentMark status={demand.progress.status} />
              <span className="font-ui text-sm">
                {m.demand_progress_line({
                  done: demand.progress.fulfilled,
                  total: demand.progress.total,
                })}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <Link to="/tuntutan" className={`mt-4 inline-block text-sm ${LINK}`}>
        {m.issue_demands_all()}
      </Link>
    </section>
  )
}

// PLAN §6.1 order, no JS
export default function IssueDetail({ loaderData }: Route.ComponentProps) {
  const { issue, siteName, url, image, follow, evidence } = loaderData
  const anchors = ANCHORS.filter(
    (anchor) => anchor.id !== "bukti" || evidence.length > 0,
  )
  const { responses } = issue.record
  const subcategory = labelOf(SUBCATEGORY_TEXT, issue.subcategoryId)
  return (
    <>
      <title>{`${issue.title} · ${siteName}`}</title>
      <meta name="description" content={issue.summary.slice(0, 200)} />
      <link rel="canonical" href={url} />
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content={siteName} />
      <meta property="og:title" content={issue.title} />
      <meta property="og:description" content={issue.summary.slice(0, 200)} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />

      {/* Article head, no band */}
      <section aria-labelledby="issue-title" className="relative isolate">
        <div
          aria-hidden="true"
          className="header-bg absolute inset-0 -z-10 [mask-image:linear-gradient(180deg,#000_0%,#000_30%,transparent_100%)]"
        />
        <Container className="pt-8 pb-10 sm:pt-10">
          <Link
            to="/isu"
            className="inline-flex items-center gap-1 font-semibold text-ink text-sm underline-offset-4 hover:underline"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            {m.nav_issues()}
          </Link>
          <p className="mt-8 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.95rem] text-ink-soft">
            <CategoryMark categoryId={issue.categoryId} />
            {subcategory ? <span>· {subcategory}</span> : null}
            <span className="tabular-nums">· {issue.code}</span>
          </p>
          <h1
            id="issue-title"
            className="mt-3 max-w-4xl font-bold font-heading text-[clamp(2rem,4.4vw,3rem)] text-ink leading-[1.1] [font-synthesis-weight:none]"
          >
            {issue.title}
          </h1>
          <h2 className="sr-only">{m.issue_facts_title()}</h2>
          <dl className="mt-8 grid max-w-4xl grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
            <Fact term={m.issue_stage_label()}>
              <StageMark
                advocacy={issue.advocacyStatus}
                government={issue.govStatus}
              />
            </Fact>
            <Fact term={m.issue_fact_reports()}>
              <span className="font-bold">
                {m.issue_reports({ count: issue.reportCount })}
              </span>
            </Fact>
            <Fact term={m.issue_fact_place()}>
              <span>{placeOf(issue)}</span>
            </Fact>
            <Fact term={m.issue_fact_published()}>
              <span>{formatDate(issue.publishedAt)}</span>
            </Fact>
          </dl>
          <div className="mt-6 max-w-3xl">
            <ReferralLines
              referral={loaderData.referral}
              escalation={loaderData.escalation}
              wait={loaderData.wait}
            />
          </div>
          <p className="mt-4 max-w-3xl font-ui text-ink-muted text-sm">
            {m.issue_advocacy_note()}
          </p>
          <p className="mt-8 max-w-3xl whitespace-pre-line text-ink text-lg leading-relaxed">
            {issue.summary}
          </p>
          {issue.redactedAt && issue.redactionReason ? (
            <RedactedLine
              at={issue.redactedAt}
              reason={issue.redactionReason}
            />
          ) : null}
        </Container>
      </section>

      <nav aria-labelledby="issue-on-page" className="bg-page">
        <Container className="pt-2">
          <h2 id="issue-on-page" className="text-ink-muted text-sm">
            {m.issue_on_this_page()}
          </h2>
          <ul className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
            {anchors.map((anchor) => (
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
          <div className="min-w-0 space-y-16">
            <section id="tanggapan" aria-labelledby="tanggapan-title">
              <h2 id="tanggapan-title" className={H2}>
                {m.issue_response_title()}
              </h2>
              {responses.length > 0 ? (
                <>
                  <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
                    {m.issue_response_count({ count: responses.length })}
                  </p>
                  <ResponseList responses={responses} />
                </>
              ) : (
                <p className="mt-3 text-ink-muted">
                  {issue.govStatus === "awaiting_response"
                    ? m.issue_response_empty()
                    : m.issue_response_unrecorded()}
                </p>
              )}
            </section>
            <section id="status" aria-labelledby="status-title">
              <h2 id="status-title" className={H2}>
                {m.issue_stage_title()}
              </h2>
              <StatusTracker
                status={{
                  advocacy: issue.advocacyStatus,
                  government: issue.govStatus,
                }}
                labelledBy="status-title"
              />
            </section>
            <section id="riwayat" aria-labelledby="riwayat-title">
              <h2 id="riwayat-title" className={H2}>
                {m.issue_history_title()}
              </h2>
              <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
                {m.issue_history_intro()}
              </p>
              <Timeline className="mt-6 ml-1.5" entries={issueHistory(issue)} />
            </section>
            {evidence.length > 0 ? (
              <section id="bukti" aria-labelledby="bukti-title">
                <h2 id="bukti-title" className={H2}>
                  {m.issue_evidence_title()}
                </h2>
                <p className="mt-1 font-ui text-[0.95rem] text-ink-soft">
                  {m.issue_evidence_intro()}
                </p>
                <IssueEvidence items={evidence} />
              </section>
            ) : null}
          </div>
          <aside className="space-y-10">
            <PartOfDemands demands={loaderData.demands} />
            <p className="flex items-start gap-2 text-ink-soft text-sm leading-relaxed">
              <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {m.issue_privacy_note()}{" "}
                <Link to="/privasi" className={LINK}>
                  {m.privacy_link()}
                </Link>
              </span>
            </p>
            <section aria-labelledby="same-problem">
              <h2 id="same-problem" className="font-bold text-lg">
                {m.issue_same_problem_title()}
              </h2>
              <p className="mt-1 text-ink-soft text-sm">
                {m.issue_same_problem_body()}
              </p>
              <ButtonLink to="/lapor" className="mt-4 w-full">
                {m.report_start()}
              </ButtonLink>
            </section>
            <FollowCard code={issue.code} state={follow} />
            <p className="flex items-start gap-2 text-ink-soft text-sm">
              <Flag aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {m.issue_complaint_note()}{" "}
                <Link to={`/isu/${issue.code}/laporkan`} className={LINK}>
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

// PLAN §5.10 revision marker
function RedactedLine({ at, reason }: { at: Date; reason: StandardReason }) {
  return (
    <p className="mt-3 font-ui text-ink-muted text-sm">
      {m.issue_redacted()} ·{" "}
      <Link
        to={`/pedoman#${standardAnchor(reason)}`}
        className="underline underline-offset-4 hover:no-underline"
      >
        {m.issue_redacted_standard({ n: reason.slice("standard_".length) })}
      </Link>{" "}
      · <time dateTime={at.toISOString()}>{formatDate(at)}</time>
    </p>
  )
}

// Error markup not first-load
const ErrorPage = lazy(() =>
  import("~/components/layout/error-page").then((module) => ({
    default: module.ErrorPage,
  })),
)

/** Standard, Komdigi or data owner. */
function goneReason(reason: TakedownReason, date: string) {
  if (reason === "komdigi_order") {
    return {
      body: m.issue_taken_down_komdigi_order({ date }),
      href: "/pedoman#perintah",
      link: m.guidelines_link(),
    }
  }
  if (reason === "data_subject_request") {
    return {
      body: m.issue_taken_down_data_subject_request({ date }),
      href: "/privasi#hak",
      link: m.issue_taken_down_privacy_link(),
    }
  }
  return {
    body: m.issue_taken_down_body({
      date,
      n: reason.slice("standard_".length),
    }),
    href: `/pedoman#${standardAnchor(reason)}`,
    link: m.guidelines_link(),
  }
}

// Other statuses reach root
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const documentTitle = useSiteTitle(m.issue_not_found_title())
  const goneTitle = useSiteTitle(m.issue_taken_down_title())
  if (isRouteErrorResponse(error) && error.status === 410) {
    const gone = error.data as { takenDownAt: string; reason: TakedownReason }
    const date = formatDate(new Date(gone.takenDownAt))
    const why = goneReason(gone.reason, date)
    return (
      <Suspense>
        <ErrorPage
          code={410}
          title={m.issue_taken_down_title()}
          documentTitle={goneTitle}
          body={why.body}
          actions={
            <>
              <ButtonLink to="/isu">{m.nav_issues()}</ButtonLink>
              <ButtonLink to={why.href} variant="secondary">
                {why.link}
              </ButtonLink>
            </>
          }
        />
      </Suspense>
    )
  }
  if (!isRouteErrorResponse(error) || error.status !== 404) throw error
  return (
    <Suspense>
      <ErrorPage
        code={404}
        title={m.issue_not_found_title()}
        documentTitle={documentTitle}
        body={m.issue_not_found_body()}
        actions={<ButtonLink to="/isu">{m.nav_issues()}</ButtonLink>}
      />
    </Suspense>
  )
}
