import { randomUUID } from "node:crypto"
import { type ErrorReporter, type LogRecord, writeLog } from "./log.ts"
import { scrub } from "./scrub.ts"

/** Envelope endpoint and public key. */
export type Dsn = { endpoint: string; key: string }

type Frame = {
  function?: string
  filename: string
  lineno: number
  colno: number
  in_app: boolean
}

type ExceptionValue = {
  type: string
  value?: string
  stacktrace?: { frames: Frame[] }
}

export type ErrorEvent = {
  event_id: string
  timestamp: number
  platform: "node"
  level: "error"
  logger?: string
  transaction?: string
  release?: string
  environment: string
  tags: Record<string, string>
  exception: { values: ExceptionValue[] }
}

type EventContext = {
  release?: string
  environment: string
  service: string
  // Stack paths made relative
  root: string
}

type ReporterOptions = EventContext & {
  dsn: Dsn
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  log?: (line: LogRecord) => void
  now?: () => number
  maxInFlight?: number
  timeoutMs?: number
}

const CLIENT = "sadar-bersuara/1"
const KEY_RE = /^[0-9a-f]{32}$/
const PROJECT_RE = /^(.*)\/(\d+)$/
const MAX_TAG = 200
const MAX_FRAMES = 100
const DEFAULT_BACKOFF_MS = 60_000
const LOG_EVERY_MS = 60_000
// Scalar fields only, never values
const TAG_FIELDS = [
  "req_id",
  "queue",
  "job_id",
  "retry",
  "status",
  "code",
  "constraint",
  "table",
  "routine",
] as const

const FRAME_RE = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/

/** Parses a DSN, no secrets. */
export function parseDsn(value: string): Dsn {
  const malformed = new Error("GLITCHTIP_DSN is malformed")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw malformed
  }
  const project = PROJECT_RE.exec(url.pathname)
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !KEY_RE.test(url.username) ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !project
  ) {
    throw malformed
  }
  const [, prefix = "", id = ""] = project
  return {
    endpoint: `${url.protocol}//${url.host}${prefix}/api/${id}/envelope/`,
    key: url.username,
  }
}

/** V8 stack lines, oldest first. */
export function stackFrames(stack: string, root: string): Frame[] {
  const frames: Frame[] = []
  for (const line of stack.split("\n")) {
    const match = FRAME_RE.exec(line)
    if (!match) continue
    const [, fn, file = "", lineno = "0", colno = "0"] = match
    const inRoot = file.startsWith(`${root}/`)
    const filename = inRoot ? file.slice(root.length + 1) : file
    frames.push({
      ...(fn ? { function: fn } : {}),
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: inRoot && !filename.startsWith("node_modules/"),
    })
  }
  return frames.slice(0, MAX_FRAMES).reverse()
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? scrub(value) : undefined
}

function tagsOf(record: LogRecord, service: string): Record<string, string> {
  const tags: Record<string, string> = { service }
  for (const field of TAG_FIELDS) {
    const value = record[field]
    if (typeof value === "string" || typeof value === "number") {
      tags[field] = scrub(String(value)).slice(0, MAX_TAG)
    }
  }
  return tags
}

function exceptionOf(record: LogRecord, root: string): ExceptionValue {
  const type = scrub(String(record.error))
  const message = text(record.message)
  // Database errors carry codes only
  const codes = [record.code, record.constraint]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
  const value = message ?? (codes ? scrub(codes) : undefined)
  const frames =
    typeof record.stack === "string" ? stackFrames(record.stack, root) : []
  return {
    type,
    ...(value ? { value } : {}),
    ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
  }
}

/** Allow-listed event, null without error. */
export function errorEvent(
  record: LogRecord,
  context: EventContext,
  nowMs: number,
): ErrorEvent | null {
  if (typeof record.error !== "string") return null
  const logger = text(record.msg)
  const transaction = text(record.path)
  return {
    event_id: randomUUID().replaceAll("-", ""),
    timestamp: nowMs / 1000,
    platform: "node",
    level: "error",
    ...(logger ? { logger } : {}),
    ...(transaction ? { transaction } : {}),
    ...(context.release ? { release: context.release } : {}),
    environment: context.environment,
    tags: tagsOf(record, context.service),
    exception: { values: [exceptionOf(record, context.root)] },
  }
}

/** One event item, byte length. */
export function envelope(event: ErrorEvent, sentAt: Date): string {
  const payload = JSON.stringify(event)
  const header = { event_id: event.event_id, sent_at: sentAt.toISOString() }
  const item = {
    type: "event",
    content_type: "application/json",
    length: Buffer.byteLength(payload, "utf8"),
  }
  return `${JSON.stringify(header)}\n${JSON.stringify(item)}\n${payload}\n`
}

function retryAfterMs(value: string | null, nowMs: number): number {
  if (value && /^\d+$/.test(value)) return Number(value) * 1000
  const date = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(date) ? DEFAULT_BACKOFF_MS : Math.max(0, date - nowMs)
}

/** Fire and forget, drops failures. */
export function createErrorReporter(
  options: ReporterOptions,
): ErrorReporter & { flush: () => Promise<void> } {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const log = options.log ?? writeLog
  const now = options.now ?? Date.now
  const maxInFlight = options.maxInFlight ?? 4
  const timeoutMs = options.timeoutMs ?? 3000
  const headers = {
    "Content-Type": "application/x-sentry-envelope",
    "User-Agent": CLIENT,
    "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=${CLIENT}, sentry_key=${options.dsn.key}`,
  }
  const pending = new Set<Promise<void>>()
  let suppressedUntil = 0
  let loggedAt = Number.NEGATIVE_INFINITY

  function failed(status: number): void {
    const at = now()
    if (at - loggedAt < LOG_EVERY_MS) return
    loggedAt = at
    log({ msg: "error report failed", status })
  }

  async function deliver(event: ErrorEvent): Promise<void> {
    try {
      const response = await send(options.dsn.endpoint, {
        method: "POST",
        headers,
        body: envelope(event, new Date(now())),
        // API10: never follow redirects
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      })
      await response.body?.cancel().catch(() => {})
      if (response.status === 429) {
        suppressedUntil =
          now() + retryAfterMs(response.headers.get("retry-after"), now())
      }
      if (!response.ok) failed(response.status)
    } catch {
      failed(0)
    }
  }

  return {
    report(record) {
      if (typeof record.error !== "string") return
      // authLog passes warn lines
      if (record.level !== undefined && record.level !== "error") return
      const at = now()
      if (at < suppressedUntil || pending.size >= maxInFlight) return
      const event = errorEvent(record, options, at)
      if (!event) return
      const task: Promise<void> = deliver(event).finally(() =>
        pending.delete(task),
      )
      pending.add(task)
    },
    async flush() {
      await Promise.allSettled([...pending])
    },
  }
}

type Env = Record<string, string | undefined>

/** Off unless ERROR_REPORTING=true. */
export function errorReporterFromEnv(
  env: Env,
  service: string,
): (ErrorReporter & { flush: () => Promise<void> }) | undefined {
  const flag = env.ERROR_REPORTING ?? ""
  if (flag !== "" && flag !== "true" && flag !== "false") {
    throw new Error("ERROR_REPORTING must be true or false")
  }
  if (flag !== "true") return undefined
  if (!env.GLITCHTIP_DSN) throw new Error("GLITCHTIP_DSN is not set")
  return createErrorReporter({
    dsn: parseDsn(env.GLITCHTIP_DSN),
    release: env.GIT_SHA || undefined,
    environment: env.NODE_ENV === "production" ? "production" : "development",
    service,
    root: process.cwd(),
  })
}
