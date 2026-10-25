import { createContext, data, type MiddlewareFunction } from "react-router"
import {
  nationalContext,
  type SessionContext,
  sessionContext,
  type TenantContext,
  tenantContext,
} from "../app/context.ts"
import { requestScope } from "../db/request-scope.ts"
import type { MemberRole } from "../db/schema/auth.ts"
import { getTenantByHost, normalizeHost } from "../db/tenant.server.ts"
import {
  isSuperadmin,
  memberRole,
  readSession,
  type SessionRead,
  STAFF_ROLES,
  staffAccess,
  superadminAccess,
} from "./auth.server.ts"
import { type LogRecord, logPath, securityRecord, writeLog } from "./log.ts"
import { hasSessionCookie } from "./middleware/cache-headers.ts"
import { isTrustedRequest } from "./middleware/csrf.ts"
import { apexHost } from "./origin.server.ts"
import {
  type ForbiddenData,
  nationalShellData,
  shellData,
} from "./shell.server.ts"

export type RootDeps = {
  tenantByHost: (host: string) => Promise<TenantContext | undefined>
  readSession: (headers: Headers) => Promise<SessionRead>
  memberRole: (orgId: string, userId: string) => Promise<MemberRole | null>
  isSuperadmin: (userId: string) => Promise<boolean>
  apexHost: () => string
  now: () => Date
  // Security events, tests capture
  log?: (line: LogRecord) => void
}

export const staffContext = createContext<{ role: MemberRole } | null>(null)
// Set after the /admin gate
export const superadminContext = createContext<boolean>(false)

const STAFF_PATH = /^\/kelola(\/|$)/
// Architecture flow 8: content pages
const APEX_PATHS = new Set([
  "/",
  "/tentang",
  "/privasi",
  "/pedoman",
  "/aksesibilitas",
])
// Platform flag, any campus host
const ADMIN_PATH = /^\/admin(\/|$)/

/** Path React Router matches. */
function routedPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join("/")
    .toLowerCase()
}

/** 403, still renders themed shell. */
function forbidden(
  tenant: TenantContext,
  session: SessionContext | null,
  staff = false,
) {
  const body: ForbiddenData = { shell: shellData(tenant, session), staff }
  return data(body, { status: 403 })
}

/** Sliding session refresh reaches browser. */
function withCookies(response: Response, cookies: string[]): Response {
  // Fetch responses may be immutable
  const copy = new Response(response.body, response)
  for (const cookie of cookies) copy.headers.append("Set-Cookie", cookie)
  return copy
}

/** Tenant, CSRF, session, staff gate. */
export function createRootMiddleware(
  deps: RootDeps,
): MiddlewareFunction<Response> {
  return async ({ request, url, context }, next) => {
    // Host only, never X-Forwarded-Host
    const host = new URL(request.url).host
    if (normalizeHost(host) === deps.apexHost()) {
      // No tenant, session or form
      context.set(nationalContext, true)
      if (!APEX_PATHS.has(routedPath(url.pathname))) {
        const body: ForbiddenData = {
          shell: nationalShellData(deps.now()),
          staff: false,
        }
        throw data(body, { status: 404 })
      }
      return next()
    }
    const tenant = await deps.tenantByHost(host)
    if (!tenant) throw data(null, { status: 404 })
    context.set(tenantContext, tenant)

    const log = deps.log ?? writeLog
    if (!isTrustedRequest(request)) {
      log(securityRecord("csrf_refused", { host, path: logPath(url.pathname) }))
      throw forbidden(tenant, null)
    }
    const refuse = (session: SessionContext | null, staff: boolean) => {
      log(
        securityRecord("staff_refused", {
          host,
          path: logPath(url.pathname),
          user_id: session?.user.id ?? null,
        }),
      )
      return forbidden(tenant, session, staff)
    }

    // Better Auth reads session itself
    const read =
      !url.pathname.startsWith("/api/auth/") &&
      hasSessionCookie(request.headers.get("cookie"))
        ? await deps.readSession(request.headers)
        : null
    const session = read?.session ?? null
    context.set(sessionContext, session)
    // ASVS V16.2.1: who, per request
    const scope = requestScope()
    if (scope && session) scope.userId = session.user.id

    // Routes match decoded, case-insensitive
    const path = routedPath(url.pathname)
    if (ADMIN_PATH.test(path)) {
      const superadmin = session
        ? await deps.isSuperadmin(session.user.id)
        : false
      const allowed =
        session !== null &&
        superadminAccess({
          superadmin,
          user: session.user,
          session: session.session,
          now: deps.now(),
        })
      // Unenrolled superadmin sees enrol link
      if (!allowed) throw refuse(session, superadmin)
      context.set(superadminContext, true)
    }
    if (STAFF_PATH.test(path)) {
      const role = session
        ? await deps.memberRole(tenant.id, session.user.id)
        : null
      const allowed =
        session !== null &&
        staffAccess({
          role,
          user: session.user,
          session: session.session,
          now: deps.now(),
        })
      if (!allowed || !role) {
        const staff = role !== null && STAFF_ROLES.includes(role)
        throw refuse(session, staff)
      }
      context.set(staffContext, { role })
    }
    const response = await next()
    return read?.setCookie.length
      ? withCookies(response, read.setCookie)
      : response
  }
}

export const rootMiddleware = createRootMiddleware({
  tenantByHost: (host) => getTenantByHost(host),
  readSession,
  memberRole: (orgId, userId) => memberRole(orgId, userId),
  isSuperadmin: (userId) => isSuperadmin(userId),
  apexHost,
  now: () => new Date(),
})
