import { type FetchLike, withDeadline } from "./http.ts"

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
}

type SiteverifyReply = { success?: boolean; "error-codes"?: string[] }

/** One siteverify call, fails closed. */
export async function verifyTurnstile(
  token: string | null | undefined,
  options: TurnstileOptions,
): Promise<TurnstileResult> {
  if (!token) return { ok: false, reason: "missing" }
  if (!options.secret) return { ok: false, reason: "unavailable" }
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
        signal: AbortSignal.timeout(timeout),
      }),
      timeout,
    )
    if (!response.ok) return { ok: false, reason: "unavailable" }
    reply = (await response.json()) as SiteverifyReply
  } catch {
    return { ok: false, reason: "unavailable" }
  }
  if (reply.success === true) return { ok: true }
  const codes = reply["error-codes"] ?? []
  return {
    ok: false,
    reason: codes.includes("timeout-or-duplicate") ? "duplicate" : "rejected",
  }
}

/** Env secret, dev test keys. */
export function turnstileSecret(): string {
  return process.env.TURNSTILE_SECRET_KEY ?? ""
}
