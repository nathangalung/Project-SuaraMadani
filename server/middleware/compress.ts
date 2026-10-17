import type { MiddlewareHandler } from "hono"

// Smaller bodies gain nothing
const MIN_BYTES = 1024
const COMPRESSIBLE = /^(?:text\/|application\/json\b)/
const NO_TRANSFORM = /(?:^|,)\s*no-transform\s*(?:,|$)/i

/** Honours q=0 and wildcard. */
function acceptsGzip(header: string | null): boolean {
  let wildcard = false
  for (const part of (header ?? "").split(",")) {
    const [name = "", ...params] = part.split(";").map((s) => s.trim())
    const q = params.find((p) => p.toLowerCase().startsWith("q="))
    const allowed = q === undefined || Number(q.slice(2)) > 0
    const coding = name.toLowerCase()
    if (coding === "gzip") return allowed
    if (coding === "*") wildcard = allowed
  }
  return wildcard
}

/** Edge may not, origin gzips. */
export function originGzip(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const res = c.res
    const type = res.headers.get("Content-Type") ?? ""
    if (
      !res.body ||
      res.headers.has("Content-Encoding") ||
      !NO_TRANSFORM.test(res.headers.get("Cache-Control") ?? "") ||
      !COMPRESSIBLE.test(type)
    ) {
      return
    }
    res.headers.append("Vary", "Accept-Encoding")
    if (!acceptsGzip(c.req.header("accept-encoding") ?? null)) return
    const body = new Uint8Array(await res.arrayBuffer())
    if (body.byteLength < MIN_BYTES) {
      c.res = new Response(body, res)
      return
    }
    // Hono copies old headers over
    res.headers.delete("Content-Length")
    res.headers.set("Content-Encoding", "gzip")
    c.res = new Response(Bun.gzipSync(body), res)
  }
}
