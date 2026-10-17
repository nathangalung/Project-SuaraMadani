import { describe, expect, test } from "bun:test"
import { AGE_CONSENT_VERSION } from "../../../shared/report-fields.ts"
import {
  checkNew,
  codeStatus,
  isEmail,
  lookup,
  requestCode,
  verifyCode,
} from "./auth-client"

type Call = { url: string; init: RequestInit }

function fakeFetch(status: number, body: unknown = {}) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Response.json(body, { status })
  }
  return { calls, fetch }
}

const offline = async () => {
  throw new Error("offline")
}

const signIn = { mode: "sign-in", identifier: "a@b.id" } as const
const signUp = {
  mode: "sign-up",
  name: "Warga",
  email: "a@b.id",
  phone: "081234567890",
} as const
const bodyOf = (call: Call | undefined) => JSON.parse(String(call?.init.body))

describe("isEmail", () => {
  test("needs a name, at sign and domain", () => {
    expect(isEmail("nama@contoh.com")).toBe(true)
    expect(isEmail("nama@contoh")).toBe(false)
    expect(isEmail("nama contoh.com")).toBe(false)
  })
})

describe("lookup", () => {
  test("found, missing and refusals", async () => {
    const found = fakeFetch(200, {
      found: true,
      email: { kind: "masked", value: "a•••@b.id" },
      whatsapp: { kind: "registered" },
      whatsappReady: true,
    })
    expect(await lookup("a@b.id", found.fetch)).toEqual({
      kind: "found",
      email: { kind: "masked", value: "a•••@b.id" },
      whatsapp: { kind: "registered" },
      whatsappReady: true,
    })
    expect(found.calls[0]?.url).toBe("/api/auth/account/lookup")
    expect(bodyOf(found.calls[0])).toEqual({ identifier: "a@b.id" })
    expect(await lookup("x", fakeFetch(200, { found: false }).fetch)).toEqual({
      kind: "missing",
    })
    expect(await lookup("x", fakeFetch(400).fetch)).toEqual({
      kind: "invalid",
    })
    expect(await lookup("x", fakeFetch(429).fetch)).toEqual({
      kind: "rate_limited",
    })
    expect(await lookup("x", offline)).toEqual({ kind: "failed" })
  })
})

describe("checkNew", () => {
  test("free, taken or invalid", async () => {
    const free = fakeFetch(200, {
      taken: null,
      only: "whatsapp",
      email: "a•••@b.id",
      whatsapp: "+62 812•••••890",
      whatsappReady: false,
    })
    expect(await checkNew(signUp, free.fetch)).toEqual({
      kind: "free",
      only: "whatsapp",
      email: { kind: "masked", value: "a•••@b.id" },
      whatsapp: { kind: "masked", value: "+62 812•••••890" },
      whatsappReady: false,
    })
    expect(bodyOf(free.calls[0])).toEqual({
      name: "Warga",
      email: "a@b.id",
      phone: "081234567890",
    })
    expect(
      await checkNew(signUp, fakeFetch(200, { taken: "phone" }).fetch),
    ).toEqual({ kind: "taken", field: "phone" })
    expect(
      await checkNew(signUp, fakeFetch(200, { taken: "pending" }).fetch),
    ).toEqual({ kind: "pending" })
    expect(
      await checkNew(signUp, fakeFetch(400, { code: "INVALID_NAME" }).fetch),
    ).toEqual({ kind: "invalid", field: "name" })
  })
})

describe("requestCode", () => {
  test("sends the Turnstile token and the chosen channel", async () => {
    const { calls, fetch } = fakeFetch(200, {
      channel: "whatsapp",
      to: "+62 812•••••890",
      statusId: "id-1",
    })
    expect(await requestCode(signIn, "whatsapp", "tok", fetch)).toEqual({
      ok: true,
      to: "+62 812•••••890",
      statusId: "id-1",
    })
    expect(calls[0]?.url).toBe("/api/auth/account/send-code")
    expect(new Headers(calls[0]?.init.headers).get("x-captcha-response")).toBe(
      "tok",
    )
    expect(bodyOf(calls[0])).toEqual({ ...signIn, channel: "whatsapp" })
  })

  test("maps refusals", async () => {
    const reason = async (status: number, body: unknown = {}) => {
      const result = await requestCode(
        signUp,
        "email",
        "t",
        fakeFetch(status, body).fetch,
      )
      return result.ok ? "sent" : result.reason
    }
    expect(await reason(403)).toBe("captcha")
    expect(await reason(429)).toBe("rate_limited")
    expect(await reason(503, { code: "WHATSAPP_UNAVAILABLE" })).toBe(
      "whatsapp_unavailable",
    )
    expect(await reason(409, { code: "EMAIL_TAKEN" })).toBe("taken")
    expect(await reason(409, { code: "PHONE_PENDING" })).toBe("pending")
    expect(await reason(404)).toBe("missing")
    expect(await reason(500)).toBe("failed")
    const result = await requestCode(signUp, "email", "t", offline)
    expect(result).toEqual({ ok: false, reason: "failed" })
  })
})

describe("verifyCode", () => {
  test("Daftar carries the age declaration", async () => {
    const { calls, fetch } = fakeFetch(200, { status: true })
    expect(await verifyCode(signUp, "email", "123456", true, fetch)).toBe("ok")
    expect(calls[0]?.url).toBe("/api/auth/account/verify-code")
    expect(bodyOf(calls[0])).toEqual({
      ...signUp,
      channel: "email",
      code: "123456",
      ageDeclaration: {
        age_18_plus: true,
        ageConsentVersion: AGE_CONSENT_VERSION,
      },
    })
  })

  test("Masuk sends no box", async () => {
    const { calls, fetch } = fakeFetch(200, { status: true })
    await verifyCode(signIn, "email", "123456", false, fetch)
    expect(bodyOf(calls[0])).toEqual({
      ...signIn,
      channel: "email",
      code: "123456",
    })
  })

  test("staff with TOTP get the second step", async () => {
    const { fetch } = fakeFetch(200, { twoFactorRedirect: true })
    expect(await verifyCode(signIn, "email", "123456", false, fetch)).toBe(
      "two_factor",
    )
  })

  test("maps refusals", async () => {
    const result = (status: number, body: unknown = {}) =>
      verifyCode(signUp, "email", "1", true, fakeFetch(status, body).fetch)
    expect(await result(429)).toBe("rate_limited")
    expect(await result(400, { code: "AGE_DECLARATION_REQUIRED" })).toBe("age")
    expect(await result(400, { code: "INVALID_OTP" })).toBe("wrong")
    expect(await result(403, { code: "TOO_MANY_ATTEMPTS" })).toBe("wrong")
    expect(await result(409, { code: "ACCOUNT_EXISTS" })).toBe("taken")
    expect(await result(500)).toBe("failed")
  })
})

describe("codeStatus", () => {
  test("reads the delivery state, null on errors", async () => {
    const { calls, fetch } = fakeFetch(200, { status: "failed" })
    expect(await codeStatus("id-1", fetch)).toBe("failed")
    expect(bodyOf(calls[0])).toEqual({ id: "id-1" })
    expect(await codeStatus("id-1", fakeFetch(500).fetch)).toBeNull()
    expect(await codeStatus("id-1", offline)).toBeNull()
  })
})
