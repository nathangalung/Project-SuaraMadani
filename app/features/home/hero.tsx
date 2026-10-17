import { Search } from "lucide-react"
import { Form, Link } from "react-router"
import { Button, ButtonLink } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { cn } from "~/components/ui/cn"
import { controlClass } from "~/components/ui/control"
import { m } from "~/paraglide/messages.js"
import { HomeGraphic } from "./home-graphic"

// Scroll motion only with graphic
export function Hero({ graphic }: { graphic: boolean }) {
  return (
    <section
      aria-labelledby="beranda-judul"
      className={cn("relative isolate w-full", graphic && "hero-scroll")}
    >
      <div className="hero-stage relative overflow-hidden">
        <div
          aria-hidden="true"
          className="hero-bg absolute inset-0 -z-10 [mask-image:linear-gradient(180deg,#000_50%,rgba(0,0,0,0.6)_75%,transparent_98%)]"
        >
          <div className="absolute inset-0 bg-hero" />
        </div>
        <div
          className={cn(
            "mx-auto grid min-h-[calc(100svh-5rem)] max-w-7xl items-center gap-6 px-5 pt-5 pb-20 sm:px-8 sm:pt-10 lg:min-h-[calc(100svh-6rem)] lg:pb-28",
            graphic && "lg:grid-cols-[1.35fr_1fr]",
          )}
        >
          <div
            className={cn(
              "hero-text relative z-10",
              !graphic && "mx-auto w-full max-w-3xl",
            )}
          >
            {/* Display faces keep their weight */}
            <h1
              id="beranda-judul"
              className="font-bold font-heading text-[clamp(1.9rem,3.35vw,2.65rem)] text-on-accent leading-[1.35] [font-synthesis-weight:none] focus-visible:outline-focus sm:leading-[1.42]"
            >
              <span className="highlight-box bg-pop">
                {m.home_title_line1()}
              </span>{" "}
              <br />
              <span className="highlight-box bg-pop">
                {m.home_title_line2()}
              </span>
            </h1>
            <p className="mt-4 max-w-xl font-medium text-base text-ink leading-snug sm:mt-6 sm:text-[clamp(1.1rem,1.9vw,1.45rem)]">
              {m.home_lead()}
            </p>
            {/* Hidden once scrolled, see styles */}
            <div className="hero-actions mt-5 max-w-xl sm:mt-8">
              <Form
                method="get"
                action="/isu"
                role="search"
                className="focus-light border border-line-subtle bg-surface-raised p-4 sm:p-6"
              >
                <label htmlFor="beranda-q" className="font-semibold">
                  {m.issues_search_label()}
                </label>
                <p
                  id="beranda-q-hint"
                  className="mt-1 font-ui text-[0.95rem] text-ink-muted"
                >
                  {m.issues_search_hint()}
                </p>
                <div className="mt-3 flex gap-3">
                  <div className="relative min-w-0 flex-1">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-ink/60"
                    />
                    <input
                      id="beranda-q"
                      name="q"
                      type="search"
                      enterKeyHint="search"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      aria-describedby="beranda-q-hint"
                      className={cn(controlClass, "h-13 w-full pl-11")}
                    />
                  </div>
                  <Button type="submit" size="lg">
                    {m.home_search_submit()}
                  </Button>
                </div>
              </Form>
              <Card variant="inverse" className="mt-3 p-4 sm:mt-4 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
                  {/* Ink hover needs visible edge */}
                  <ButtonLink
                    to="/lapor"
                    variant="highlight"
                    size="lg"
                    className="hover:border-highlight"
                  >
                    {m.report_start()}
                  </ButtonLink>
                  <p className="font-ui">{m.home_eligibility()}</p>
                </div>
                <Link
                  to="/lacak"
                  className="mt-3 inline-block font-semibold underline underline-offset-4 hover:no-underline"
                >
                  {m.nav_track()}
                </Link>
              </Card>
            </div>
          </div>
          {graphic && (
            <div className="hidden w-full max-w-[30rem] justify-self-end lg:block">
              <div className="hero-graphic">
                <div className="hero-graphic-fade">
                  <HomeGraphic />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
