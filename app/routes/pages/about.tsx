import { Link, useRouteLoaderData } from "react-router"
import { cn } from "~/components/ui/cn"
import { LineGrid } from "~/components/ui/line-grid"
import { aboutFacts } from "~/features/content/about.server"
import {
  Arc,
  HeroBackdrop,
  InfoCard,
  Panel,
} from "~/features/content/about-parts"
import {
  BandTitle,
  displayWeight,
  MixedLetters,
  StripTitle,
} from "~/features/content/display-title"
import {
  ContactLine,
  ReportButton,
  useNational,
} from "~/features/content/policy-page"
import { PROSE_LINK, updatedOn } from "~/features/content/prose"
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

const BODY = "relative px-4 pb-16 sm:px-6 lg:px-8 lg:pb-24"
const GRID = "relative z-10 mx-auto grid max-w-[1080px] gap-4 lg:gap-6"
const LIST = "mt-1 list-disc space-y-1.5 pl-5 marker:text-brand"

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

// Mockup TentangPage, PLAN §6.1 facts
export default function About({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root")
  const art = root?.brandAssets === "km-itb"
  const identity = root?.identity
  const national = useNational()
  return (
    <>
      <title>{useSiteTitle(m.nav_about())}</title>
      <section
        aria-labelledby="tentang-judul"
        className="relative isolate overflow-hidden"
      >
        <HeroBackdrop art={art} />
        <div className="flex flex-col items-center px-4 pt-10 pb-20 text-center lg:pt-16 lg:pb-28">
          {/* Menu label as visible eyebrow */}
          <h1
            id="tentang-judul"
            className="flex flex-col items-center text-on-accent uppercase"
          >
            <span className="bg-brand px-4 py-1 text-[clamp(1rem,4vw,1.75rem)] leading-[1.4] sm:px-8 sm:py-1.5">
              {m.nav_about()}
            </span>{" "}
            <span
              className={cn(
                "relative isolate mt-4 px-2 text-[clamp(2rem,9.4vw,6rem)] leading-[1.1] [font-synthesis:none] lg:mt-6",
                displayWeight(art),
                art && "title-glow",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 -z-10 bg-brand",
                  art ? "top-[35%] bottom-[10%]" : "inset-y-0",
                )}
              />
              <MixedLetters text="Suara Madani" />
            </span>
          </h1>
          <p className="mt-8 max-w-2xl text-pretty font-medium text-[clamp(1.05rem,1.8vw,1.35rem)] text-ink leading-snug">
            {m.about_lead()}
          </p>
        </div>
      </section>

      <section aria-labelledby="pengelola" className="relative bg-page">
        <BandTitle id="pengelola" text={m.about_band_who()} glow={art} />
        <div className={BODY}>
          {art && <Arc tone="pink" className="top-[10%] left-[5%] rotate-12" />}
          <Panel title={m.about_meaning_title()} art={art}>
            <p>{m.about_meaning_body()}</p>
          </Panel>
          {identity && (
            <>
              <StripTitle
                text={m.about_operator_title()}
                glow={art}
                className="my-8 lg:my-12"
              />
              <div className="relative z-10 mx-auto max-w-2xl text-center text-ink">
                <p className="text-lg leading-relaxed">
                  {national
                    ? m.about_operator_body_national()
                    : m.about_operator_body({
                        operator: identity.operator,
                        campus: identity.campus,
                      })}
                </p>
              </div>
            </>
          )}
          <StripTitle
            text={m.about_principles_title()}
            glow={art}
            className="my-8 lg:my-12"
          />
          <LineGrid
            items={principles()}
            columnCount={3}
            numbered={false}
            titleAs="h4"
            className="relative z-10"
          />
        </div>
      </section>

      <section aria-labelledby="cara-kerja" className="relative bg-page">
        <BandTitle id="cara-kerja" text={m.about_band_how()} glow={art} />
        <div className={BODY}>
          {art && <Arc tone="red" className="top-[40%] right-[6%]" />}
          <StripTitle
            text={m.home_how_title()}
            glow={art}
            className="mt-10 mb-4 lg:mt-14"
          />
          <p className="relative z-10 mx-auto mb-8 max-w-2xl text-center text-ink leading-[1.7] lg:mb-12">
            {m.about_how_lead()}
          </p>
          <ol className={cn(GRID, "sm:grid-cols-2 lg:grid-cols-4")}>
            {STEPS.map(([title, body], index) => (
              <InfoCard
                key={title()}
                number={index + 1}
                title={title()}
                art={art}
              >
                {body()}
              </InfoCard>
            ))}
          </ol>
          <p className="relative z-10 mx-auto mt-8 max-w-2xl text-center text-ink leading-[1.7] lg:mt-12">
            {m.about_demands_body()}
            {/* Apex has no tuntutan list */}
            {national ? null : (
              <>
                {" "}
                <Link to="/tuntutan" className={PROSE_LINK}>
                  {m.about_demands_link()}
                </Link>
              </>
            )}
          </p>
          <StripTitle
            id="metode"
            text={m.about_method_title()}
            glow={art}
            className="mt-12 mb-4 lg:mt-16"
          />
          <p className="relative z-10 mx-auto mb-8 max-w-2xl text-balance text-center text-ink leading-[1.7] lg:mb-12">
            {m.about_method_lead()}{" "}
            <Link to="/pedoman#pemeriksaan" className={PROSE_LINK}>
              {m.about_method_link()}
            </Link>
          </p>
          <ul className={cn(GRID, "md:grid-cols-3")}>
            {METHODS.map(([title, body]) => (
              <InfoCard key={title()} title={title()} art={art}>
                {body()}
              </InfoCard>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="akuntabilitas" className="relative bg-page">
        <BandTitle
          id="akuntabilitas"
          text={m.about_band_accountability()}
          glow={art}
        />
        <div className={cn(BODY, "pt-10 lg:pt-14")}>
          <p className="relative z-10 mx-auto mb-8 max-w-2xl text-center text-ink text-lg leading-[1.7] lg:mb-12">
            {m.about_accountability_lead()}
          </p>
          <ul className={cn(GRID, "md:grid-cols-2")}>
            <InfoCard title={m.about_entity_title()} titleAs="h3" art={art}>
              <p>
                {identity?.legalNumber
                  ? m.footer_legal_number({ number: identity.legalNumber })
                  : m.about_entity_pending()}
              </p>
              {identity?.alliance ? (
                <p className="mt-2">
                  {m.footer_alliance_member({ alliance: identity.alliance })}
                </p>
              ) : null}
              {loaderData.officers.length > 0 ? (
                <ul className={cn(LIST, "mt-2")}>
                  {loaderData.officers.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2">{m.about_officers_pending()}</p>
              )}
            </InfoCard>
            <InfoCard title={m.about_funding_title()} titleAs="h3" art={art}>
              <p>{m.about_funding_body()}</p>
              <p className="mt-2">{m.about_funding_list()}</p>
            </InfoCard>
            <InfoCard title={m.about_conflict_title()} titleAs="h3" art={art}>
              <p>{m.about_conflict_body()}</p>
            </InfoCard>
            <InfoCard
              title={m.about_corrections_title()}
              titleAs="h3"
              art={art}
            >
              <p id="koreksi">{m.about_corrections_body()}</p>
              <ContactLine />
            </InfoCard>
            <InfoCard
              title={m.about_license_title()}
              titleAs="h3"
              art={art}
              className="md:col-span-2"
            >
              <p id="lisensi">{m.about_license_map()}</p>
              <p className="mt-2">{m.about_license_code()}</p>
            </InfoCard>
          </ul>
        </div>
      </section>

      <section aria-labelledby="privasi" className="relative bg-page">
        <BandTitle id="privasi" text={m.about_band_privacy()} glow={art} />
        <div className={cn(BODY, "pt-10 lg:pt-14")}>
          {art && (
            <Arc tone="pink" className="top-[20%] left-[8%] -rotate-45" />
          )}
          <p className="relative z-10 mx-auto mb-8 max-w-2xl text-center text-ink text-lg leading-[1.7] lg:mb-12">
            {m.about_privacy_lead()}
          </p>
          <ul className={cn(GRID, "md:grid-cols-2")}>
            <InfoCard title={m.about_public_title()} titleAs="h3" art={art}>
              <ul className={LIST}>
                {shown(loaderData.districtMin).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </InfoCard>
            <InfoCard title={m.about_never_title()} titleAs="h3" art={art}>
              <ul className={LIST}>
                {NEVER.map((item) => (
                  <li key={item()}>{item()}</li>
                ))}
              </ul>
            </InfoCard>
          </ul>
          <p className="relative z-10 mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-2 text-center text-ink leading-relaxed">
            <span>{m.about_privacy_more()}</span>
            <Link to="/privasi#publik" className={PROSE_LINK}>
              {m.privacy_link()}
            </Link>
            <Link to="/pedoman" className={PROSE_LINK}>
              {m.guidelines_link()}
            </Link>
          </p>
          <div className="relative z-10 mt-16 flex flex-col items-center gap-6 border-ink/15 border-t pt-12 text-center">
            <div className="font-ui text-ink-muted text-sm">
              {loaderData.credit && (
                <p>{m.about_credit({ credit: loaderData.credit })}</p>
              )}
              <p>{m.about_reviewed({ date: updatedOn(REVIEWED) })}</p>
            </div>
            <ReportButton national={national} variant="highlight" />
          </div>
        </div>
      </section>
    </>
  )
}
