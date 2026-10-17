import type { Destination } from "../../../shared/phone.ts"
import { AGE_CONSENT_VERSION } from "../../../shared/report-fields.ts"
import type { OtpChannel } from "../../../shared/whatsapp.ts"

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const BASE = "/api/auth/account"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isEmail(value: string): boolean {
  return EMAIL.test(value)
}

export type SignUpFields = { name: string; email: string; phone: string }
export type AccountRequest =
  | { mode: "sign-in"; identifier: string }
  | ({ mode: "sign-up" } & SignUpFields)

type Masked = {
  email: Destination
  whatsapp: Destination
  whatsappReady: boolean
}

function post(
  fetcher: FetchLike,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetcher(`${BASE}${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

async function codeOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { code?: unknown }
  return typeof body.code === "string" ? body.code : ""
}

type Failure = { kind: "rate_limited" } | { kind: "failed" }

function failure(status: number): Failure {
  return status === 429 ? { kind: "rate_limited" } : { kind: "failed" }
}

/** Masuk: which channels exist. */
export async function lookup(
  identifier: string,
  fetcher: FetchLike = fetch,
): Promise<
  | ({ kind: "found" } & Masked)
  | { kind: "missing" }
  // On an account, never proven
  | { kind: "unproven" }
  | { kind: "invalid" }
  | Failure
> {
  try {
    const response = await post(fetcher, "/lookup", { identifier })
    if (response.status === 400) return { kind: "invalid" }
    if (!response.ok) return failure(response.status)
    const body = (await response.json()) as {
      found: boolean
      unproven?: boolean
    } & Masked
    if (!body.found) return { kind: body.unproven ? "unproven" : "missing" }
    return {
      kind: "found",
      email: body.email,
      whatsapp: body.whatsapp,
      whatsappReady: body.whatsappReady,
    }
  } catch {
    return { kind: "failed" }
  }
}

const INVALID_FIELD: Record<string, keyof SignUpFields> = {
  INVALID_NAME: "name",
  INVALID_EMAIL: "email",
  INVALID_PHONE: "phone",
}

/** Daftar: free email and number. */
export async function checkNew(
  fields: SignUpFields & { mode?: "sign-up" },
  fetcher: FetchLike = fetch,
): Promise<
  | ({ kind: "free"; only: OtpChannel | null } & Masked)
  | { kind: "taken"; field: "email" | "phone" }
  | { kind: "pending" }
  | { kind: "invalid"; field: keyof SignUpFields }
  | Failure
> {
  try {
    const { name, email, phone } = fields
    const response = await post(fetcher, "/check-new", { name, email, phone })
    if (response.status === 400) {
      return {
        kind: "invalid",
        field: INVALID_FIELD[await codeOf(response)] ?? "email",
      }
    }
    if (!response.ok) return failure(response.status)
    const body = (await response.json()) as {
      taken: "email" | "phone" | "pending" | null
      only?: OtpChannel | null
      email: string
      whatsapp: string
      whatsappReady: boolean
    }
    if (body.taken === "pending") return { kind: "pending" }
    if (body.taken) return { kind: "taken", field: body.taken }
    // Own input, safe to mask
    return {
      kind: "free",
      only: body.only ?? null,
      email: { kind: "masked", value: body.email },
      whatsapp: { kind: "masked", value: body.whatsapp },
      whatsappReady: body.whatsappReady,
    }
  } catch {
    return { kind: "failed" }
  }
}

export type SendRefusal =
  | "captcha"
  | "rate_limited"
  | "whatsapp_unavailable"
  | "taken"
  | "pending"
  | "missing"
  | "failed"

/** Code request carries its token. */
export async function requestCode(
  account: AccountRequest,
  channel: OtpChannel,
  turnstileToken: string,
  fetcher: FetchLike = fetch,
): Promise<
  | { ok: true; to: string; statusId: string | null }
  | { ok: false; reason: SendRefusal }
> {
  const refused = (reason: SendRefusal) => ({ ok: false, reason }) as const
  try {
    const response = await post(
      fetcher,
      "/send-code",
      { ...account, channel },
      { "x-captcha-response": turnstileToken },
    )
    if (response.ok) {
      const body = (await response.json()) as {
        to: string
        statusId: string | null
      }
      return { ok: true, to: body.to, statusId: body.statusId }
    }
    if (response.status === 403) return refused("captcha")
    if (response.status === 429) return refused("rate_limited")
    const code = await codeOf(response)
    if (response.status === 409) {
      return refused(code.endsWith("_PENDING") ? "pending" : "taken")
    }
    if (response.status === 404) return refused("missing")
    return refused(
      code === "WHATSAPP_UNAVAILABLE" ? "whatsapp_unavailable" : "failed",
    )
  } catch {
    return refused("failed")
  }
}

/** Only Daftar carries the box. */
export async function verifyCode(
  account: AccountRequest,
  channel: OtpChannel,
  code: string,
  ageChecked: boolean,
  fetcher: FetchLike = fetch,
): Promise<
  "ok" | "two_factor" | "age" | "wrong" | "taken" | "rate_limited" | "failed"
> {
  try {
    const ageDeclaration =
      account.mode === "sign-up"
        ? {
            ageDeclaration: {
              age_18_plus: ageChecked,
              ageConsentVersion: AGE_CONSENT_VERSION,
            },
          }
        : {}
    const response = await post(fetcher, "/verify-code", {
      ...account,
      channel,
      code,
      ...ageDeclaration,
    })
    if (response.status >= 500) return "failed"
    if (response.status === 429) return "rate_limited"
    if (response.status === 409) return "taken"
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        twoFactorRedirect?: unknown
      }
      // TOTP step, no session yet
      return body.twoFactorRedirect === true ? "two_factor" : "ok"
    }
    return (await codeOf(response)) === "AGE_DECLARATION_REQUIRED"
      ? "age"
      : "wrong"
  } catch {
    return "failed"
  }
}

/** WhatsApp delivery, null unknown. */
export async function codeStatus(
  id: string,
  fetcher: FetchLike = fetch,
): Promise<"reserved" | "sent" | "failed" | null> {
  try {
    const response = await post(fetcher, "/code-status", { id })
    if (!response.ok) return null
    const body = (await response.json()) as { status: unknown }
    return body.status === "reserved" ||
      body.status === "sent" ||
      body.status === "failed"
      ? body.status
      : null
  } catch {
    return null
  }
}
