import {
  canonicalizeSearch,
  DEMAND_LIST_QUERY,
} from "../../../shared/canonical-query.ts"
import type { DemandListQuery } from "./demands.server"

/** Canonical order, no 301. */
export function demandsHref(query: DemandListQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value)
  }
  return `/tuntutan${canonicalizeSearch(`?${params}`, DEMAND_LIST_QUERY).search}`
}

/** Brief link, published demands only. */
export function briefUrl(code: string, briefId: string): string {
  return `/tuntutan/${code}/dokumen/${briefId}.pdf`
}
