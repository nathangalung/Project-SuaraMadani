const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/** Origin must match tenant origin. */
export function isTrustedRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return true
  const origin = request.headers.get("origin")
  if (origin !== null) return origin === new URL(request.url).origin
  return request.headers.get("sec-fetch-site") === "same-origin"
}
