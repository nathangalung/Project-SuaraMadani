import { m } from "~/paraglide/messages.js"

// Not a government site
export function Masthead() {
  return (
    <section
      aria-label={m.masthead_label()}
      className="bg-ink font-ui text-sm text-surface"
    >
      <div className="mx-auto max-w-7xl px-4 py-1.5 sm:px-8">
        <details className="group">
          <summary className="cursor-pointer list-none py-1 [&::-webkit-details-marker]:hidden">
            <span>{m.masthead_statement()}</span>{" "}
            <span className="whitespace-nowrap underline underline-offset-4">
              {m.masthead_toggle()}
            </span>
          </summary>
          <div className="flex max-w-3xl flex-col gap-2 pt-2 pb-3">
            <p>{m.masthead_domain()}</p>
            <p>{m.masthead_operator()}</p>
          </div>
        </details>
      </div>
    </section>
  )
}
