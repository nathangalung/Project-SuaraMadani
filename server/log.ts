import { processGlobal } from "../db/process-global.ts"
import { requestScope } from "../db/request-scope.ts"
import { scrub } from "./scrub.ts"

export type LogRecord = Record<string, unknown>

/** One JSON line to stdout. */
export function writeLog(record: LogRecord): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...record }))
}

// architecture.md Security Events
export type SecurityEvent =
  | "auth_refused"
  | "auth_ok"
  | "backup_codes_viewed"
  | "bad_host"
  | "body_limit"
  | "captcha_refused"
  | "csrf_refused"
  | "forbidden"
  | "rate_limited"
  | "staff_refused"
  | "step_up_failed"
  | "step_up_signed_out"
  | "unauthenticated"
  | "unrouted_path"

/** OWASP A09: refusals, no contacts. */
export function securityRecord(
  event: SecurityEvent,
  fields: LogRecord,
): LogRecord {
  const scope = requestScope()
  if (scope) scope.named = true
  // Joins the request line
  const reqId = fields.req_id ?? scope?.reqId
  return reqId === undefined
    ? { msg: "security", event, ...fields }
    : { msg: "security", event, ...fields, req_id: reqId }
}

// Private codes, never public ones
const PRIVATE_SEGMENTS: [RegExp, string][] = [
  [/^(\/lapor\/sukses\/)[^/]+/i, "$1:code"],
  [/^(\/aduan\/)[^/]+/i, "$1:code"],
  [/^(\/kelola\/laporan\/)[^/]+/i, "$1:code"],
  [/^(\/kelola\/aduan\/)[^/]+/i, "$1:code"],
]
const UUID_SEGMENT =
  /(?<=\/)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?=\/|$)/gi

/** ASVS V14.2.4: identifiers masked. */
export function logPath(path: string): string {
  let masked = path.replace(UUID_SEGMENT, ":id")
  for (const [pattern, replacement] of PRIVATE_SEGMENTS) {
    masked = masked.replace(pattern, replacement)
  }
  return masked
}

/** Receives error lines, never throws. */
export type ErrorReporter = { report: (record: LogRecord) => void }

// SSR bundle shares this reporter
const state = processGlobal(
  "errorReporter",
  (): { reporter?: ErrorReporter } => ({}),
)

/** Installed once at boot. */
export function setErrorReporter(next: ErrorReporter | undefined): void {
  state.reporter = next
}

/** One JSON line to stderr. */
export function writeError(record: LogRecord): void {
  console.error(
    JSON.stringify({ t: new Date().toISOString(), level: "error", ...record }),
  )
  try {
    state.reporter?.report(record)
  } catch {
    // Logging must never fail
  }
}

type DbFields = {
  code?: unknown
  constraint?: unknown
  table?: unknown
  routine?: unknown
}

// Query parts hold personal data
function dbError(error: object): DbFields | undefined {
  let current: unknown = error
  let found = false
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    if ("params" in current && "query" in current) found = true
    if ("severity" in current && "code" in current) return current
    current = (current as { cause?: unknown }).cause
  }
  return found ? {} : undefined
}

/** Loggable fields, no personal data. */
export function errorRecord(error: unknown): LogRecord {
  if (!error || typeof error !== "object") return { error: typeof error }
  const name = error instanceof Error ? error.name : "object"
  const db = dbError(error)
  if (db) {
    const { code, constraint, table, routine } = db
    return Object.fromEntries(
      Object.entries({ error: name, code, constraint, table, routine }).filter(
        ([, value]) => typeof value === "string",
      ),
    )
  }
  if (!(error instanceof Error)) return { error: "object" }
  // OWASP A09: messages quote input
  return {
    error: name,
    message: scrub(error.message),
    stack: error.stack && scrub(error.stack, Number.POSITIVE_INFINITY),
  }
}
