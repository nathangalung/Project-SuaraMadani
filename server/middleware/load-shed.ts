import type { Context, MiddlewareHandler } from "hono"
import { m } from "../../app/paraglide/messages.js"

/** Fast 503 over in-flight cap. */
export function loadShed(
  maxInFlight: number,
  applies: (c: Context) => boolean,
): MiddlewareHandler {
  let inFlight = 0
  return async (c, next) => {
    if (!applies(c)) return next()
    if (inFlight >= maxInFlight) {
      return c.text(m.error_busy_body(), 503, {
        "Retry-After": "5",
        "Cache-Control": "no-store",
      })
    }
    inFlight++
    try {
      await next()
    } finally {
      inFlight--
    }
  }
}
