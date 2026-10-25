import type { CSSProperties } from "react"
import { Link } from "react-router"
import { BoxedHeading } from "~/components/layout/boxed-heading"
import { useStagger } from "~/components/layout/use-reveal"
import type { DigestDemand } from "~/features/demands/digest.server"
import { FulfilmentMark } from "~/features/demands/status-mark"
import { m } from "~/paraglide/messages.js"

// Title and status only
function DemandCard({
  demand,
  index,
}: {
  demand: DigestDemand
  index: number
}) {
  return (
    <li
      style={{ "--i": index } as CSSProperties}
      className="group relative flex w-full flex-col gap-3 rounded-2xl bg-surface-raised p-6 text-ink sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)] has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-highlight has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-solid"
    >
      {/* Order comes from ol */}
      <span
        aria-hidden="true"
        className="font-heading text-2xl text-accent tabular-nums"
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <h4 className="font-bold text-xl leading-snug">
        <Link
          to={`/tuntutan/${demand.code}`}
          className="decoration-2 underline-offset-4 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-hover:underline"
        >
          {demand.title}
        </Link>
      </h4>
      <p className="mt-auto pt-2">
        <FulfilmentMark status={demand.progress.status} />
      </p>
    </li>
  )
}

function DemandRow({
  id,
  title,
  demands,
}: {
  id: string
  title: string
  demands: DigestDemand[]
}) {
  const list = useStagger<HTMLOListElement>()
  // Partial rows centre, like showcase
  return (
    <div className="mx-auto mt-10 max-w-6xl">
      <h3
        id={id}
        className="text-center font-bold font-heading text-2xl text-on-accent"
      >
        {title}
      </h3>
      <ol
        ref={list}
        aria-labelledby={id}
        className="mt-5 flex flex-wrap justify-center gap-4"
      >
        {demands.map((demand, index) => (
          <DemandCard key={demand.code} demand={demand} index={index} />
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
          className="font-semibold text-lg text-on-accent underline underline-offset-4 hover:no-underline"
        >
          {m.data_demands_all()}
        </Link>
      </p>
    </section>
  )
}
