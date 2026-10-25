import type { Context, MiddlewareHandler } from "hono"

type RateLimitOptions = {
  max: number
  windowMs: number
  key: (c: Context) => string
  now?: () => number
}

/** Fixed window per key. */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const now = options.now ?? Date.now
  let windowStart = 0
  // Cleared every window, bounded
  let counts = new Map<string, number>()
  return async (c, next) => {
    const t = now()
    const start = t - (t % options.windowMs)
    if (start !== windowStart) {
      windowStart = start
      counts = new Map()
    }
    const key = options.key(c)
    const used = counts.get(key) ?? 0
    if (used >= options.max) {
      const wait = Math.ceil((start + options.windowMs - t) / 1000)
      return c.json({ error: "rate_limited" }, 429, {
        "Retry-After": String(Math.max(1, wait)),
        "Cache-Control": "no-store",
      })
    }
    counts.set(key, used + 1)
    return next()
  }
}
