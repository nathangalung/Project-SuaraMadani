import { m } from "~/paraglide/messages.js"

type Row = { label: string; value: string }

// Sticker card, no links
export function ReportLabel({
  code,
  tenant,
  rows,
}: {
  code: string
  tenant: string
  rows: Row[]
}) {
  return (
    <div className="w-full max-w-md border border-line-subtle bg-surface-raised p-1.5">
      <figure className="border-2 border-ink">
        <figcaption className="flex items-center justify-between gap-3 bg-brand px-4 py-1.5 text-on-accent text-sm">
          <span className="font-bold">{m.report_label_brand()}</span>
          <span>{tenant}</span>
        </figcaption>
        <div className="px-4 pt-3 pb-4">
          <p className="font-ui text-ink-muted text-xs">
            {m.report_label_number()}
          </p>
          <p className="border-ink/40 border-b-2 border-dotted pb-1 font-bold text-[clamp(1.7rem,6vw,2.6rem)] tabular-nums leading-tight tracking-wide">
            {code}
          </p>
          <dl
            className={`mt-3 grid gap-x-4 gap-y-3 ${rows.length > 1 ? "grid-cols-2" : ""}`}
          >
            {rows.map((row) => (
              <div key={row.label}>
                <dt className="font-ui text-ink-muted text-xs">{row.label}</dt>
                <dd className="border-ink/40 border-b-2 border-dotted pb-1 font-semibold">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </figure>
    </div>
  )
}
