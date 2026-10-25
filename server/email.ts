import { AwsV4Signer } from "aws4fetch"
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

// Key, plan, quota, timeout, rate
const RETRYABLE_4XX = new Set([401, 402, 403, 408, 429])
// SES: message-level faults only
const SES_PERMANENT = new Set(["BadRequestException", "MessageRejected"])
// SES throttles on 400 too
const RATE_LIMIT_TYPES = new Set([
  "ThrottlingException",
  "TooManyRequestsException",
])

/** Status and type, never text. */
export class EmailSendError extends Error {
  readonly status: number
  readonly code: string | null
  readonly permanent: boolean
  readonly rateLimited: boolean
  readonly retryAfterSeconds: number | null

  constructor(
    provider: string,
    status: number,
    retryAfter: string | null,
    code: string | null = null,
  ) {
    super(`${provider} send failed: ${status}${code ? ` ${code}` : ""}`)
    this.name = "EmailSendError"
    this.status = status
    this.code = code
    this.rateLimited =
      status === 429 || (code !== null && RATE_LIMIT_TYPES.has(code))
    // Account errors must page
    this.permanent =
      provider === "ses"
        ? code !== null && SES_PERMANENT.has(code)
        : status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)
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

type Wire = { url: string; headers: Headers; body: string }

async function exchange(
  provider: string,
  wire: (body: string) => Promise<Wire>,
  body: unknown,
  options: SenderOptions,
  errorType: (response: Response) => Promise<string | null> = async () => null,
): Promise<void> {
  const fetch = options.fetch ?? globalThis.fetch
  const timeout = options.timeoutMs ?? TIMEOUT_MS
  const request = await wire(JSON.stringify(body))
  await withDeadline(
    (async () => {
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        // API10: never follow redirects
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      })
      if (response.ok) return
      throw new EmailSendError(
        provider,
        response.status,
        response.headers.get("retry-after"),
        await errorType(response),
      )
    })(),
    timeout,
  )
}

function post(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: SenderOptions,
): Promise<void> {
  return exchange(
    provider,
    async (json) => ({
      url,
      headers: new Headers({ "content-type": "application/json", ...headers }),
      body: json,
    }),
    body,
    options,
  )
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

// Shape name only, never text
const ERROR_TYPE = /^[A-Za-z][A-Za-z0-9]{0,63}$/

/** Smithy restJson1 error type. */
async function awsErrorType(response: Response): Promise<string | null> {
  let raw = response.headers.get("x-amzn-errortype")
  if (!raw) {
    try {
      const parsed: unknown = JSON.parse(await response.text())
      const fields = parsed as { __type?: unknown; code?: unknown } | null
      const value = fields?.__type ?? fields?.code
      raw = typeof value === "string" ? value : null
    } catch {
      raw = null
    }
  }
  const name = raw?.split(":")[0]?.split("#").pop() ?? ""
  return ERROR_TYPE.test(name) ? name : null
}

// No SMTPUTF8 at SES
const ASCII = /^[\x20-\x7e]*$/

/** RFC 2047 name, ASCII address. */
function sesFromAddress(value: string): string {
  const { name, email } = parseAddress(value)
  if (!ASCII.test(email)) {
    throw new Error("EMAIL_FROM address must be ASCII for SES")
  }
  if (!name) return email
  const display = ASCII.test(name)
    ? /^[\w !#$%&'*+/=?^`{|}~-]+$/.test(name)
      ? name
      : `"${name.replace(/(["\\])/g, "\\$1")}"`
    : `=?UTF-8?B?${Buffer.from(name).toString("base64")}?=`
  return `${display} <${email}>`
}

const SES_REGION = /^[a-z]{2}(-[a-z]+)+-\d$/

function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]|\.\d{3}/g, "")
}

/** SES API v2 SendEmail, SigV4. */
export function sesSender(
  options: SenderOptions & {
    region: string
    accessKeyId: string
    secretAccessKey: string
    now?: () => Date
  },
): EmailSender {
  if (!SES_REGION.test(options.region)) {
    throw new Error(`SES_REGION ${options.region} is not a region`)
  }
  const from = sesFromAddress(options.from)
  const url = `https://email.${options.region}.amazonaws.com/v2/email/outbound-emails`
  const cache = new Map<string, ArrayBuffer>()
  const now = options.now ?? (() => new Date())
  const utf8 = (data: string) => ({ Data: data, Charset: "UTF-8" })
  return {
    send: (message) =>
      exchange(
        "ses",
        async (json) => {
          const signed = await new AwsV4Signer({
            url,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: json,
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
            service: "ses",
            region: options.region,
            cache,
            datetime: amzDate(now()),
          }).sign()
          return {
            url: signed.url.toString(),
            headers: signed.headers,
            body: json,
          }
        },
        {
          FromEmailAddress: from,
          Destination: { ToAddresses: [message.to] },
          // No idempotency key at SES
          Content: {
            Simple: {
              Subject: utf8(message.subject),
              Body: { Text: utf8(message.text), Html: utf8(message.html) },
            },
          },
        },
        options,
        awsErrorType,
      ),
  }
}

type EmailEnv = Partial<
  Record<
    | "NODE_ENV"
    | "EMAIL_PROVIDER"
    | "EMAIL_FROM"
    | "BREVO_API_KEY"
    | "MAILPIT_URL"
    | "SES_REGION"
    | "SES_ACCESS_KEY_ID"
    | "SES_SECRET_ACCESS_KEY",
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
    case "ses":
      return sesSender({
        region: required(env, "SES_REGION"),
        accessKeyId: required(env, "SES_ACCESS_KEY_ID"),
        secretAccessKey: required(env, "SES_SECRET_ACCESS_KEY"),
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
      throw new Error(`EMAIL_PROVIDER ${env.EMAIL_PROVIDER} is not supported`)
  }
}
