import type { CSSProperties } from "react"
import { Link, useRouteLoaderData } from "react-router"
import { BoxedHeading } from "~/components/layout/boxed-heading"
import { PageHeader } from "~/components/layout/page-header"
import { useStagger } from "~/components/layout/use-reveal"
import { cn } from "~/components/ui/cn"
import { aboutFacts } from "~/features/content/about.server"
import { InfoCard, SubTitle } from "~/features/content/about-parts"
import { ReportButton, useNational } from "~/features/content/policy-page"
import { PROSE_LINK, updatedOn } from "~/features/content/prose"
import { Rings, StarPair } from "~/features/home/ornaments"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import type { loader as rootLoader } from "~/root"
import { nationalContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/about"

// Bump after each content review
const REVIEWED = "2026-10-16"

export function loader({ context }: Route.LoaderArgs) {
  // Apex has no campus credit
  return aboutFacts(
    context.get(nationalContext) ? null : context.get(tenantContext),
  )
}

const STEPS = [
  [m.about_step_1_title, m.about_step_1_body],
  [m.about_step_2_title, m.about_step_2_body],
  [m.about_step_3_title, m.about_step_3_body],
  [m.about_step_4_title, m.about_step_4_body],
] as const

const METHODS = [
  [m.about_method_1_title, m.about_method_1_body],
  [m.about_method_2_title, m.about_method_2_body],
  [m.about_method_3_title, m.about_method_3_body],
] as const

function shown(count: string) {
  return [
    m.about_public_1(),
    m.about_public_2({ count }),
    m.about_public_3(),
    m.about_public_4(),
    m.about_public_5(),
    m.about_public_6(),
  ]
}

const NEVER = [
  m.about_never_1,
  m.about_never_2,
  m.about_never_3,
  m.about_never_4,
  m.about_never_5,
]

// Same rhythm as home
const BAND =
  "relative px-6 pt-[clamp(1rem,4vw,3rem)] pb-[clamp(4rem,9vw,7rem)] sm:px-10"
// Hard edge, no hero fade
const BAND_FIRST =
  "relative px-6 pt-14 pb-[clamp(4rem,9vw,7rem)] sm:px-10 lg:pt-20"
const LIST_SECTION = "px-6 py-14 sm:px-10 lg:py-20"
const LEAD = "mx-auto mt-4 max-w-2xl text-center text-lg leading-relaxed"
const BAND_LINK =
  "font-semibold text-on-accent underline underline-offset-4 hover:no-underline"
const BULLETS = "list-disc space-y-1.5 pl-5"
const ORNAMENT = "pointer-events-none absolute -z-10 select-none"

function principles() {
  return [
    {
      title: m.about_principle_1_title(),
      body: m.about_principle_1_body(),
    },
    {
      title: m.about_principle_2_title(),
      body: m.about_principle_2_body(),
    },
    {
      title: m.about_principle_3_title(),
      body: m.about_principle_3_body(),
    },
    {
      title: m.about_principle_4_title(),
      body: m.about_principle_4_body(),
    },
    {
      title: m.about_principle_5_title(),
      body: m.about_principle_5_body(),
    },
    {
      title: m.about_principle_6_title(),
      body: m.about_principle_6_body(),
    },
  ]
}

// Home look, PLAN §6.1 facts
export default function About({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root")
  const kmItb = root?.brandAssets === "km-itb"
  const national = useNational()
  const steps = useStagger<HTMLOListElement>()
  const methods = useStagger<HTMLUListElement>()
  return (
    <>
      <title>{useSiteTitle(m.nav_about())}</title>
      {/* Same header as /lapor */}
      <PageHeader title={m.about_title()} description={m.about_lead()} />
      <div className="relative mt-8 bg-band">
        <section aria-labelledby="prinsip" className={BAND_FIRST}>
          {/* Yellow box, team request */}
          <BoxedHeading id="prinsip" tone="highlight">
            {m.about_principles_title()}
          </BoxedHeading>
          <ul className="mx-auto mt-10 grid max-w-6xl gap-x-8 text-on-accent sm:grid-cols-2 lg:grid-cols-3">
            {principles().map((item) => (
              <li
                key={item.title}
                className="border-on-accent/30 border-t py-5"
              >
                <h3 className="font-bold font-ui text-lg leading-snug">
                  {item.title}
                </h3>
                <p className="mt-1 text-on-accent/80 leading-relaxed">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="cara-kerja" className={BAND}>
          <BoxedHeading id="cara-kerja" tone="ink">
            {m.about_band_how()}
          </BoxedHeading>
          <SubTitle className="mt-10">{m.home_how_title()}</SubTitle>
          {/* Home Cara Kerja numbers */}
          <ol
            ref={steps}
            className="mx-auto mt-10 grid max-w-6xl gap-x-8 gap-y-10 text-center text-on-accent sm:grid-cols-2 lg:grid-cols-4"
          >
            {STEPS.map(([title, body], index) => (
              <li
                key={title()}
                style={{ "--i": index } as CSSProperties}
                className="flex flex-col items-center"
              >
                <span
                  aria-hidden="true"
                  className="font-bold text-[clamp(2.2rem,4vw,3.4rem)] tabular-nums leading-none"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h4 className="mt-3 font-bold font-ui text-lg leading-snug">
                  {title()}
                </h4>
                <p className="mt-1 text-on-accent/80 leading-relaxed">
                  {body()}
                </p>
              </li>
            ))}
          </ol>
          <p className={cn(LEAD, "mt-12 text-on-accent")}>
            {m.about_demands_body()}
            {/* Apex has no tuntutan list */}
            {national ? null : (
              <>
                {" "}
                <Link to="/tuntutan" className={BAND_LINK}>
                  {m.about_demands_link()}
                </Link>
              </>
            )}
          </p>
          <SubTitle id="metode" className="mt-14">
            {m.about_method_title()}
          </SubTitle>
          <p className={cn(LEAD, "text-balance text-on-accent")}>
            {m.about_method_lead()}{" "}
            <Link to="/pedoman#pemeriksaan" className={BAND_LINK}>
              {m.about_method_link()}
            </Link>
          </p>
          <ul
            ref={methods}
            className="mx-auto mt-8 grid max-w-6xl gap-4 md:grid-cols-3"
          >
            {METHODS.map(([title, body], index) => (
              <InfoCard key={title()} title={title()} tone="band" index={index}>
                {body()}
              </InfoCard>
            ))}
          </ul>
        </section>
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
        <section aria-labelledby="privasi" className={LIST_SECTION}>
          <BoxedHeading id="privasi" tone="brand">
            {m.about_band_privacy()}
          </BoxedHeading>
          <p className={cn(LEAD, "text-ink")}>{m.about_privacy_lead()}</p>
          {/* Shown brand, never ink */}
          <ul className="mx-auto mt-12 grid max-w-6xl gap-4 md:grid-cols-2">
            <InfoCard title={m.about_public_title()} titleAs="h3" tone="brand">
              <ul className={BULLETS}>
                {shown(loaderData.districtMin).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </InfoCard>
            <InfoCard title={m.about_never_title()} titleAs="h3" tone="ink">
              <ul className={BULLETS}>
                {NEVER.map((item) => (
                  <li key={item()}>{item()}</li>
                ))}
              </ul>
            </InfoCard>
          </ul>
          <p className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-2 text-center text-ink leading-relaxed">
            <span>{m.about_privacy_more()}</span>
            <Link to="/privasi#publik" className={PROSE_LINK}>
              {m.privacy_link()}
            </Link>
            <Link to="/pedoman" className={PROSE_LINK}>
              {m.guidelines_link()}
            </Link>
          </p>
          <div className="mx-auto mt-16 flex max-w-6xl flex-col items-center gap-6 border-ink/15 border-t pt-12 text-center">
            <div className="font-ui text-ink text-sm">
              {loaderData.credit && (
                <p>{m.about_credit({ credit: loaderData.credit })}</p>
              )}
              <p>{m.about_reviewed({ date: updatedOn(REVIEWED) })}</p>
              {/* Footer links here */}
              <p id="lisensi" className="mt-2">
                {m.about_license_map()}
              </p>
            </div>
            <ReportButton national={national} variant="highlight" />
          </div>
        </section>
      </div>
    </>
  )
}
