import { lazy, Suspense } from "react"
import { useRouteLoaderData } from "react-router"
import { ButtonLink } from "~/components/ui/button"
import { readNational } from "~/features/data/national.server"
import { DemandStrip } from "~/features/home/demand-strip"
import { Hero } from "~/features/home/hero"
import { loadHome } from "~/features/home/home.server"
import { IssueShowcase } from "~/features/home/issue-showcase"
import { Rings, StarPair } from "~/features/home/ornaments"
import { m } from "~/paraglide/messages.js"
import type { loader as rootLoader } from "~/root"
import { nationalContext, tenantContext } from "../context.ts"
import type { Route } from "./+types/home"

export function meta({ matches }: Route.MetaArgs) {
  const site = matches[0]?.loaderData?.siteName
  return [{ title: site ? `Sadar Bersuara · ${site}` : "Sadar Bersuara" }]
}

// Tenant hosts never load it
const NationalPage = lazy(() => import("~/features/data/national"))

// SSR lists, Hono caches
export async function loader({ request, context }: Route.LoaderArgs) {
  if (context.get(nationalContext)) {
    const port = new URL(request.url).port
    return { scope: "national" as const, view: await readNational({ port }) }
  }
  return {
    scope: "tenant" as const,
    ...(await loadHome(context.get(tenantContext))),
  }
}

const ORNAMENT = "pointer-events-none absolute -z-10 select-none"

export default function Home({ loaderData }: Route.ComponentProps) {
  if (loaderData.scope === "national") {
    // SSR awaits allReady
    return (
      <Suspense>
        <NationalPage view={loaderData.view} />
      </Suspense>
    )
  }
  return <CampusHome issues={loaderData.issues} demands={loaderData.demands} />
}

type Tenant = Extract<Route.ComponentProps["loaderData"], { scope: "tenant" }>

function CampusHome({ issues, demands }: Omit<Tenant, "scope">) {
  // Root loader owns the gate
  const root = useRouteLoaderData<typeof rootLoader>("root")
  const kmItb = root?.brandAssets === "km-itb"
  // Never end on empty state
  const closing = issues.length === 0
  return (
    <>
      <div className="relative bg-band">
        <Hero graphic={kmItb} signedIn={Boolean(root?.user)} />
        {/* Tuntutan lead, PLAN §8.2 */}
        <DemandStrip {...demands} />
      </div>
      <div className="relative isolate overflow-hidden bg-home-list">
        {kmItb && (
          <div aria-hidden="true">
            <StarPair
              sizes="48vw"
              className={`${ORNAMENT} top-[8%] -left-[18%] hidden h-auto w-[48%] opacity-90 lg:block`}
            />
            <Rings
              className={`${ORNAMENT} -right-[10%] bottom-[6%] h-auto w-[40%] opacity-80`}
            />
          </div>
        )}
        <IssueShowcase
          id="isu-terbaru"
          title={m.home_latest_issues_title()}
          rule={m.home_latest_issues_rule()}
          issues={issues}
          empty={m.home_latest_issues_empty()}
          emptyBody={m.home_latest_issues_empty_body()}
          seeAll={{ to: "/isu", label: m.home_see_all_issues() }}
        />
        {closing && (
          <p className="-mt-2 px-6 pb-14 text-center lg:-mt-6 lg:pb-20">
            <ButtonLink to="/isu" variant="secondary" size="lg">
              {m.nav_issues()}
            </ButtonLink>
          </p>
        )}
      </div>
    </>
  )
}
