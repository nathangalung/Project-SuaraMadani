import { Lock } from "lucide-react"
import { redirect } from "react-router"
import { PageHeader } from "~/components/layout/page-header"
import { QueueNote } from "~/components/layout/queue-note"
import { ButtonLink } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { Container } from "~/components/ui/container"
import { Note } from "~/components/ui/note"
import { listFollowed } from "~/features/issues/followed.server"
import { FollowedList } from "~/features/issues/followed-list"
import { useSiteTitle } from "~/features/report/page-title"
import { queueSlow } from "~/features/report/queue-delay.server"
import { readLink } from "~/features/report/signed-link.server"
import { linkedReport, listOwnReports } from "~/features/report/tracking.server"
import { TrackingResult } from "~/features/report/tracking-result"
import { m } from "~/paraglide/messages.js"
import { pageNumber } from "../../../shared/canonical-query.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/track"

// Header drops its Masuk
export const handle = { pageSignIn: true }

export function headers() {
  return {
    "Cache-Control": "private, no-store",
    // Item 16 token in URL
    "Referrer-Policy": "no-referrer",
  }
}

// Session, else signed email link
export async function loader({ request, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const session = context.get(sessionContext)
  const base = {
    campus: tenant.campusName,
    slow: await queueSlow(tenant.id),
    // WhatsApp-only accounts get no mail
    emailReady: session ? session.user.emailVerified : true,
  }
  const params = new URL(request.url).searchParams
  if (session) {
    const own = await listOwnReports(
      tenant.id,
      session.user.id,
      pageNumber(params.get("halaman") ?? undefined),
    )
    if (own.page > own.pageCount) throw redirect(trackHref(own.pageCount))
    return {
      ...base,
      own,
      // Profile shows follows, no email
      followed: await listFollowed(tenant.id, session.user.id),
      link: null,
    }
  }
  const token = params.get("t")
  if (token === null) return { ...base, own: null, followed: null, link: null }
  const claim = readLink(token, "lacak", tenant.id)
  const report = claim
    ? await linkedReport(tenant.id, claim.subjectId, claim.userId)
    : null
  return {
    ...base,
    own: report ? { reports: [report], page: 1, pageCount: 1 } : null,
    followed: null,
    link: report ? ("valid" as const) : ("invalid" as const),
  }
}

function trackHref(page: number): string {
  return page > 1 ? `/lacak?halaman=${page}` : "/lacak"
}

// Works without JS
export default function Track({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <title>{useSiteTitle(m.track_title())}</title>
      <PageHeader title={m.track_title()} description={m.track_lead()} />
      <div className="mt-10 bg-page">
        <Container width="4xl" className="py-12 pb-24">
          {loaderData.slow ? (
            <QueueNote className="mx-auto mb-8 max-w-2xl" />
          ) : null}
          {loaderData.emailReady === false ? (
            <Note tone="info" className="mx-auto mb-8 max-w-2xl">
              {m.report_email_unverified()}
            </Note>
          ) : null}
          {loaderData.link === "valid" ? (
            <Note tone="info" className="mx-auto mb-8 max-w-2xl">
              {m.track_link_note()}{" "}
              <a
                href="/masuk?kembali=%2Flacak"
                className="font-semibold text-accent underline underline-offset-4 hover:no-underline"
              >
                {m.signin_page_title()}
              </a>
            </Note>
          ) : null}
          {loaderData.own ? (
            <TrackingResult
              campus={loaderData.campus}
              reports={loaderData.own.reports}
              page={loaderData.own.page}
              pageCount={loaderData.own.pageCount}
              pageHref={trackHref}
              canUpload={loaderData.link === null}
            />
          ) : (
            <Card className="mx-auto max-w-2xl rounded-xl p-5 sm:p-6">
              <p>
                {loaderData.link === "invalid"
                  ? m.track_link_invalid()
                  : m.track_sign_in()}
              </p>
              <ButtonLink to="/masuk" className="mt-4">
                {m.signin_page_title()}
              </ButtonLink>
            </Card>
          )}
          {loaderData.followed ? (
            <FollowedList followed={loaderData.followed} />
          ) : null}
          <p className="mx-auto mt-8 flex max-w-xl items-start justify-center gap-2 text-center text-ink-soft text-sm">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {m.track_privacy_note()}
          </p>
        </Container>
      </div>
    </>
  )
}
