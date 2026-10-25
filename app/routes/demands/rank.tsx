import { ChevronLeft } from "lucide-react"
import { data, Link, redirect, useRevalidator } from "react-router"
import { Card } from "~/components/ui/card"
import { Container } from "~/components/ui/container"
import { rankingPage, rankRequest } from "~/features/demands/ranking.server"
import { RankingForm, WithdrawRanking } from "~/features/demands/ranking-panel"
import { useSiteTitle } from "~/features/report/page-title"
import { SignIn } from "~/features/report/sign-in"
import { m } from "~/paraglide/messages.js"
import { sessionContext, signedInLabel, tenantContext } from "../../context.ts"
import type { Route } from "./+types/rank"

// Header drops its Masuk
export const handle = { pageSignIn: true }

export function headers() {
  return { "Cache-Control": "private, no-store" }
}

export async function loader({ context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const session = context.get(sessionContext)
  const page = await rankingPage(tenant.id, session?.user.id ?? null)
  return {
    ...page,
    signedInAs: signedInLabel(session),
    siteKey: process.env.TURNSTILE_SITE_KEY ?? "",
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const result = await rankRequest({
    request,
    tenant: context.get(tenantContext),
    session: context.get(sessionContext),
  })
  if (result.status === 413) throw data(null, { status: 413 })
  // List shows the result
  if (result.status === 200) throw redirect("/tuntutan?urut=peringkat", 303)
  return data(result.body, { status: result.status })
}

// One list per account
export default function DemandRankPage({ loaderData }: Route.ComponentProps) {
  const { choices, saved, signedInAs, siteKey } = loaderData
  const revalidator = useRevalidator()
  const pageTitle = useSiteTitle(m.demand_rank_page_title())
  return (
    <div className="bg-page">
      <Container width="3xl" className="py-10 pb-24">
        <Link
          to="/tuntutan"
          className="inline-flex items-center gap-1 font-semibold text-ink text-sm underline-offset-4 hover:underline"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {m.explore_tab_demands()}
        </Link>
        <h1 className="mt-5 font-bold font-heading text-[clamp(2rem,4.4vw,2.75rem)] text-ink leading-[1.1] [font-synthesis-weight:none]">
          {m.demand_rank_page_title()}
        </h1>
        <p className="mt-3 text-ink-soft text-lg leading-relaxed">
          {m.demand_rank_page_lead()}
        </p>
        <p className="mt-2 text-ink-soft leading-relaxed">
          {m.demand_rank_intro()}
        </p>
        <Card className="mt-8 rounded-xl p-5 sm:p-7">
          {choices.length === 0 ? (
            <>
              <title>{pageTitle}</title>
              <p className="font-semibold">{m.demand_rank_empty()}</p>
              {saved ? <WithdrawRanking /> : null}
            </>
          ) : signedInAs ? (
            <>
              <RankingForm
                email={signedInAs}
                choices={choices}
                saved={saved}
                siteKey={siteKey}
                pageTitle={pageTitle}
                onSessionLost={() => void revalidator.revalidate()}
              />
              {saved ? <WithdrawRanking /> : null}
            </>
          ) : (
            <section aria-labelledby="ranking-sign-in">
              <title>{pageTitle}</title>
              <noscript>
                <p className="mb-6 font-semibold">{m.demand_rank_noscript()}</p>
              </noscript>
              <h2
                id="ranking-sign-in"
                tabIndex={-1}
                className="font-bold text-xl"
              >
                {m.demand_rank_sign_in_title()}
              </h2>
              <div className="mt-4">
                <SignIn
                  siteKey={siteKey}
                  onSignedIn={() => void revalidator.revalidate()}
                  intro={m.demand_rank_sign_in_intro()}
                />
              </div>
            </section>
          )}
        </Card>
      </Container>
    </div>
  )
}
