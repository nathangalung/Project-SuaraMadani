import * as z from "zod"
import { boundedJson, type FetchLike, withDeadline } from "./http.ts"
import {
  errorRecord,
  type LogRecord,
  securityRecord,
  writeError,
  writeLog,
} from "./log.ts"

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "duplicate" | "rejected" | "unavailable" }

export type TurnstileOptions = {
  secret: string
  remoteIp?: string | null
  idempotencyKey?: string
  fetch?: FetchLike
  timeoutMs?: number
  // Tests capture both streams
  log?: TurnstileLog
}

type TurnstileLog = {
  error: (line: LogRecord) => void
  security: (line: LogRecord) => void
}
const DEFAULT_LOG: TurnstileLog = { error: writeError, security: writeLog }

// API10: shape and size checked
const siteverifyReply = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
})
const REPLY_MAX_BYTES = 64 * 1024

type SiteverifyReply = z.infer<typeof siteverifyReply>

type Outcome = { result: TurnstileResult; failure?: LogRecord }

const unavailable = (failure: LogRecord): Outcome => ({
  result: { ok: false, reason: "unavailable" },
  failure,
})

async function siteverify(
  token: string,
  options: TurnstileOptions,
): Promise<Outcome> {
  if (!options.secret) return unavailable({ cause: "no_secret" })
  const body = new URLSearchParams({ secret: options.secret, response: token })
  if (options.remoteIp) body.set("remoteip", options.remoteIp)
  if (options.idempotencyKey) {
    body.set("idempotency_key", options.idempotencyKey)
  }
  const fetch = options.fetch ?? globalThis.fetch
  const timeout = options.timeoutMs ?? 3000
  let reply: SiteverifyReply
  try {
    const response = await withDeadline(
      fetch(SITEVERIFY_URL, {
        method: "POST",
        body,
        // API10: never follow redirects
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      }),
      timeout,
    )
    if (!response.ok) return unavailable({ status: response.status })
    const parsed = siteverifyReply.safeParse(
      await withDeadline(boundedJson(response, REPLY_MAX_BYTES), timeout),
    )
    if (!parsed.success) return unavailable({ cause: "bad_reply" })
    reply = parsed.data
  } catch (error) {
    // TLS, DNS, timeout alike
    return unavailable(errorRecord(error))
  }
  if (reply.success === true) return { result: { ok: true } }
  const codes = reply["error-codes"] ?? []
  return {
    result: {
      ok: false,
      reason: codes.includes("timeout-or-duplicate") ? "duplicate" : "rejected",
    },
  }
}

/** One siteverify call, fails closed. */
export async function verifyTurnstile(
  token: string | null | undefined,
  options: TurnstileOptions,
): Promise<TurnstileResult> {
  const log = options.log ?? DEFAULT_LOG
  const { result, failure } = token
    ? await siteverify(token, options)
    : { result: { ok: false, reason: "missing" } as const }
  if (result.ok) return result
  // ASVS V16.3.4: control failure
  if (failure) log.error({ msg: "turnstile unavailable", ...failure })
  else
    log.security(securityRecord("captcha_refused", { reason: result.reason }))
  return result
}

// Cloudflare testing doc dummy keys
const DUMMY_KEY = /^[123]x0{20,}[A-Z]{2}$/

/** Dummy keys, public apex. */
export function turnstileKeysProblem(
  env: Record<string, string | undefined>,
): string | null {
  const apex = (env.APEX_HOST || "localhost").toLowerCase()
  const local = apex === "localhost" || apex.endsWith(".localhost")
  if (env.NODE_ENV !== "production" || local) return null
  for (const name of ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]) {
    if (DUMMY_KEY.test(env[name] ?? "")) {
      return `${name} is a Cloudflare test key, set the real one`
    }
  }
  return null
}

/** Env secret, dev test keys. */
export function turnstileSecret(): string {
  return process.env.TURNSTILE_SECRET_KEY ?? ""
}
