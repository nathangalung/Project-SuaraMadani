import type { SessionContext, TenantContext } from "../app/context.ts"
import { m } from "../app/paraglide/messages.js"
import { jakartaYear } from "../shared/format.ts"
import { accountLabel } from "../shared/phone.ts"
import { isSuperadmin, memberRole, STAFF_ROLES } from "./auth.server.ts"
import { globalIntakePause, intakePaused } from "./intake.server.ts"
import { siteIdentity } from "./site-identity.server.ts"
import {
  brandAssets,
  headingFont,
  themeColor,
  themeStyle,
} from "./theme.server.ts"

/** Root layout data, also 403. */
export function shellData(
  tenant: TenantContext,
  session: SessionContext | null,
  now = new Date(),
  globalPause = globalIntakePause(),
) {
  return {
    national: false,
    // Validated, styles.css holds defaults
    themeCss: themeStyle(tenant.theme),
    themeColor: themeColor(tenant.theme),
    headingFont: headingFont(tenant.theme),
    siteName: tenant.name,
    // Header logo and nav star
    brandAssets: brandAssets(tenant.theme),
    // Uploaded at /kelola/pengaturan
    logoSrc: tenant.logoHash ? `/logo/${tenant.logoHash}.webp` : null,
    intakePaused: intakePaused(tenant, globalPause),
    identity: siteIdentity(tenant),
    year: jakartaYear(now),
    user: session
      ? { email: accountLabel(session.user), manage: false, platform: false }
      : null,
  }
}

/** Header links, middleware still gates. */
export async function staffLinks(
  orgId: string,
  userId: string,
): Promise<{ manage: boolean; platform: boolean }> {
  const [role, platform] = await Promise.all([
    memberRole(orgId, userId),
    isSuperadmin(userId),
  ])
  return { manage: role !== null && STAFF_ROLES.includes(role), platform }
}

export type ShellData = ReturnType<typeof shellData>

/** Apex: platform theme, no account. */
export function nationalShellData(now = new Date()): ShellData {
  return {
    national: true,
    themeCss: themeStyle({}),
    themeColor: themeColor({}),
    headingFont: headingFont({}),
    siteName: m.national_site_name(),
    brandAssets: brandAssets({}),
    logoSrc: null,
    intakePaused: false,
    identity: { operator: m.national_operator(), campus: "" },
    year: jakartaYear(now),
    user: null,
  }
}

// Middleware 403 payload
export type ForbiddenData = { shell: ShellData; staff: boolean }
