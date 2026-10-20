import type { TenantContext } from "../app/context.ts"

export type SiteIdentity = {
  operator: string
  campus: string
  alliance?: string
  legalNumber?: string
  contactEmail?: string
  statusHref?: string
}

const MAX_TEXT = 120
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i

// Settings are untrusted jsonb
function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= MAX_TEXT ? trimmed : undefined
}

function email(value: unknown): string | undefined {
  const found = text(value)
  return found && EMAIL.test(found) ? found : undefined
}

// Https only, no script URLs
function httpsUrl(value: unknown): string | undefined {
  const found = text(value)
  if (!found) return undefined
  try {
    const url = new URL(found)
    return url.protocol === "https:" ? url.href : undefined
  } catch {
    return undefined
  }
}

/** Footer facts the org has. */
export function siteIdentity(
  tenant: Pick<
    TenantContext,
    "name" | "campusName" | "contactEmail" | "settings"
  >,
): SiteIdentity {
  return {
    operator: tenant.name,
    campus: tenant.campusName,
    alliance: text(tenant.settings.alliance),
    legalNumber: text(tenant.settings.legalNumber),
    contactEmail: email(tenant.contactEmail),
    statusHref: httpsUrl(tenant.settings.statusUrl),
  }
}

/** About page only, not shell. */
export function creditLine(
  tenant: Pick<TenantContext, "settings">,
): string | undefined {
  return text(tenant.settings.credit)
}
