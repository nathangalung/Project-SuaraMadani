import { stat } from "node:fs/promises"
import { join } from "node:path"
import { type Context, Hono, type MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"
import { type RequestIdVariables, requestId } from "hono/request-id"
import { serveStatic } from "hono/serve-static"
import { m } from "../app/paraglide/messages.js"
import { normalizeHost } from "../db/tenant.server.ts"
import { BRIEF_MAX_BYTES } from "../shared/demands.ts"
import { EVIDENCE_LIMITS } from "../shared/report-fields.ts"
import type { HealthChecks } from "./health.ts"
import { type LogRecord, writeLog } from "./log.ts"
import {
  applyCacheHeaders,
  cachePolicy,
  hasSessionCookie,
} from "./middleware/cache-headers.ts"
import { canonicalQuery } from "./middleware/canonical-query.ts"
import { originGzip } from "./middleware/compress.ts"
import { loadShed } from "./middleware/load-shed.ts"
import { requestLog } from "./middleware/request-log.ts"
import { securityHeaders } from "./middleware/security-headers.ts"

export type AppOptions = {
  handleDocument: (request: Request) => Promise<Response>
  health: HealthChecks
  // Image git sha, deploy check
  sha?: string
  clientDir?: string
  cdnTtl?: number
  maxInFlight?: number
  maxUploadsInFlight?: number
  log?: (line: LogRecord) => void
}

type Env = { Variables: RequestIdVariables }

const immutable = "public, max-age=31536000, immutable"
const UPLOAD_PATH =
  /^\/api\/upload\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

// Twice the step-7 JSON cap
export const MAX_FORM_BODY = 128 * 1024

/** Bun.serve options, index.ts spreads. */
export const SERVE_LIMITS = {
  // Above Caddy keepalive (25 s)
  idleTimeout: 60,
  // Largest upload plus headroom
  maxRequestBodySize: EVIDENCE_LIMITS.video + 1024 * 1024,
}

/** Streams to disk, own limits. */
function isUpload(c: Context): boolean {
  return c.req.method === "POST" && UPLOAD_PATH.test(c.req.path)
}

// Staff policy brief, multipart
const BRIEF_UPLOAD_PATH = /^\/kelola\/tuntutan\/[^/]+\/unggah$/
export const MAX_BRIEF_BODY = BRIEF_MAX_BYTES + 64 * 1024

function isBriefUpload(c: Context): boolean {
  return c.req.method === "POST" && BRIEF_UPLOAD_PATH.test(c.req.path)
}

/** Better Auth hosts are exact. */
function canonicalHost(): MiddlewareHandler {
  return async (c, next) => {
    const raw = c.req.raw.headers.get("host") ?? new URL(c.req.url).host
    if (normalizeHost(raw) !== raw) {
      return c.body(null, 404, { "Cache-Control": "no-store" })
    }
    return next()
  }
}
const CF_RAY = /^[0-9a-f]{16}-[A-Z]{3}$/

// Bun file lookup for Hono
function staticFrom(root: string, cacheControl: string): MiddlewareHandler {
  return serveStatic({
    root,
    join,
    getContent: async (path) => {
      const file = Bun.file(path)
      return (await file.exists()) ? file : null
    },
    isDir: async (path) => {
      try {
        return (await stat(path)).isDirectory()
      } catch {
        return false
      }
    },
    onFound: (_path, c) => {
      c.header("Cache-Control", cacheControl)
    },
  })
}

/** Caddy overwrites X-Forwarded-Proto. */
function publicRequest(request: Request): Request {
  if (request.headers.get("x-forwarded-proto") !== "https") return request
  const url = new URL(request.url)
  if (url.protocol === "https:") return request
  url.protocol = "https:"
  return new Request(url, request)
}

function withCacheHeaders(
  c: Context,
  response: Response,
  cdnTtl: number,
): Response {
  // Fetch responses may be immutable
  const res = new Response(response.body, response)
  const policy = cachePolicy({
    path: c.req.path,
    method: c.req.method,
    status: res.status,
    hasSession: hasSessionCookie(c.req.header("cookie") ?? null),
    setsCookie: res.headers.has("Set-Cookie"),
    routeSet: res.headers.has("Cache-Control"),
  })
  applyCacheHeaders(res.headers, policy, cdnTtl)
  return res
}

export function createApp(options: AppOptions): Hono<Env> {
  const cdnTtl = options.cdnTtl ?? 60
  const app = new Hono<Env>()

  app.use(
    requestId({
      headerName: "",
      generator: (c) => {
        const ray = c.req.header("cf-ray")
        return ray && CF_RAY.test(ray) ? ray : crypto.randomUUID()
      },
    }),
  )
  app.use(requestLog(options.log ?? writeLog))
  app.use(securityHeaders())
  app.use(async (c, next) => {
    // Rewrite before reading the URL
    c.req.raw = publicRequest(c.req.raw)
    await next()
  })

  app.get("/healthz", async (c) => {
    c.header("Cache-Control", "no-store")
    try {
      await options.health.db()
      return c.json({ status: "ok", sha: options.sha ?? "dev" })
    } catch {
      return c.text("unavailable", 503)
    }
  })
  app.get("/healthz/jobs", async (c) => {
    c.header("Cache-Control", "no-store")
    try {
      const report = await options.health.jobs()
      return c.json(report, report.ok ? 200 : 503)
    } catch {
      return c.json({ ok: false, checks: {} }, 503)
    }
  })

  if (options.clientDir) {
    app.use("/assets/*", staticFrom(options.clientDir, immutable))
    app.use("*", staticFrom(options.clientDir, "public, max-age=3600"))
  }

  app.use(canonicalHost())
  // Uploads hold separate slots
  app.use(
    loadShed(
      options.maxUploadsInFlight ?? 16,
      (c) => isUpload(c) || isBriefUpload(c),
    ),
  )
  app.use(
    loadShed(
      options.maxInFlight ?? 64,
      (c) => !isUpload(c) && !isBriefUpload(c),
    ),
  )
  app.use(async (c, next) =>
    isUpload(c)
      ? next()
      : bodyLimit({
          maxSize: isBriefUpload(c) ? MAX_BRIEF_BODY : MAX_FORM_BODY,
          onError: (ctx) =>
            ctx.text(m.error_body_too_large(), 413, {
              "Cache-Control": "no-store",
            }),
        })(c, next),
  )
  // After CSP and cache headers
  app.use(originGzip())
  app.use(
    canonicalQuery((c, response) => withCacheHeaders(c, response, cdnTtl)),
  )
  app.all("*", async (c) =>
    withCacheHeaders(c, await options.handleDocument(c.req.raw), cdnTtl),
  )
  return app
}
