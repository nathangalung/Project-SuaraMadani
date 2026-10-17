import type { TimelineEntry } from "~/features/issues/timeline"
import { m } from "~/paraglide/messages.js"
import type { DemandEvent } from "./demands.server"
import { FULFILMENT_TEXT, RESPONSE_TEXT } from "./labels"

// Dates are days, noon WIB
function dayOf(iso: string): Date {
  return new Date(`${iso}T05:00:00Z`)
}

/** Source line, link kept separate. */
export function sourceLine(event: Pick<DemandEvent, "sourceText">): string {
  return event.sourceText ? m.demand_source({ source: event.sourceText }) : ""
}

function title(event: DemandEvent): string {
  const n = String(event.item ?? "")
  switch (event.action) {
    case "publish":
      return m.demand_event_publish()
    case "close":
      return m.demand_event_close()
    case "reopen":
      return m.demand_event_reopen()
    case "status":
      return m.demand_event_status({ n })
    case "note":
      return m.demand_event_note({ n })
    case "brief":
      return m.demand_event_brief({ n })
    case "brief_withdraw":
      return m.demand_event_brief_withdraw({ n })
  }
}

/** Stored rows to timeline text. */
export function demandHistory(
  events: DemandEvent[],
  actor: string,
): TimelineEntry[] {
  return events.map((event) => ({
    id: event.id,
    at: dayOf(event.occurredOn),
    title: title(event),
    href: event.item == null ? undefined : `#sub-${event.item}`,
    actor,
    // Sub-tuntutan shows its own text
    body:
      event.item == null
        ? [event.note, sourceLine(event)].filter(Boolean).join("\n") ||
          undefined
        : undefined,
    status:
      event.action === "status" && event.response && event.fulfilment
        ? m.demand_event_status_to({
            status: `${RESPONSE_TEXT[event.response]()} · ${FULFILMENT_TEXT[event.fulfilment]()}`,
          })
        : undefined,
    tone:
      event.action === "publish"
        ? "brand"
        : event.fulfilment === "fulfilled"
          ? "success"
          : "ink",
  }))
}
