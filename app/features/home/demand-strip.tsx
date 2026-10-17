import { Link } from "react-router"
import { BoxedHeading } from "~/components/layout/boxed-heading"
import { DemandDigest } from "~/features/demands/demand-digest"
import type { LatestDemand } from "~/features/demands/demands.server"
import { m } from "~/paraglide/messages.js"

// None published: no section
export function DemandStrip({ demands }: { demands: LatestDemand[] }) {
  if (demands.length === 0) return null
  return (
    <section
      aria-labelledby="tuntutan-terbaru"
      className="px-6 py-14 sm:px-10 lg:py-20"
    >
      <BoxedHeading id="tuntutan-terbaru" tone="ink">
        {m.home_demands_title()}
      </BoxedHeading>
      <p className="mx-auto mt-4 max-w-2xl text-center text-ink text-lg leading-relaxed">
        {m.home_demands_rule()}
      </p>
      <div className="mx-auto mt-10 max-w-4xl border-ink border-t-2 bg-surface-raised px-5 sm:px-8">
        <DemandDigest demands={demands} ruled={false} />
      </div>
      <p className="mt-10 text-center">
        <Link
          to="/tuntutan"
          className="font-semibold text-accent underline underline-offset-4 hover:no-underline"
        >
          {m.data_demands_all()}
        </Link>
      </p>
    </section>
  )
}
