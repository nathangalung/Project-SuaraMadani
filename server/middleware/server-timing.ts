import type { MiddlewareHandler } from "hono"
import { timed, timingHeader } from "../../db/timing.server.ts"

/** Query count and time. */
export function serverTiming(): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now()
    const [timing] = await timed(next)
    c.res.headers.set(
      "Server-Timing",
      timingHeader(timing, performance.now() - started),
    )
  }
}
