import type { CSSProperties } from "react"
import { Link } from "react-router"
import { BoxedHeading } from "~/components/layout/boxed-heading"
import { useStagger } from "~/components/layout/use-reveal"
import type { DigestDemand } from "~/features/demands/digest.server"
import { demandPlace, FULFILMENT_TEXT } from "~/features/demands/labels"
import { m } from "~/paraglide/messages.js"

// Starting Values: subs per card
const HOME_SUBS = 3

// Plain text card, no ornaments
function DemandCard({
  demand,
  index,
  scored,
}: {
  demand: DigestDemand
  index: number
  scored: boolean
}) {
  return (
    <li
      style={{ "--i": index } as CSSProperties}
      className="group relative flex min-h-52 w-full flex-col rounded-lg bg-surface-raised p-5 sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)] font-ui text-ink has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-highlight has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-solid"
    >
      {/* Order comes from ol */}
      <span
        aria-hidden="true"
        className="font-bold text-2xl text-accent tabular-nums"
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <h4 className="mt-2 font-bold font-ui text-xl leading-snug">
        <Link
          to={`/tuntutan/${demand.code}`}
          className="decoration-2 underline-offset-4 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-hover:underline"
        >
          {demand.title}
        </Link>
      </h4>
      <p className="mt-1 text-ink-muted text-sm">
        {[demandPlace(demand), demand.categoryText].filter(Boolean).join(" · ")}
      </p>
      <Subs demand={demand} />
      <div className="mt-auto pt-5 text-sm">
        <p className="border-line-subtle border-t pt-3">
          {m.demand_progress_line({
            done: demand.progress.fulfilled,
            total: demand.progress.total,
          })}
        </p>
        {/* Server text, see toDigest */}
        {scored && demand.importanceText ? (
          <p className="mt-1 font-semibold">{demand.importanceText}</p>
        ) : null}
      </div>
    </li>
  )
}

// Lettered like a demand letter
function Subs({ demand }: { demand: DigestDemand }) {
  const more = demand.subs.length - HOME_SUBS
  return (
    <>
      <ol className="mt-4 flex flex-col gap-2 text-sm leading-snug">
        {demand.subs.slice(0, HOME_SUBS).map((body, index) => {
          const status = demand.marks[index] ?? "not_fulfilled"
          return (
            <li key={body} className="flex gap-2">
              <span aria-hidden="true" className="w-4 shrink-0 text-ink-muted">
                {`${String.fromCharCode(97 + index)}.`}
              </span>
              <span>
                <span className="line-clamp-2">{body}</span>
                {/* Waiting needs no word */}
                {status === "not_fulfilled" ? null : (
                  <span className="font-semibold">
                    {FULFILMENT_TEXT[status]()}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      {more > 0 ? (
        <p className="mt-2 text-ink-muted text-sm">
          {m.home_demand_more_subs({ count: more })}
        </p>
      ) : null}
    </>
  )
}

function DemandRow({
  id,
  title,
  demands,
  scored = false,
}: {
  id: string
  title: string
  demands: DigestDemand[]
  scored?: boolean
}) {
  const list = useStagger<HTMLOListElement>()
  // Partial rows centre, like showcase
  return (
    <div className="mx-auto mt-10 max-w-6xl">
      <h3
        id={id}
        className="text-center font-bold font-ui text-2xl text-on-accent"
      >
        {title}
      </h3>
      <ol
        ref={list}
        aria-labelledby={id}
        className="mt-5 flex flex-wrap justify-center gap-4"
      >
        {demands.map((demand, index) => (
          <DemandCard
            key={demand.code}
            demand={demand}
            index={index}
            scored={scored}
          />
        ))}
      </ol>
    </div>
  )
}

// First after hero, on band
export function DemandStrip({
  latest,
  important,
}: {
  latest: DigestDemand[]
  important: DigestDemand[]
}) {
  if (latest.length === 0 && important.length === 0) return null
  return (
    <section
      aria-labelledby="tuntutan-terbaru"
      className="relative px-6 pt-[clamp(1rem,4vw,3rem)] pb-[clamp(4rem,9vw,7rem)] sm:px-10"
    >
      <BoxedHeading id="tuntutan-terbaru" tone="ink">
        {m.home_demands_title()}
      </BoxedHeading>
      {important.length > 0 ? (
        <DemandRow
          id="tuntutan-penting"
          title={m.home_demands_important()}
          demands={important}
          scored
        />
      ) : null}
      {latest.length > 0 ? (
        <DemandRow
          id="tuntutan-baru"
          title={m.home_demands_latest()}
          demands={latest}
        />
      ) : null}
      <p className="mt-10 text-center">
        <Link
          to="/tuntutan"
          className="font-semibold font-ui text-lg text-on-accent underline underline-offset-4 hover:no-underline"
        >
          {m.data_demands_all()}
        </Link>
      </p>
    </section>
  )
}
