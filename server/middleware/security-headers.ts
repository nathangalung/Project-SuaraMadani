import type { MiddlewareHandler } from "hono"

const NON_PAGE_CSP = "default-src 'none'; frame-ancestors 'none'"
// Staged until hosts are verified
const DEFAULT_HSTS = "max-age=300"
const HSTS_POLICY = /^max-age=\d{1,9}(?:; includeSubDomains)?(?:; preload)?$/
// ASVS V4.1.1: text, xml types
const NEEDS_CHARSET = /^(?:text\/[^;]+|[^;]+[/+]xml)\s*(?:;|$)/i

/** Malformed policy fails boot. */
export function hstsPolicy(value: string | undefined): string {
  if (!value) return DEFAULT_HSTS
  if (!HSTS_POLICY.test(value)) throw new Error(`HSTS_POLICY invalid: ${value}`)
  return value
}

function withCharset(type: string | null): string | null {
  if (!type || !NEEDS_CHARSET.test(type) || /;\s*charset=/i.test(type)) {
    return null
  }
  return `${type}; charset=utf-8`
}

/** Static headers, pages set CSP. */
export function applySecurityHeaders(
  headers: Headers,
  url: string,
  hsts = DEFAULT_HSTS,
): void {
  headers.set("X-Content-Type-Options", "nosniff")
  // Token pages send no-referrer
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  }
  headers.set(
    "Permissions-Policy",
    "geolocation=(self), camera=(), microphone=(), payment=()",
  )
  const csp = headers.get("Content-Security-Policy")
  if (!csp) headers.set("Content-Security-Policy", NON_PAGE_CSP)
  else if (!/(?:^|;)\s*frame-ancestors\b/i.test(csp)) {
    headers.set("Content-Security-Policy", `${csp}; frame-ancestors 'none'`)
  }
  const charset = withCharset(headers.get("Content-Type"))
  if (charset) headers.set("Content-Type", charset)
  if (new URL(url).protocol === "https:") {
    headers.set("Strict-Transport-Security", hsts)
  }
}

/** Every response, after handlers. */
export function securityHeaders(hsts = DEFAULT_HSTS): MiddlewareHandler {
  return async (c, next) => {
    await next()
    applySecurityHeaders(c.res.headers, c.req.url, hsts)
  }
}
