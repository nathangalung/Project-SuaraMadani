import { intakePaused } from "../../../server/intake.server.ts"
import { siteIdentity } from "../../../server/site-identity.server.ts"
import type { TenantContext } from "../../context.ts"

/** /lapor banner facts, item 11. */
export function reportIntake(tenant: TenantContext) {
  return {
    paused: intakePaused(tenant),
    statusHref: siteIdentity(tenant).statusHref ?? null,
  }
}
