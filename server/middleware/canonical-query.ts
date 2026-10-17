import type { Context, MiddlewareHandler } from "hono"
import {
  canonicalizeSearch,
  querySpecFor,
} from "../../shared/canonical-query.ts"

/** 301 before DB, relative Location. */
export function canonicalQuery(
  finish: (c: Context, response: Response) => Response,
): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method
    const url = new URL(c.req.url)
    if ((method !== "GET" && method !== "HEAD") || !url.search) return next()
    const spec = querySpecFor(url.pathname)
    if (!spec) return next()
    const result = canonicalizeSearch(url.search, spec)
    if (!result.changed) return next()
    const response = new Response(null, {
      status: 301,
      headers: { Location: `${url.pathname}${result.search}` },
    })
    return finish(c, response)
  }
}
