import { CirclePause } from "lucide-react"
import { m } from "~/paraglide/messages.js"

// Item 11, not on /lapor
export function IntakeBanner({ statusHref }: { statusHref?: string }) {
  return (
    <section
      aria-label={m.intake_banner_label()}
      className="border-ink border-b-2 bg-highlight font-ui text-ink text-sm"
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-2.5 sm:px-8">
        <CirclePause aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p className="leading-relaxed">
          <strong className="font-semibold">{m.intake_banner_title()}</strong>{" "}
          {m.intake_banner_body()}
          {statusHref ? (
            <>
              {" "}
              <a
                href={statusHref}
                className="whitespace-nowrap font-semibold underline underline-offset-4 hover:decoration-2"
              >
                {m.intake_banner_status()}
              </a>
            </>
          ) : null}
        </p>
      </div>
    </section>
  )
}
