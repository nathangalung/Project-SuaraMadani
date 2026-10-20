import { ChevronLeft, Lock } from "lucide-react"
import { data, Link, redirect, useRevalidator } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Card } from "~/components/ui/card"
import { Container } from "~/components/ui/container"
import {
  ownRating,
  rateRequest,
  ratingTarget,
} from "~/features/demands/rating.server"
import { RatingForm, WithdrawRating } from "~/features/demands/rating-panel"
import { useSiteTitle } from "~/features/report/page-title"
import { SignIn } from "~/features/report/sign-in"
import { m } from "~/paraglide/messages.js"
import { normalizeDemandCode } from "../../../shared/demands.ts"
import { sessionContext, signedInLabel, tenantContext } from "../../context.ts"
import type { Route } from "./+types/rate"

// Header drops its Masuk
export const handle = { pageSignIn: true }

export function headers() {
  return { "Cache-Control": "private, no-store" }
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const code = normalizeDemandCode(params.code)
  if (!code) throw data(null, { status: 404 })
  if (code !== params.code) throw redirect(`/tuntutan/${code}/nilai`, 301)
  const demand = await ratingTarget(tenant.id, code)
  if (!demand) throw data(null, { status: 404 })
  const session = context.get(sessionContext)
  return {
    demand,
    own: session ? await ownRating(tenant.id, code, session.user.id) : null,
    name: session?.user.name.trim() ?? "",
    signedInAs: signedInLabel(session),
    siteKey: process.env.TURNSTILE_SITE_KEY ?? "",
  }
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const code = normalizeDemandCode(params.code)
  if (!code) throw data(null, { status: 404 })
  const result = await rateRequest({
    request,
    tenant: context.get(tenantContext),
    session: context.get(sessionContext),
    code,
  })
  if (result.status === 413) throw data(null, { status: 413 })
  // Panel shows the score
  if (result.status === 200)
    throw redirect(`/tuntutan/${code}#kepentingan`, 303)
  return data(result.body, { status: result.status })
}

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"

// One per account, PLAN §5.4
export default function DemandRatePage({ loaderData }: Route.ComponentProps) {
  const { demand, own, name, signedInAs, siteKey } = loaderData
  const revalidator = useRevalidator()
  const pageTitle = useSiteTitle(m.demand_importance_page_title())
  return (
    <div className="bg-page">
      <Container width="3xl" className="py-10 pb-24">
        <Link
          to={`/tuntutan/${demand.code}`}
          className="inline-flex items-center gap-1 font-semibold text-ink text-sm underline-offset-4 hover:underline"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {m.complaint_back_demand()}
        </Link>
        <h1 className="mt-5 font-bold font-heading text-[clamp(2rem,4.4vw,2.75rem)] text-ink leading-[1.1] [font-synthesis-weight:none]">
          {m.demand_importance_page_title()}
        </h1>
        <p className="mt-3 max-w-2xl text-ink-soft text-lg leading-relaxed">
          {m.demand_importance_page_lead()}
        </p>
        <p className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-ink border-t-2 pt-4">
          <Badge className="tabular-nums">{demand.code}</Badge>
          <span className="font-semibold">{demand.title}</span>
        </p>
        <Card className="mt-8 p-5 sm:p-7">
          {!demand.open ? (
            <>
              <title>{pageTitle}</title>
              <p className="font-semibold">{m.demand_importance_closed()}</p>
              {own ? <WithdrawRating /> : null}
            </>
          ) : signedInAs ? (
            <>
              <RatingForm
                email={signedInAs}
                name={name}
                own={own}
                siteKey={siteKey}
                pageTitle={pageTitle}
                onSessionLost={() => void revalidator.revalidate()}
              />
              {own ? <WithdrawRating /> : null}
            </>
          ) : (
            <section aria-labelledby="importance-sign-in">
              <title>{pageTitle}</title>
              <noscript>
                <p className="mb-6 border-4 border-ink p-5 font-semibold">
                  {m.demand_importance_noscript()}
                </p>
              </noscript>
              <h2
                id="importance-sign-in"
                tabIndex={-1}
                className="font-bold text-xl"
              >
                {m.demand_importance_sign_in_title()}
              </h2>
              <div className="mt-4">
                <SignIn
                  siteKey={siteKey}
                  onSignedIn={() => void revalidator.revalidate()}
                  intro={m.demand_importance_sign_in_intro()}
                />
              </div>
              <p className="mt-6 flex gap-2 border-line-subtle border-t pt-4 text-ink-soft text-sm leading-relaxed">
                <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  {m.signin_privacy_note()}{" "}
                  <Link to="/privasi" className={LINK}>
                    {m.privacy_link()}
                  </Link>
                </span>
              </p>
            </section>
          )}
        </Card>
      </Container>
    </div>
  )
}
