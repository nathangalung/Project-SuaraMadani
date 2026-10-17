import { m } from "~/paraglide/messages.js"
import { formatIsoDate } from "../../../shared/format.ts"
import type { DemandItemState } from "../../../shared/status.ts"
import { sourceLine } from "./demand-history"
import { FULFILMENT_TEXT, RESPONSE_TEXT } from "./labels"

const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"

export type ItemUpdate = {
  id: string
  action: string
  occurredOn: string
  note: string | null
  sourceText: string | null
  sourceUrl: string | null
  response: DemandItemState["response"] | null
  fulfilment: DemandItemState["fulfilment"] | null
}

/** Item updates, newest first. */
export function ItemUpdates({
  updates,
  actor,
  withStatus = false,
}: {
  updates: readonly ItemUpdate[]
  actor?: string
  // Status each update recorded
  withStatus?: boolean
}) {
  const shown = updates.filter((update) => update.action !== "brief")
  if (shown.length === 0) {
    return (
      <p className="mt-2 font-ui text-ink-muted text-sm">
        {m.demand_no_action()}
      </p>
    )
  }
  return (
    <ol className="mt-2 space-y-3">
      {shown.map((update) => (
        <li key={update.id} className="border-line-subtle border-l-2 pl-3">
          <p className="font-ui text-ink-muted text-sm">
            <time dateTime={update.occurredOn}>
              {formatIsoDate(update.occurredOn)}
            </time>
            {actor ? ` · ${actor}` : null}
          </p>
          {withStatus && update.response && update.fulfilment ? (
            <p className="mt-0.5 font-semibold font-ui text-sm">
              {RESPONSE_TEXT[update.response]()} ·{" "}
              {FULFILMENT_TEXT[update.fulfilment]()}
            </p>
          ) : null}
          {update.note ? (
            <p className="mt-0.5 whitespace-pre-line text-ink-soft">
              {update.note}
            </p>
          ) : null}
          <p className="mt-0.5 font-ui text-sm">
            {sourceLine(update)}
            {update.sourceUrl ? (
              <>
                {" "}
                <a
                  href={update.sourceUrl}
                  rel="noopener noreferrer nofollow"
                  className={LINK}
                >
                  {m.demand_source_link()}
                </a>
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ol>
  )
}
