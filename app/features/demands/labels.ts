import { m } from "~/paraglide/messages.js"
import type { DemandScope } from "../../../shared/demands.ts"
import type {
  DemandState,
  FulfilmentStatus,
  ResponseStatus,
} from "../../../shared/status.ts"

type Text = () => string

export const RESPONSE_TEXT: Record<ResponseStatus, Text> = {
  not_responded: m.demand_response_not_responded,
  responded: m.demand_response_responded,
}

export const FULFILMENT_TEXT: Record<FulfilmentStatus, Text> = {
  not_fulfilled: m.demand_fulfilment_not_fulfilled,
  partially_fulfilled: m.demand_fulfilment_partially_fulfilled,
  fulfilled: m.demand_fulfilment_fulfilled,
  rejected: m.demand_fulfilment_rejected,
}

export const STATE_TEXT: Record<DemandState, Text> = {
  draft: m.demand_state_draft,
  published: m.demand_state_published,
  closed: m.demand_state_closed,
}

export const SCOPE_TEXT: Record<DemandScope, Text> = {
  national: m.demand_scope_national,
  regional: m.demand_scope_regional,
}

/** Place line: national or region. */
export function demandPlace(demand: {
  scope: DemandScope
  provinceName: string | null
  regencyName: string | null
}): string {
  if (demand.scope === "national") return m.demand_scope_national()
  const region = [demand.regencyName, demand.provinceName]
    .filter((part) => part !== null)
    .join(", ")
  return region
    ? `${m.demand_scope_regional()} · ${region}`
    : m.demand_scope_regional()
}
