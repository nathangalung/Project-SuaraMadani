// ADR-01: one place decides caching
export type CachePolicy = "public" | "private" | "none" | "keep"

export type CacheInput = {
  path: string
  method: string
  status: number
  hasSession: boolean
  setsCookie: boolean
  routeSet: boolean
}

const PRIVATE_PATHS = [
  /^\/lapor(\/|$)/,
  /^\/lacak(\/|$)/,
  /^\/masuk(\/|$)/,
  /^\/isu\/[^/]+\/laporkan(\/|$)/,
  /^\/isu\/[^/]+\/berhenti(\/|$)/,
  /^\/tuntutan\/[^/]+\/laporkan(\/|$)/,
  /^\/tuntutan\/[^/]+\/nilai(\/|$)/,
  /^\/tuntutan\/[^/]+\/berhenti(\/|$)/,
  /^\/aduan(\/|$)/,
  /^\/undangan(\/|$)/,
  /^\/kelola(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/api\//,
  /^\/healthz(\/|$)/,
]

const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?sm\.session_token=/

export function hasSessionCookie(cookie: string | null): boolean {
  return cookie ? SESSION_COOKIE.test(cookie) : false
}

export function cachePolicy(input: CacheInput): CachePolicy {
  if (input.status >= 400) return "none"
  const isRead = input.method === "GET" || input.method === "HEAD"
  if (
    !isRead ||
    input.hasSession ||
    input.setsCookie ||
    PRIVATE_PATHS.some((re) => re.test(input.path))
  ) {
    return "private"
  }
  // 301 means canonical redirect
  if (input.status !== 200 && input.status !== 301) return "none"
  return input.routeSet ? "keep" : "public"
}

export function applyCacheHeaders(
  headers: Headers,
  policy: CachePolicy,
  cdnTtl: number,
): void {
  if (policy === "keep") return
  if (policy === "public") {
    headers.set("Cache-Control", "public, max-age=0, no-transform")
    headers.set(
      "Cloudflare-CDN-Cache-Control",
      `max-age=${cdnTtl}, stale-while-revalidate=30, stale-if-error=86400`,
    )
    return
  }
  headers.delete("Cloudflare-CDN-Cache-Control")
  headers.set(
    "Cache-Control",
    policy === "private" ? "private, no-store" : "no-store",
  )
}
