import type { MiddlewareHandler } from "hono"
import type { LogRecord } from "../log.ts"

/** Path only, queries hold searches. */
export function requestLog(
  write: (line: LogRecord) => void,
): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now()
    try {
      await next()
    } finally {
      write({
        msg: "request",
        req_id: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        dur_ms: Math.round(performance.now() - started),
      })
    }
  }
}
