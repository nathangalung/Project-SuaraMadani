import type { MiddlewareHandler } from "hono"

const NON_PAGE_CSP = "default-src 'none'; frame-ancestors 'none'"

/** Static headers, pages set CSP. */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const headers = c.res.headers
    headers.set("X-Content-Type-Options", "nosniff")
    // Token pages send no-referrer
    if (!headers.has("Referrer-Policy")) {
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
    }
    headers.set(
      "Permissions-Policy",
      "geolocation=(self), camera=(), microphone=(), payment=()",
    )
    if (!headers.has("Content-Security-Policy")) {
      headers.set("Content-Security-Policy", NON_PAGE_CSP)
    }
    // Short until hosts are verified
    if (new URL(c.req.url).protocol === "https:") {
      headers.set("Strict-Transport-Security", "max-age=300")
    }
  }
}
