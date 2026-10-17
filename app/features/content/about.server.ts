import {
  creditLine,
  officerLines,
} from "../../../server/site-identity.server.ts"
import { DISTRICT_MIN_REPORTS } from "../../../shared/report-fields.ts"
import type { TenantContext } from "../../context.ts"

/** Loader facts, server only. */
export function aboutFacts(tenant: TenantContext | null) {
  return {
    credit: tenant ? creditLine(tenant) : undefined,
    officers: tenant ? officerLines(tenant) : [],
    districtMin: String(DISTRICT_MIN_REPORTS),
  }
}
