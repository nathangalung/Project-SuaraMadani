import { type FetchLike, withDeadline } from "./http.ts"

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html: string
  // Stable per notification row
  idempotencyKey?: string
}

// One port, two adapters
export type EmailSender = { send(message: EmailMessage): Promise<void> }

type SenderOptions = { from: string; fetch?: FetchLike; timeoutMs?: number }

const TIMEOUT_MS = 10_000

// Key, plan, quota, rate limit
const RETRYABLE_4XX = new Set([401, 402, 403, 429])

/** Status only, never the body. */
export class EmailSendError extends Error {
  readonly status: number
  readonly permanent: boolean
  readonly retryAfterSeconds: number | null

  constructor(provider: string, status: number, retryAfter: string | null) {
    super(`${provider} send failed: ${status}`)
    this.name = "EmailSendError"
    this.status = status
    // Account errors must page
    this.permanent = status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)
    const seconds = Number(retryAfter)
    this.retryAfterSeconds =
      retryAfter !== null && Number.isFinite(seconds) && seconds >= 0
        ? seconds
        : null
  }
}

// Failed before any byte left
const NOT_CONNECTED = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPROTO",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
])

/** Connection never made, nothing sent. */
export function neverSent(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code !== "string") return false
  return NOT_CONNECTED.has(code) || /^(CERT_|UNABLE_TO_|ERR_TLS_)/.test(code)
}

export function parseAddress(value: string): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(value)
  if (match) return { name: match[1] ?? "", email: match[2] ?? "" }
  return { name: "", email: value.trim() }
}

async function post(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: SenderOptions,
): Promise<void> {
  const fetch = options.fetch ?? globalThis.fetch
  const timeout = options.timeoutMs ?? TIMEOUT_MS
  const response = await withDeadline(
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    }),
    timeout,
  )
  if (!response.ok) {
    throw new EmailSendError(
      provider,
      response.status,
      response.headers.get("retry-after"),
    )
  }
}

export function brevoSender(
  options: SenderOptions & { apiKey: string },
): EmailSender {
  const sender = parseAddress(options.from)
  return {
    send: (message) =>
      post(
        "brevo",
        "https://api.brevo.com/v3/smtp/email",
        { "api-key": options.apiKey },
        {
          sender,
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
          // P17: dedupe coverage unverified
          ...(message.idempotencyKey
            ? { headers: { idempotencyKey: message.idempotencyKey } }
            : {}),
        },
        options,
      ),
  }
}

export function mailpitSender(
  options: SenderOptions & { url: string },
): EmailSender {
  const from = parseAddress(options.from)
  return {
    send: (message) =>
      post(
        "mailpit",
        `${options.url.replace(/\/$/, "")}/api/v1/send`,
        {},
        {
          From: { Email: from.email, Name: from.name },
          To: [{ Email: message.to }],
          Subject: message.subject,
          Text: message.text,
          HTML: message.html,
        },
        options,
      ),
  }
}

type EmailEnv = Partial<
  Record<
    | "NODE_ENV"
    | "EMAIL_PROVIDER"
    | "EMAIL_FROM"
    | "BREVO_API_KEY"
    | "MAILPIT_URL",
    string
  >
>

function required(env: EmailEnv, name: keyof EmailEnv): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/** Provider from EMAIL_PROVIDER. */
export function createEmailSender(env: EmailEnv = process.env): EmailSender {
  switch (env.EMAIL_PROVIDER) {
    case "brevo":
      return brevoSender({
        apiKey: required(env, "BREVO_API_KEY"),
        from: required(env, "EMAIL_FROM"),
      })
    case "mailpit":
      if (env.NODE_ENV === "production") {
        throw new Error("EMAIL_PROVIDER mailpit is not allowed in production")
      }
      return mailpitSender({
        url: required(env, "MAILPIT_URL"),
        from: required(env, "EMAIL_FROM"),
      })
    default:
      // SES waits for access grant
      throw new Error(`EMAIL_PROVIDER ${env.EMAIL_PROVIDER} is not supported`)
  }
}
