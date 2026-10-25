import { data, type RouterContextProvider } from "react-router"
import {
  type LogRecord,
  securityRecord,
  writeLog,
} from "../../../server/log.ts"
import { staffContext } from "../../../server/request-context.server.ts"
import {
  type SessionContext,
  sessionContext,
  type TenantContext,
  tenantContext,
} from "../../context.ts"

export type Admin = {
  tenant: TenantContext
  session: SessionContext
  role: "admin"
}

/** Admin, after root staff gate. */
export async function requireAdmin(
  context: Readonly<RouterContextProvider>,
  log: (line: LogRecord) => void = writeLog,
): Promise<Admin> {
  const tenant = context.get(tenantContext)
  const session = context.get(sessionContext)
  // Set only after staffAccess passed
  const role = context.get(staffContext)?.role
  if (!session || role !== "admin") {
    // ASVS V16.3.2: failed authorization
    log(
      securityRecord("staff_refused", {
        host: tenant.host,
        need: "admin",
        role: role ?? null,
        user_id: session?.user.id ?? null,
      }),
    )
    throw data(null, { status: 403 })
  }
  return { tenant, session, role }
}
