import type { MiddlewareHandler } from "hono"
import { inRequestScope, type RequestScope } from "../../db/request-scope.ts"
import { type LogRecord, logPath } from "../log.ts"

/** Path only, queries hold searches. */
export function requestLog(
  write: (line: LogRecord) => void,
): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now()
    // Root middleware adds the account
    const scope: RequestScope = { reqId: c.get("requestId") }
    // Before the URL rewrite
    const { signal } = c.req.raw
    try {
      await inRequestScope(scope, next)
    } finally {
      write({
        msg: "request",
        req_id: scope.reqId,
        method: c.req.method,
        // Tenant, never the query
        host: new URL(c.req.url).host,
        path: logPath(c.req.path),
        // Client gone: nginx 499
        status: signal.aborted ? 499 : c.res.status,
        dur_ms: Math.round(performance.now() - started),
        user_id: scope.userId ?? null,
      })
    }
  }
}
