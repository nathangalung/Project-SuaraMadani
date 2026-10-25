import { timingSafeEqual } from "node:crypto"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { type Context, Hono, type MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"
import { HTTPException } from "hono/http-exception"
import { type RequestIdVariables, requestId } from "hono/request-id"
import { serveStatic } from "hono/serve-static"
import { m } from "../app/paraglide/messages.js"
import { requestScope } from "../db/request-scope.ts"
import { normalizeHost } from "../db/tenant.server.ts"
import { BRIEF_MAX_BYTES } from "../shared/demands.ts"
import { EVIDENCE_LIMITS } from "../shared/report-fields.ts"
import { apiCors, isPublicApi, publicDataApi } from "./api/public-data.ts"
import type { HealthChecks } from "./health.ts"
import {
  errorRecord,
  type LogRecord,
  logPath,
  securityRecord,
  writeError,
  writeLog,
} from "./log.ts"
import {
  applyCacheHeaders,
  cachePolicy,
  hasSessionCookie,
} from "./middleware/cache-headers.ts"
import { canonicalQuery } from "./middleware/canonical-query.ts"
import { originGzip } from "./middleware/compress.ts"
import { loadShed } from "./middleware/load-shed.ts"
import { requestLog } from "./middleware/request-log.ts"
import {
  applySecurityHeaders,
  securityHeaders,
} from "./middleware/security-headers.ts"
import { serverTiming } from "./middleware/server-timing.ts"

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
  // Unhandled errors, tests inject
  errorLog?: (line: LogRecord) => void
  // Public data API, tests only
  apiRateLimit?: { max: number; windowMs: number }
  // Bearer for /healthz/jobs checks
  healthToken?: string
  // Strict-Transport-Security value
  hsts?: string
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

// PATCH is the tus append
const UPLOAD_METHODS = new Set(["POST", "PATCH"])

/** API4: Better Auth sends X-Retry-After. */
function retryAfter(response: Response): Response {
  const seconds = response.headers.get("x-retry-after")
  if (
    response.status !== 429 ||
    !seconds ||
    response.headers.has("retry-after")
  )
    return response
  // Fetch responses may be immutable
  const copy = new Response(response.body, response)
  copy.headers.set("Retry-After", seconds)
  return copy
}

/** API8: checks for monitors only. */
function bearerMatches(
  header: string | undefined,
  options: Pick<AppOptions, "healthToken">,
): boolean {
  const token = options.healthToken
  if (!token || !header?.startsWith("Bearer ")) return false
  const given = Buffer.from(header.slice("Bearer ".length))
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Streams to disk, own limits. */
function isUpload(c: Context): boolean {
  return UPLOAD_METHODS.has(c.req.method) && UPLOAD_PATH.test(c.req.path)
}

// Staff policy brief, multipart
const BRIEF_UPLOAD_PATH = /^\/kelola\/tuntutan\/[^/]+\/unggah$/
export const MAX_BRIEF_BODY = BRIEF_MAX_BYTES + 64 * 1024

function isBriefUpload(c: Context): boolean {
  return c.req.method === "POST" && BRIEF_UPLOAD_PATH.test(c.req.path)
}

/** Better Auth hosts are exact. */
function canonicalHost(log: (line: LogRecord) => void): MiddlewareHandler {
  return async (c, next) => {
    const raw = c.req.raw.headers.get("host") ?? new URL(c.req.url).host
    if (normalizeHost(raw) !== raw) {
      log(
        securityRecord("bad_host", {
          host: raw,
          path: logPath(c.req.path),
          req_id: c.get("requestId"),
        }),
      )
      return c.body(null, 404, { "Cache-Control": "no-store" })
    }
    return next()
  }
}

// Refusals named by status
const STATUS_EVENTS = {
  401: "unauthenticated",
  403: "forbidden",
  413: "body_limit",
  429: "rate_limited",
} as const
type RefusalStatus = keyof typeof STATUS_EVENTS

/** OWASP A09: one line each. */
function refusalEvents(log: (line: LogRecord) => void): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const status = c.res.status
    if (!Object.hasOwn(STATUS_EVENTS, status)) return
    // Handler already named it
    if (requestScope()?.named) return
    log(
      securityRecord(STATUS_EVENTS[status as RefusalStatus], {
        host: new URL(c.req.url).host,
        path: logPath(c.req.path),
        status,
        req_id: c.get("requestId"),
        user_id: requestScope()?.userId ?? null,
      }),
    )
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

/** OWASP A05: NUL, bad escapes. */
function malformedUrl(url: string): boolean {
  const { pathname, search } = new URL(url)
  try {
    const parts = [pathname, ...search.slice(1).split(/[&=]/)]
    return parts.some((part) =>
      decodeURIComponent(part.replaceAll("+", " ")).includes("\0"),
    )
  } catch {
    return true
  }
}

function holdsNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\0")
  if (Array.isArray(value)) return value.some(holdsNul)
  if (value && typeof value === "object") {
    return Object.values(value).some(holdsNul)
  }
  return false
}

/** Form, multipart, JSON values, capped. */
async function nulInBody(request: Request): Promise<boolean> {
  if (!request.body) return false
  // Parsers ignore media type case
  const type = (request.headers.get("content-type") ?? "").toLowerCase()
  try {
    if (type.includes("multipart/form-data")) {
      const values = [...(await request.clone().formData()).values()]
      return holdsNul(values.filter((value) => typeof value === "string"))
    }
    const text = await request.clone().text()
    if (type.includes("application/x-www-form-urlencoded")) {
      return holdsNul([...new URLSearchParams(text).values()])
    }
    // Report submit reads any type
    return holdsNul(JSON.parse(text))
  } catch {
    // Handler answers bad bodies
    return false
  }
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
  const errorLog = options.errorLog ?? writeError
  const log = options.log ?? writeLog

  // Line terminators match no route
  app.notFound((c) => {
    const res = c.text("Not Found", 404, { "Cache-Control": "no-store" })
    // Middleware ran: it logs
    if (c.get("requestId")) return res
    const reqId = crypto.randomUUID()
    const host = new URL(c.req.url).host
    const path = logPath(c.req.path)
    log(securityRecord("unrouted_path", { host, path, req_id: reqId }))
    log({
      msg: "request",
      req_id: reqId,
      method: c.req.method,
      host,
      path,
      status: 404,
      dur_ms: 0,
      user_id: null,
    })
    applySecurityHeaders(res.headers, c.req.url, options.hsts)
    return res
  })

  // Default prints raw errors
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    errorLog({
      msg: "server error",
      req_id: c.get("requestId"),
      path: logPath(c.req.path),
      ...errorRecord(error),
    })
    return c.text("Internal Server Error", 500, { "Cache-Control": "no-store" })
  })

  app.use(
    requestId({
      headerName: "",
      generator: (c) => {
        const ray = c.req.header("cf-ray")
        return ray && CF_RAY.test(ray) ? ray : crypto.randomUUID()
      },
    }),
  )
  app.use(requestLog(log))
  app.use(securityHeaders(options.hsts))
  app.use(refusalEvents(log))
  app.use(async (c, next) => {
    // Rewrite before reading the URL
    c.req.raw = publicRequest(c.req.raw)
    await next()
  })
  app.use(async (c, next) =>
    malformedUrl(c.req.url)
      ? c.text("Bad Request", 400, { "Cache-Control": "no-store" })
      : next(),
  )

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
      const body = bearerMatches(c.req.header("authorization"), options)
        ? report
        : { ok: report.ok }
      return c.json(body, report.ok ? 200 : 503)
    } catch {
      return c.json({ ok: false }, 503)
    }
  })

  if (options.clientDir) {
    app.use("/assets/*", staticFrom(options.clientDir, immutable))
    app.use("*", staticFrom(options.clientDir, "public, max-age=3600"))
  }

  app.use(serverTiming())
  app.use(canonicalHost(log))
  // Before 301s and load shed
  app.use(async (c, next) =>
    isPublicApi(c.req.path) ? apiCors(c, next) : next(),
  )
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
  // Bodies are capped above
  app.use(async (c, next) =>
    !isUpload(c) && (await nulInBody(c.req.raw))
      ? c.text("Bad Request", 400, { "Cache-Control": "no-store" })
      : next(),
  )
  // After CSP and cache headers
  app.use(originGzip())
  app.use(
    canonicalQuery((c, response) => withCacheHeaders(c, response, cdnTtl)),
  )
  app.route(
    "/api/v1",
    publicDataApi({ cdnTtl, rateLimit: options.apiRateLimit }),
  )
  app.all("*", async (c) =>
    withCacheHeaders(
      c,
      retryAfter(await options.handleDocument(c.req.raw)),
      cdnTtl,
    ),
  )
  return app
}
