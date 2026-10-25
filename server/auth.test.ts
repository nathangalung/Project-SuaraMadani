import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test"
import { createHmac } from "node:crypto"
import { APIError } from "better-auth/api"
import { DrizzleQueryError } from "drizzle-orm/errors"
import { RouterContextProvider } from "react-router"
import { sessionContext, tenantContext } from "../app/context.ts"
import { twoFactorAction } from "../app/features/moderation/two-factor.server.ts"
import { addPhone } from "../app/features/report/add-phone.server.ts"
import { createDatabase } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import {
  insertOrg,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import { EMAIL_QUOTA } from "../shared/notifications.ts"
import { AGE_CONSENT_VERSION } from "../shared/report-fields.ts"
import {
  type Auth,
  authLog,
  createAuth,
  drainEmails,
  getAuth,
  readSessionWith,
  resetAuth,
  staffAccess,
  staffTotpRequired,
} from "./auth.server.ts"
import type { EmailMessage } from "./email.ts"
import type { WhatsAppGateway } from "./whatsapp.server.ts"

const su = superuserPool()
const database = createDatabase(testUrl("TEST_DATABASE_URL"), "web")
const sent: EmailMessage[] = []
const texts: {
  to: string
  code: string
  purpose?: string
  client?: string | null
}[] = []
const whatsapp = {
  isReady: true,
  // Ready, then the send fails
  sendFails: null as "unavailable" | "spacing" | null,
  logs: new Map<string, "reserved" | "sent" | "failed">(),
}

// Fake sender, no WhatsApp
const fakeWhatsApp: WhatsAppGateway = {
  ready: async () => whatsapp.isReady,
  sendCode: async (to, code, purpose) => {
    if (!whatsapp.isReady) return { ok: false, reason: "unavailable" }
    if (whatsapp.sendFails) return { ok: false, reason: whatsapp.sendFails }
    const logId = crypto.randomUUID()
    texts.push({
      to,
      code,
      purpose: purpose?.purpose,
      client: purpose?.client,
    })
    whatsapp.logs.set(logId, "reserved")
    return { ok: true, logId }
  },
  status: async (logId) => whatsapp.logs.get(logId) ?? null,
}

const securityLines: Record<string, unknown>[] = []
const auth = createAuth({
  db: database.db,
  hosts: ["itb.localhost", "ugm.localhost"],
  dev: true,
  securityLog: (line) => securityLines.push(line),
  email: {
    send: async (message) => {
      sent.push(message)
    },
  },
  hashKey: () => Buffer.alloc(32, 5),
  verifyCaptcha: async (token) =>
    token === "pass" ? { ok: true } : { ok: false, reason: "rejected" },
  whatsapp: fakeWhatsApp,
  secrets: [{ version: 1, value: "test-secret-test-secret-test-secret-1" }],
})

const origin = "http://itb.localhost"

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...headers },
      body: JSON.stringify(body),
    }),
  )
}

/** Name=value pairs from Set-Cookie. */
function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c?.endsWith("="))
    .join("; ")
}

let phoneSeq = 0
/** Unique test mobile number. */
function nextPhone(): string {
  phoneSeq += 1
  return `+62812${String(Date.now() % 1e5).padStart(5, "0")}${String(phoneSeq).padStart(3, "0")}`
}

const captcha = { "x-captcha-response": "pass" }

type SendBody =
  | { mode: "sign-in"; identifier: string; channel: "email" | "whatsapp" }
  | {
      mode: "sign-up"
      name: string
      email: string
      phone: string
      channel: "email" | "whatsapp"
    }

/** Sends, then reads the code. */
async function requestCode(
  body: SendBody,
  headers: Record<string, string> = {},
): Promise<string> {
  const emails = sent.length
  const chats = texts.length
  const res = await post("/account/send-code", body, { ...captcha, ...headers })
  expect(res.status).toBe(200)
  if (body.channel === "whatsapp") {
    const code = texts.at(-1)?.code
    if (texts.length === chats || !code) throw new Error("no code sent")
    return code
  }
  // Send is not awaited, poll
  for (let i = 0; i < 100 && sent.length === emails; i++) await Bun.sleep(10)
  const code = /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? "")?.[1]
  if (!code) throw new Error("no code sent")
  return code
}

const ageBox = {
  ageDeclaration: { age_18_plus: true, ageConsentVersion: AGE_CONSENT_VERSION },
}

function newAccount(email: string, channel: "email" | "whatsapp" = "email") {
  return {
    mode: "sign-up" as const,
    name: "Warga Uji",
    email,
    phone: nextPhone(),
    channel,
  }
}

/** Daftar with the box. */
async function signUp(
  email: string,
  channel: "email" | "whatsapp" = "email",
): Promise<Response> {
  const body = newAccount(email, channel)
  const code = await requestCode(body)
  return post("/account/verify-code", { ...body, code, ...ageBox })
}

/** Masuk, code by email. */
async function signIn(email: string): Promise<Response> {
  const body = {
    mode: "sign-in" as const,
    identifier: email,
    channel: "email" as const,
  }
  const code = await requestCode(body)
  return post("/account/verify-code", { ...body, code })
}

async function userRow(email: string) {
  const { rows } = await su.query<{
    name: string
    phone_number: string | null
    email_verified: boolean
    phone_verified: boolean
    age_declared_at: Date | null
    age_consent_version: string | null
  }>(
    `SELECT name, phone_number, email_verified, phone_verified,
       age_declared_at, age_consent_version FROM users WHERE email = $1`,
    [email],
  )
  return rows[0]
}

/** Daftar with a given body. */
async function signUpWith(body: ReturnType<typeof newAccount>) {
  const code = await requestCode(body)
  const res = await post("/account/verify-code", { ...body, code, ...ageBox })
  expect(res.status).toBe(200)
  return res
}

// RFC 6238, test only
function base32(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0")
  }
  const bytes = bits.match(/.{8}/g) ?? []
  return Buffer.from(bytes.map((b) => Number.parseInt(b, 2)))
}

function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const mac = createHmac("sha1", base32(secret)).update(counter).digest()
  const offset = (mac.at(-1) ?? 0) & 0xf
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(value).padStart(6, "0")
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
})

afterAll(async () => {
  await resetData(su)
  await database.pool.end()
  await su.end()
})

describe("code request", () => {
  test("needs a Turnstile token", async () => {
    const before = sent.length
    const res = await post("/account/send-code", newAccount("warga1@contoh.id"))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("CAPTCHA_FAILED")
    expect(sent.length).toBe(before)
  })

  test("sends an Indonesian email with a 6-digit code", async () => {
    await requestCode(newAccount("warga1@contoh.id"))
    const message = sent.at(-1)
    expect(message?.to).toBe("warga1@contoh.id")
    expect(message?.subject).toContain("Kode verifikasi")
    expect(message?.text).toContain("5 menit")
    expect(message?.html).toContain("5 menit")
  })

  test("each email code is counted in email_log", async () => {
    const { rows: before } = await su.query(
      "SELECT 1 FROM email_log WHERE kind = 'otp'",
    )
    await requestCode(newAccount("warga-log@contoh.id"))
    await Bun.sleep(30)
    const { rows } = await su.query<{ status: string; address_hash: string }>(
      "SELECT status, address_hash FROM email_log WHERE kind = 'otp' ORDER BY created_at DESC",
    )
    expect(rows.length).toBe(before.length + 1)
    expect(rows[0]?.status).toBe("sent")
    expect(rows[0]?.address_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test("a stored code never names the email or number", async () => {
    await su.query("DELETE FROM verifications")
    const body = newAccount("kunci-kode@contoh.id")
    const code = await requestCode(body)
    const { rows } = await su.query<{ identifier: string }>(
      "SELECT identifier FROM verifications WHERE identifier LIKE '%kunci-kode%' OR identifier LIKE $1",
      [`%${body.phone.slice(3)}%`],
    )
    expect(rows).toEqual([])
    const res = await post("/account/verify-code", { ...body, code, ...ageBox })
    expect(res.status).toBe(200)
  })

  test("no other fields, no upstream OTP routes", async () => {
    const before = sent.length
    for (const body of [
      { ...newAccount("warga1@contoh.id"), callbackURL: "/" },
      { ...newAccount("warga1@contoh.id"), type: "sign-in" },
      { ...newAccount("warga1@contoh.id"), emailVerified: true },
    ]) {
      const res = await post("/account/send-code", body, captcha)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("FIELD_NOT_ALLOWED")
    }
    for (const path of [
      "/email-otp/send-verification-otp",
      "/sign-in/email-otp",
      "/phone-number/send-otp",
      "/phone-number/verify",
    ]) {
      const res = await post(
        path,
        { email: "warga1@contoh.id", phoneNumber: "+6281234567890" },
        captcha,
      )
      expect([path, res.status]).toEqual([path, 404])
    }
    await Bun.sleep(20)
    expect(sent.length).toBe(before)
  })

  test("Indonesian mobile numbers only, names in plain letters", async () => {
    for (const [field, value, code] of [
      ["phone", "0221234567", "INVALID_PHONE"],
      ["phone", "+14155550100", "INVALID_PHONE"],
      ["email", "warga", "INVALID_EMAIL"],
      ["name", "<b>Admin</b>", "INVALID_NAME"],
      ["name", "A", "INVALID_NAME"],
    ] as const) {
      const res = await post(
        "/account/send-code",
        { ...newAccount("format@contoh.id"), [field]: value },
        captcha,
      )
      expect([field, value, res.status]).toEqual([field, value, 400])
      expect((await res.json()).code).toBe(code)
    }
  })
})

describe("Daftar", () => {
  test("by email: email verified, phone stored unverified", async () => {
    const body = newAccount("daftar.email@contoh.id")
    const code = await requestCode(body)
    const res = await post("/account/verify-code", {
      ...body,
      phone: body.phone.replace("+62", "0"),
      code,
      ...ageBox,
    })
    expect(res.status).toBe(200)
    const row = await userRow("daftar.email@contoh.id")
    expect(row).toMatchObject({
      name: "Warga Uji",
      phone_number: body.phone,
      email_verified: true,
      phone_verified: false,
      age_consent_version: AGE_CONSENT_VERSION,
    })
    expect(row?.age_declared_at).toBeInstanceOf(Date)
    const setCookie = res.headers.getSetCookie().join("\n")
    // Dev http lacks __Secure- prefix
    expect(setCookie).toContain("sb.session_token=")
    expect(setCookie.toLowerCase()).not.toContain("domain=")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("SameSite=Lax")
  })

  test("by WhatsApp: phone verified, code never emailed", async () => {
    const before = sent.length
    const body = newAccount("daftar.wa@contoh.id", "whatsapp")
    const code = await requestCode(body)
    expect(texts.at(-1)).toMatchObject({ to: body.phone, purpose: "sign-up" })
    const res = await post("/account/verify-code", { ...body, code, ...ageBox })
    expect(res.status).toBe(200)
    expect(await userRow("daftar.wa@contoh.id")).toMatchObject({
      email_verified: false,
      phone_verified: true,
    })
    expect(sent.length).toBe(before)
  })

  test("without the box: no user, and the code still works", async () => {
    const body = newAccount("anak@contoh.id")
    const code = await requestCode(body)
    for (const box of [
      {},
      {
        ageDeclaration: {
          age_18_plus: false,
          ageConsentVersion: AGE_CONSENT_VERSION,
        },
      },
      {
        ageDeclaration: {
          age_18_plus: "on",
          ageConsentVersion: AGE_CONSENT_VERSION,
        },
      },
      {
        ageDeclaration: { age_18_plus: true, ageConsentVersion: "2020-01-01" },
      },
    ]) {
      const res = await post("/account/verify-code", { ...body, code, ...box })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("AGE_DECLARATION_REQUIRED")
      expect(cookies(res)).not.toContain("session_token")
    }
    expect(await userRow("anak@contoh.id")).toBeUndefined()
    const res = await post("/account/verify-code", { ...body, code, ...ageBox })
    expect(res.status).toBe(200)
  })

  test("user fields cannot be set directly", async () => {
    const body = newAccount("trik@contoh.id")
    const code = await requestCode(body)
    for (const extra of [
      { ageDeclaredAt: "2000-01-01" },
      { image: "https://pelacak.example/p.gif" },
      { emailVerified: true },
      { phoneVerified: true },
      { phoneNumber: "+6281299990000" },
    ]) {
      const res = await post("/account/verify-code", {
        ...body,
        code,
        ...ageBox,
        ...extra,
      })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe("FIELD_NOT_ALLOWED")
    }
    expect(await userRow("trik@contoh.id")).toBeUndefined()
  })

  test("one account per email and per number", async () => {
    const first = newAccount("pemilik@contoh.id")
    await signUpWith(first)
    const second = newAccount("pemilik.wa@contoh.id", "whatsapp")
    await signUpWith(second)
    for (const [body, error] of [
      [{ ...newAccount("PEMILIK@contoh.id") }, "EMAIL_TAKEN"],
      [{ ...newAccount("lain@contoh.id"), phone: second.phone }, "PHONE_TAKEN"],
    ] as const) {
      const res = await post("/account/send-code", body, captcha)
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe(error)
    }
    const check = await post("/account/check-new", {
      name: "Warga Uji",
      email: "baru@contoh.id",
      phone: second.phone,
    })
    expect(await check.json()).toMatchObject({ taken: "phone" })
    // Unproven number: prove it
    const pending = await post("/account/check-new", {
      name: "Warga Uji",
      email: "baru@contoh.id",
      phone: first.phone,
    })
    expect(await pending.json()).toMatchObject({
      taken: null,
      only: "whatsapp",
    })
  })

  test("check-new masks both destinations", async () => {
    const res = await post("/account/check-new", {
      name: "Warga Uji",
      email: "calon@contoh.id",
      phone: "081234567890",
    })
    expect(await res.json()).toEqual({
      taken: null,
      only: null,
      email: "ca•••@contoh.id",
      whatsapp: "+62 812•••••890",
      whatsappReady: true,
    })
  })
})

/** Second channel proven later. */
async function provePhone(phone: string) {
  await su.query(
    "UPDATE users SET phone_verified = true WHERE phone_number = $1",
    [phone],
  )
}

describe("Masuk", () => {
  test("lookup masks only the identifier typed", async () => {
    const body = newAccount("cari@contoh.id")
    await signUpWith(body)
    await provePhone(body.phone)
    const local = body.phone.replace("+62", "0")
    const byEmail = await post("/account/lookup", {
      identifier: "Cari@contoh.id",
    })
    expect(await byEmail.json()).toEqual({
      found: true,
      email: { kind: "masked", value: "ca•••@contoh.id" },
      whatsapp: { kind: "registered" },
      whatsappReady: true,
    })
    const byPhone = await post("/account/lookup", { identifier: local })
    expect(await byPhone.json()).toEqual({
      found: true,
      email: { kind: "registered" },
      whatsapp: {
        kind: "masked",
        value: `+62 812•••••${body.phone.slice(-3)}`,
      },
      whatsappReady: true,
    })
    const missing = await post("/account/lookup", {
      identifier: "tidak.ada@contoh.id",
    })
    expect(await missing.json()).toEqual({ found: false })
    const bad = await post("/account/lookup", { identifier: "0221234567" })
    expect(bad.status).toBe(400)
  })

  test("lookup never links one identifier to the other", async () => {
    const body = newAccount("tautan@kampus.ac.id")
    await signUpWith(body)
    await provePhone(body.phone)
    const national = body.phone.replace("+62", "")
    const byPhone = await (
      await post("/account/lookup", { identifier: body.phone })
    ).text()
    expect(byPhone).not.toContain("@")
    expect(byPhone).not.toContain("kampus")
    const byEmail = await (
      await post("/account/lookup", { identifier: "tautan@kampus.ac.id" })
    ).text()
    for (const digits of [national.slice(0, 3), national.slice(-3)]) {
      expect(byEmail).not.toContain(digits)
    }
  })

  test("phone identifier, code by email, never the full address", async () => {
    const body = newAccount("silang@contoh.id")
    await signUpWith(body)
    await provePhone(body.phone)
    const signInBody = {
      mode: "sign-in" as const,
      identifier: body.phone,
      channel: "email" as const,
    }
    const before = sent.length
    const res = await post("/account/send-code", signInBody, captcha)
    expect(await res.json()).toEqual({
      channel: "email",
      to: "si•••@contoh.id",
      statusId: null,
    })
    for (let i = 0; i < 100 && sent.length === before; i++) await Bun.sleep(10)
    expect(sent.at(-1)?.to).toBe("silang@contoh.id")
    const code = /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? "")?.[1] ?? ""
    const done = await post("/account/verify-code", { ...signInBody, code })
    expect(done.status).toBe(200)
    expect(cookies(done)).toContain("sb.session_token=")
  })

  test("the channel that got the code becomes verified", async () => {
    await signUp("verif@contoh.id")
    expect((await userRow("verif@contoh.id"))?.phone_verified).toBe(false)
    const body = {
      mode: "sign-in" as const,
      identifier: "verif@contoh.id",
      channel: "whatsapp" as const,
    }
    const code = await requestCode(body, { "x-client-ip": "203.0.113.9" })
    // Unproven number: Daftar caps apply
    expect(texts.at(-1)).toMatchObject({
      purpose: "sign-up",
      client: "203.0.113.9",
    })
    const res = await post("/account/verify-code", { ...body, code })
    expect(res.status).toBe(200)
    expect(await userRow("verif@contoh.id")).toMatchObject({
      email_verified: true,
      phone_verified: true,
    })
    await requestCode(body, { "x-client-ip": "203.0.113.10" })
    // Proven: per-client sign-in caps
    expect(texts.at(-1)).toMatchObject({
      purpose: "sign-in",
      client: "203.0.113.10",
    })
  })

  test("signing in again ends the earlier session", async () => {
    // ASVS V7.2.4: old token ends
    const email = "ulang.masuk@contoh.id"
    const cookie = cookies(await signUp(email))
    const body = {
      mode: "sign-in" as const,
      identifier: email,
      channel: "email" as const,
    }
    const code = await requestCode(body, { cookie })
    const again = await post(
      "/account/verify-code",
      { ...body, code },
      { cookie },
    )
    expect(again.status).toBe(200)
    const read = (value: string) =>
      readSessionWith(
        auth,
        new Headers({ cookie: value, host: "itb.localhost" }),
      )
    expect((await read(cookie)).session).toBeNull()
    expect((await read(cookies(again))).session?.user.email).toBe(email)
    const { rows } = await su.query(
      "SELECT 1 FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      [email],
    )
    expect(rows).toHaveLength(1)
  })

  test("an unknown account gets no code", async () => {
    const res = await post(
      "/account/send-code",
      { mode: "sign-in", identifier: "hantu@contoh.id", channel: "email" },
      captcha,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe("ACCOUNT_NOT_FOUND")
  })

  test("a refused code is a security event, no contact", async () => {
    // OWASP A09: alertable auth failures
    const email = "salah.kode@contoh.id"
    await signUp(email)
    const body = {
      mode: "sign-in" as const,
      identifier: email,
      channel: "email" as const,
    }
    await requestCode(body)
    securityLines.length = 0
    const res = await post("/account/verify-code", { ...body, code: "000000" })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(securityLines).toHaveLength(1)
    expect(securityLines[0]).toMatchObject({
      msg: "security",
      event: "auth_refused",
      host: "itb.localhost",
      path: "/account/verify-code",
      status: res.status,
    })
    expect(JSON.stringify(securityLines)).not.toContain(email)
    securityLines.length = 0
    const noCaptcha = await post("/account/send-code", body)
    expect(noCaptcha.status).toBe(403)
    expect(securityLines[0]).toMatchObject({
      event: "auth_refused",
      code: "CAPTCHA_FAILED",
    })
  })

  test("every sign-in step is a security event", async () => {
    // ASVS V16.3.1: outcome, factor, subject
    const email = "jejak.masuk@contoh.id"
    await signUp(email)
    const body = {
      mode: "sign-in" as const,
      identifier: email,
      channel: "email" as const,
    }
    const code = await requestCode(body)
    securityLines.length = 0
    await post("/account/verify-code", { ...body, code: "000000" })
    const ok = await post("/account/verify-code", { ...body, code })
    expect(ok.status).toBe(200)
    const { rows } = await su.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    )
    const subject = securityLines[0]?.subject_hash
    expect(subject).toMatch(/^[0-9a-f]{64}$/)
    expect(securityLines).toEqual([
      expect.objectContaining({ event: "auth_refused", factor: "email" }),
      expect.objectContaining({
        event: "auth_ok",
        host: "itb.localhost",
        path: "/account/verify-code",
        factor: "email",
        user_id: rows[0]?.id,
        subject_hash: subject,
      }),
    ])
    securityLines.length = 0
    await post("/sign-out", {}, { cookie: cookies(ok) })
    expect(securityLines).toEqual([
      expect.objectContaining({
        event: "auth_ok",
        path: "/sign-out",
        factor: "sign_out",
        user_id: rows[0]?.id,
      }),
    ])
    expect(JSON.stringify(securityLines)).not.toContain(email)
  })

  test("a failed code email reaches the error stream", async () => {
    // ASVS V16.3.4: provider outage
    const failing = createAuth({
      db: database.db,
      hosts: ["itb.localhost"],
      dev: true,
      securityLog: () => {},
      email: {
        send: async () => {
          throw new Error("provider down for gagal.kirim@contoh.id")
        },
      },
      hashKey: () => Buffer.alloc(32, 5),
      verifyCaptcha: async () => ({ ok: true }),
      whatsapp: fakeWhatsApp,
      secrets: [{ version: 1, value: "test-secret-test-secret-test-secret-1" }],
    })
    const lines: string[] = []
    const spy = spyOn(console, "error").mockImplementation((line) => {
      lines.push(String(line))
    })
    try {
      const res = await failing.handler(
        new Request(`${origin}/api/auth/account/send-code`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify(newAccount("gagal.kirim@contoh.id")),
        }),
      )
      expect(res.status).toBe(200)
      await drainEmails()
    } finally {
      spy.mockRestore()
    }
    const failed = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.msg === "otp email failed")
    expect(failed).toEqual([
      expect.objectContaining({ level: "error", error: "Error" }),
    ])
    expect(lines.join()).not.toContain("gagal.kirim@contoh.id")
  })

  test("three wrong codes end the code; a code works once", async () => {
    await signUp("salah@contoh.id")
    const body = {
      mode: "sign-in" as const,
      identifier: "salah@contoh.id",
      channel: "email" as const,
    }
    const code = await requestCode(body)
    const wrong = code === "000000" ? "111111" : "000000"
    for (let i = 0; i < 3; i++) {
      const res = await post("/account/verify-code", { ...body, code: wrong })
      expect(res.status).toBe(400)
    }
    const late = await post("/account/verify-code", { ...body, code })
    expect(late.status).toBe(400)
    const fresh = await requestCode(body)
    expect(
      (await post("/account/verify-code", { ...body, code: fresh })).status,
    ).toBe(200)
    expect(
      (await post("/account/verify-code", { ...body, code: fresh })).status,
    ).toBe(400)
  })

  test("WhatsApp down: refused with a hint, email still works", async () => {
    await signUp("cadangan@contoh.id")
    whatsapp.isReady = false
    try {
      const lookup = await post("/account/lookup", {
        identifier: "cadangan@contoh.id",
      })
      expect(await lookup.json()).toMatchObject({ whatsappReady: false })
      const res = await post(
        "/account/send-code",
        {
          mode: "sign-in",
          identifier: "cadangan@contoh.id",
          channel: "whatsapp",
        },
        captcha,
      )
      expect(res.status).toBe(503)
      expect((await res.json()).code).toBe("WHATSAPP_UNAVAILABLE")
      expect((await signIn("cadangan@contoh.id")).status).toBe(200)
    } finally {
      whatsapp.isReady = true
    }
  })

  test("a refused resend keeps the code already sent", async () => {
    await signUp("ulang@contoh.id")
    const body = {
      mode: "sign-in" as const,
      identifier: "ulang@contoh.id",
      channel: "whatsapp" as const,
    }
    const code = await requestCode(body)
    whatsapp.isReady = false
    try {
      const again = await post("/account/send-code", body, captcha)
      expect(again.status).toBe(503)
    } finally {
      whatsapp.isReady = true
    }
    const res = await post("/account/verify-code", { ...body, code })
    expect(res.status).toBe(200)
  })

  test("a WhatsApp send reports its delivery state", async () => {
    await signUp("status@contoh.id")
    const res = await post(
      "/account/send-code",
      { mode: "sign-in", identifier: "status@contoh.id", channel: "whatsapp" },
      captcha,
    )
    const { statusId, to } = (await res.json()) as {
      statusId: string
      to: string
    }
    expect(to).toMatch(/^\+62 812•+\d{3}$/)
    expect(
      await (await post("/account/code-status", { id: statusId })).json(),
    ).toEqual({
      status: "reserved",
    })
    whatsapp.logs.set(statusId, "failed")
    expect(
      await (await post("/account/code-status", { id: statusId })).json(),
    ).toEqual({
      status: "failed",
    })
    expect((await post("/account/code-status", { id: "x" })).status).toBe(400)
  })
})

async function idOf(where: "email" | "phone_number", value: string) {
  const { rows } = await su.query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE ${where} = $1`,
    [value],
  )
  return rows[0]
}

async function sessionUserId(res: Response): Promise<string | undefined> {
  const read = await readSessionWith(
    auth,
    new Headers({ cookie: cookies(res), host: "itb.localhost" }),
  )
  return read.session?.user.id
}

describe("session flags", () => {
  test("the session says whether the number is proven", async () => {
    for (const [email, channel, proven] of [
      ["sesi.wa@contoh.id", "whatsapp", true],
      ["sesi.email@contoh.id", "email", false],
    ] as const) {
      const res = await signUp(email, channel)
      expect(res.status).toBe(200)
      const read = await readSessionWith(
        auth,
        new Headers({ cookie: cookies(res), host: "itb.localhost" }),
      )
      expect(read.session?.user.phoneVerified).toBe(proven)
      expect(read.session?.user.emailVerified).toBe(!proven)
    }
  })
})

describe("unverified identifiers", () => {
  test("a pre-registered email cannot take over its owner", async () => {
    const victimEmail = "korban.prehijack@contoh.id"
    // Attacker: victim email, own number
    const attacker = { ...newAccount(victimEmail, "whatsapp") }
    await signUpWith(attacker)
    const attackerId = (await idOf("phone_number", attacker.phone))?.id
    // Victim sees it unproven
    const look = await post("/account/lookup", { identifier: victimEmail })
    expect(await look.json()).toEqual({ found: false, unproven: true })
    const victim = newAccount(victimEmail)
    const check = await post("/account/check-new", {
      name: victim.name,
      email: victim.email,
      phone: victim.phone,
    })
    expect(await check.json()).toMatchObject({ taken: null, only: "email" })
    // Victim proves the email
    const victimRes = await signUpWith(victim)
    const victimRow = await idOf("email", victimEmail)
    expect(victimRow?.id).toBeDefined()
    expect(victimRow?.id).not.toBe(attackerId)
    expect(await sessionUserId(victimRes)).toBe(victimRow?.id)
    expect(await userRow(victimEmail)).toMatchObject({
      phone_number: victim.phone,
      email_verified: true,
    })
    // Attacker keeps only theirs
    const again = {
      mode: "sign-in" as const,
      identifier: attacker.phone,
      channel: "whatsapp" as const,
    }
    const code = await requestCode(again)
    const attackerRes = await post("/account/verify-code", { ...again, code })
    expect(attackerRes.status).toBe(200)
    expect(await sessionUserId(attackerRes)).toBe(attackerId)
    const released = await idOf("phone_number", attacker.phone)
    expect(released?.email).toEndWith(".invalid")
    const lookup = await post("/account/lookup", { identifier: attacker.phone })
    expect(await lookup.json()).toMatchObject({ found: true, email: null })
    const byEmail = await post(
      "/account/send-code",
      { ...again, channel: "email" },
      captcha,
    )
    expect(byEmail.status).toBe(400)
    expect((await byEmail.json()).code).toBe("NO_EMAIL")
  })

  test("an unverified number never signs in and moves to its prover", async () => {
    const squatter = newAccount("penyerobot.nomor@contoh.id")
    await signUpWith(squatter)
    const res = await post(
      "/account/send-code",
      { mode: "sign-in", identifier: squatter.phone, channel: "whatsapp" },
      captcha,
    )
    expect(res.status).toBe(404)
    // Masuk explains the number
    const looked = await post("/account/lookup", { identifier: squatter.phone })
    expect(await looked.json()).toEqual({ found: false, unproven: true })
    const stamp = async () =>
      (
        await su.query<{ updated_at: Date }>(
          "SELECT updated_at FROM users WHERE email = $1",
          ["penyerobot.nomor@contoh.id"],
        )
      ).rows[0]?.updated_at
    const before = await stamp()
    const owner = {
      ...newAccount("pemilik.nomor@contoh.id"),
      phone: squatter.phone,
    }
    // Number awaits proof elsewhere
    const byEmail = await post("/account/send-code", owner, captcha)
    expect(byEmail.status).toBe(409)
    expect((await byEmail.json()).code).toBe("PHONE_PENDING")
    await signUpWith({ ...owner, channel: "whatsapp" })
    expect(await userRow("pemilik.nomor@contoh.id")).toMatchObject({
      phone_number: squatter.phone,
      phone_verified: true,
    })
    expect(
      (await userRow("penyerobot.nomor@contoh.id"))?.phone_number,
    ).toBeNull()
    // No silent staff sign-out
    expect(await stamp()).toEqual(before)
  })

  test("an unknown identifier is simply missing", async () => {
    const looked = await post("/account/lookup", { identifier: "081299990777" })
    expect(await looked.json()).toEqual({ found: false })
  })

  test("both identifiers awaiting proof elsewhere are refused", async () => {
    const a = newAccount("dua.a@contoh.id", "whatsapp")
    await signUpWith(a)
    const b = newAccount("dua.b@contoh.id")
    await signUpWith(b)
    const res = await post("/account/check-new", {
      name: "Warga Uji",
      email: "dua.a@contoh.id",
      phone: b.phone,
    })
    expect(await res.json()).toMatchObject({ taken: "pending" })
  })

  test("a code proves only the number it went to", async () => {
    const a = newAccount("ikat.a@contoh.id")
    await signUpWith(a)
    const masuk = {
      mode: "sign-in" as const,
      identifier: "ikat.a@contoh.id",
      channel: "whatsapp" as const,
    }
    const code = await requestCode(masuk)
    expect(texts.at(-1)?.to).toBe(a.phone)
    // Number released, then another added
    await signUpWith({
      ...newAccount("ikat.b@contoh.id", "whatsapp"),
      phone: a.phone,
    })
    const victim = nextPhone()
    const id = (await idOf("email", "ikat.a@contoh.id"))?.id ?? ""
    expect(await addPhone(id, victim, database.db)).toEqual({ ok: true })
    const res = await post("/account/verify-code", { ...masuk, code })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("INVALID_OTP")
    expect(await userRow("ikat.a@contoh.id")).toMatchObject({
      phone_number: victim,
      phone_verified: false,
    })
  })

  test("a reserved address is never an identifier", async () => {
    const res = await post("/account/lookup", {
      identifier: "x@dilepas.invalid",
    })
    expect(res.status).toBe(400)
  })
})

describe("staff step-up", () => {
  test("TOTP enrollment then email OTP alone gives no session", async () => {
    const orgId = await insertOrg(su, "stf")
    const email = "moderator@contoh.id"
    const first = await signUp(email)
    expect(first.status).toBe(200)
    const emailOnly = cookies(first)

    const enable = await post("/two-factor/enable", {}, { cookie: emailOnly })
    expect(enable.status).toBe(200)
    const { totpURI, backupCodes } = (await enable.json()) as {
      totpURI: string
      backupCodes: string[]
    }
    const secret = new URL(totpURI).searchParams.get("secret") ?? ""

    const trusted = await post(
      "/two-factor/verify-totp",
      { code: totp(secret), trustDevice: true },
      { cookie: emailOnly },
    )
    expect(trusted.status).toBe(400)
    expect(await trusted.json()).toMatchObject({
      code: "TRUST_DEVICE_DISABLED",
    })

    const trustedBackup = await post(
      "/two-factor/verify-backup-code",
      { code: backupCodes[0], trustDevice: true },
      { cookie: emailOnly },
    )
    expect(trustedBackup.status).toBe(400)
    expect(await trustedBackup.json()).toMatchObject({
      code: "TRUST_DEVICE_DISABLED",
    })

    const verify = await post(
      "/two-factor/verify-totp",
      { code: totp(secret) },
      { cookie: emailOnly },
    )
    expect(verify.status).toBe(200)
    const enrolled = cookies(verify)
    expect(enrolled).toContain("sb.session_token=")

    const again = await signIn(email)
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ twoFactorRedirect: true })
    expect(cookies(again)).not.toContain("sb.session_token")
    const challenge = cookies(again)
    expect(challenge).toContain("sb.two_factor")

    // WhatsApp code alone: same challenge
    const viaWhatsApp = {
      mode: "sign-in" as const,
      identifier: email,
      channel: "whatsapp" as const,
    }
    const chat = await post("/account/verify-code", {
      ...viaWhatsApp,
      code: await requestCode(viaWhatsApp),
    })
    expect(await chat.json()).toMatchObject({ twoFactorRedirect: true })
    expect(cookies(chat)).not.toContain("sb.session_token")

    // Enrolment spent this step, reset
    await su.query(
      "UPDATE two_factors SET last_totp_step = NULL WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      [email],
    )
    const stepUp = await post(
      "/two-factor/verify-totp",
      { code: totp(secret) },
      { cookie: challenge },
    )
    expect(stepUp.status).toBe(200)
    const staff = cookies(stepUp)
    expect(staff).toContain("sb.session_token=")

    // Real admin of real org
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) SELECT $1, id, 'admin' FROM users WHERE email = $2",
      [orgId, email],
    )
    for (const path of [
      "/organization/get-full-organization",
      "/organization/list-members",
      "/organization/update-member-role",
      "/organization/invite-member",
      "/organization/create",
      "/two-factor/get-totp-uri",
      "/two-factor/generate-backup-codes",
      "/two-factor/disable",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/sign-up/email",
      "/update-user",
      "/delete-user",
      "/list-sessions",
    ]) {
      const res = await post(
        path,
        { organizationId: orgId, email, role: "admin", memberId: "x" },
        { cookie: staff },
      )
      expect([path, res.status]).toEqual([path, 404])
    }
    const getFull = await auth.handler(
      new Request(
        `${origin}/api/auth/organization/get-full-organization?organizationId=${orgId}`,
        { headers: { cookie: staff, origin } },
      ),
    )
    expect(getFull.status).toBe(404)
    const { rows } = await su.query(
      "SELECT two_factor_enabled FROM users WHERE email = $1",
      [email],
    )
    expect(rows[0]?.two_factor_enabled).toBe(true)
  })
})

describe("staff second factor", () => {
  test("a TOTP code works once; a backup code signs in", async () => {
    const email = "sekali@contoh.id"
    const first = await signUp(email)
    const emailOnly = cookies(first)
    const enable = await post("/two-factor/enable", {}, { cookie: emailOnly })
    const { totpURI, backupCodes } = (await enable.json()) as {
      totpURI: string
      backupCodes: string[]
    }
    const secret = new URL(totpURI).searchParams.get("secret") ?? ""
    // ASVS V6.5.2: 119-bit codes
    expect(backupCodes).toHaveLength(10)
    for (const backup of backupCodes) {
      expect(backup).toMatch(/^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){3}$/)
    }
    expect(new Set(backupCodes).size).toBe(10)
    const code = totp(secret)
    const enrol = await post(
      "/two-factor/verify-totp",
      { code },
      { cookie: emailOnly },
    )
    expect(enrol.status).toBe(200)
    expect(securityLines.at(-1)).toMatchObject({
      event: "auth_ok",
      factor: "totp",
    })

    const challenge = async () => {
      const res = await signIn(email)
      return cookies(res)
    }
    // Same code, fresh challenge
    const replay = await post(
      "/two-factor/verify-totp",
      { code },
      { cookie: await challenge() },
    )
    expect(replay.status).toBe(401)
    expect(cookies(replay)).not.toContain("sb.session_token=")

    // ASVS V6.5.5: no future step
    const future = await post(
      "/two-factor/verify-totp",
      { code: totp(secret, Date.now() + 30_000) },
      { cookie: await challenge() },
    )
    expect(future.status).toBe(401)
    expect((await future.json()).code).toBe("INVALID_CODE")
    // Enrolment spent this step, reset
    await su.query(
      "UPDATE two_factors SET last_totp_step = NULL WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      [email],
    )
    const next = await post(
      "/two-factor/verify-totp",
      { code: totp(secret) },
      { cookie: await challenge() },
    )
    expect(next.status).toBe(200)

    const sessionless = await post(
      "/two-factor/verify-backup-code",
      { code: backupCodes[1], disableSession: true },
      { cookie: await challenge() },
    )
    expect(sessionless.status).toBe(400)

    // Same code, still unused
    const backup = await post(
      "/two-factor/verify-backup-code",
      { code: backupCodes[1] },
      { cookie: await challenge() },
    )
    expect(backup.status).toBe(200)
    expect(cookies(backup)).toContain("sb.session_token=")
    expect(securityLines.at(-1)).toMatchObject({
      event: "auth_ok",
      factor: "backup_code",
    })

    // Step-up: in-process, session cookie
    const signedIn = new Headers({
      cookie: cookies(next),
      origin,
      host: "itb.localhost",
    })
    const stepUp = (at: number) =>
      auth.api
        .verifyTOTP({ headers: signedIn, body: { code: totp(secret, at) } })
        .then(
          () => true,
          () => false,
        )
    // Steps above were spent, reset
    await su.query(
      "UPDATE two_factors SET last_totp_step = NULL WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      [email],
    )
    expect(await stepUp(Date.now())).toBe(true)
    // A used step cannot repeat
    expect(await stepUp(Date.now())).toBe(false)
    expect(await stepUp(Date.now() + 10 * 60_000)).toBe(false)
  })
})

describe("in-process second factor", () => {
  /** Lines added by one step. */
  async function linesOf(step: () => Promise<unknown>) {
    const before = securityLines.length
    await step()
    return securityLines.slice(before)
  }

  // A code no window accepts
  function wrongCode(secret: string): string {
    const near = [-30_000, 0, 30_000].map((d) => totp(secret, Date.now() + d))
    return ["000000", "111111", "222222", "333333"].find(
      (code) => !near.includes(code),
    ) as string
  }

  test("TOTP and backup codes are logged without an HTTP request", async () => {
    // ASVS V16.3.1: the /masuk/dua-langkah path
    const email = "dalam.proses@contoh.id"
    const cookie = cookies(await signUp(email))
    const signedIn = new Headers({ cookie, origin, host: "itb.localhost" })
    let secret = ""
    const enrol = await linesOf(async () => {
      const result = await auth.api.enableTwoFactor({
        headers: signedIn,
        body: { method: "totp" },
      })
      if (result.method !== "totp") throw new Error("no TOTP")
      secret = new URL(result.totpURI).searchParams.get("secret") ?? ""
    })
    expect(enrol).toEqual([
      expect.objectContaining({
        event: "auth_ok",
        factor: "totp_enrol",
        host: "itb.localhost",
      }),
    ])
    const verified = await linesOf(() =>
      auth.api.verifyTOTP({ headers: signedIn, body: { code: totp(secret) } }),
    )
    expect(verified).toEqual([
      expect.objectContaining({ event: "auth_ok", factor: "totp" }),
    ])

    const challenge = new Headers({
      cookie: cookies(await signIn(email)),
      origin,
      host: "itb.localhost",
    })
    let status = 0
    const wrongTotp = await linesOf(async () => {
      const res = await auth.api.verifyTOTP({
        headers: challenge,
        body: { code: wrongCode(secret) },
        asResponse: true,
      })
      status = res.status
    })
    expect(status).toBe(401)
    expect(wrongTotp).toEqual([
      expect.objectContaining({
        event: "auth_refused",
        factor: "totp",
        host: "itb.localhost",
        code: "INVALID_CODE",
      }),
    ])
    const wrongBackup = await linesOf(async () => {
      const res = await auth.api.verifyBackupCode({
        headers: challenge,
        body: { code: "AAAAA-AAAAA-AAAAA-AAAAA" },
        asResponse: true,
      })
      status = res.status
    })
    expect(status).toBe(401)
    expect(wrongBackup).toEqual([
      expect.objectContaining({ event: "auth_refused", factor: "backup_code" }),
    ])

    // The page action, real auth
    const context = new RouterContextProvider()
    context.set(tenantContext, {
      id: crypto.randomUUID(),
      slug: "itb",
      host: "itb.localhost",
      name: "",
      campusCode: "ITB",
      campusName: "",
      theme: {},
      settings: {},
    })
    context.set(sessionContext, null)
    const page = (body: Record<string, string>) =>
      twoFactorAction(
        {
          request: new Request("http://itb.localhost/masuk/dua-langkah", {
            method: "POST",
            headers: challenge,
            body: new URLSearchParams(body),
          }),
          context,
        },
        auth,
      )
    let outcome: unknown
    const pageTotp = await linesOf(async () => {
      outcome = await page({ intent: "verify", code: wrongCode(secret) })
    })
    expect(outcome).toMatchObject({ kind: "error", error: "wrong" })
    expect(pageTotp).toEqual([
      expect.objectContaining({ event: "auth_refused", factor: "totp" }),
    ])
    const pageBackup = await linesOf(async () => {
      outcome = await page({
        intent: "backup",
        code: "BBBBB-BBBBB-BBBBB-BBBBB",
      })
    })
    expect(outcome).toEqual({ kind: "error", error: "backup_wrong" })
    expect(pageBackup).toEqual([
      expect.objectContaining({ event: "auth_refused", factor: "backup_code" }),
    ])
  })

  test("in-process sign-out leaves the line to its caller", async () => {
    // sign-out.server.ts writes it
    const cookie = cookies(await signUp("keluar.dalam@contoh.id"))
    const lines = await linesOf(() =>
      auth.api.signOut({
        headers: new Headers({ cookie, origin, host: "itb.localhost" }),
      }),
    )
    expect(lines).toEqual([])
  })
})

describe("server-only auth calls", () => {
  test("step-up rotation: new token, same start, never over HTTP", async () => {
    // ASVS V7.2.4: re-authentication rotates
    const cookie = cookies(await signUp("putar@contoh.id"))
    // TOTP account, past idle limit
    const owner = "(SELECT id FROM users WHERE email = 'putar@contoh.id')"
    await su.query(
      `UPDATE users SET two_factor_enabled = true WHERE id = ${owner}`,
    )
    await su.query(
      `UPDATE sessions SET created_at = now() - interval '2 hours',
         last_seen_at = now() - interval '1 minute' WHERE user_id = ${owner}`,
    )
    const headers = new Headers({ host: "itb.localhost", origin, cookie })
    const before = await readSessionWith(auth, headers)
    expect(before.session).not.toBeNull()
    const rotated = await auth.api.rotateSession({
      headers,
      returnHeaders: true,
    })
    const fresh = rotated.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ")
    // Step-up counts as activity
    const { rows } = await su.query<{ last_seen_at: Date | null }>(
      "SELECT last_seen_at FROM sessions WHERE id = $1",
      [rotated.response.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.last_seen_at).not.toBeNull()
    const after = await readSessionWith(
      auth,
      new Headers({ host: "itb.localhost", cookie: fresh }),
    )
    expect(after.session).not.toBeNull()
    expect(after.session?.session.id).toBe(rotated.response.id)
    expect(after.session?.session.id).not.toBe(before.session?.session.id)
    expect(after.session?.session.createdAt).toEqual(
      before.session?.session.createdAt as Date,
    )
    expect((await readSessionWith(auth, headers)).session).toBeNull()
    const res = await post("/session/rotate", {}, { cookie: fresh })
    expect(res.status).toBe(404)
  })

  test("pending backup codes are read in-process, never over HTTP", async () => {
    const email = "kode.tertunda@contoh.id"
    const first = await signUp(email)
    const cookie = cookies(first)
    const enable = await post("/two-factor/enable", {}, { cookie })
    const { backupCodes } = (await enable.json()) as { backupCodes: string[] }
    const headers = new Headers({ host: "itb.localhost", origin, cookie })
    const session = await auth.api.getSession({ headers })
    const viewed = await auth.api.viewBackupCodes({
      headers,
      body: { userId: session?.user.id ?? "" },
    })
    expect(viewed.backupCodes).toEqual(backupCodes)
    const res = await post(
      "/two-factor/view-backup-codes",
      { userId: session?.user.id },
      { cookie },
    )
    expect(res.status).toBe(404)
  })
})

describe("session token transfer", () => {
  // ASVS V3.3.4: Set-Cookie only
  test("no auth response body carries the session token", async () => {
    const email = "token.badan@contoh.id"
    const first = await signUp(email)
    const cookie = cookies(first)
    const token = (value: string) =>
      decodeURIComponent(/session_token=([^.;]+)/.exec(value)?.[1] ?? "-")
    expect(await first.text()).not.toContain(token(cookie))
    const read = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, { headers: { cookie } }),
    )
    expect(read.status).toBe(404)
    const inProcess = await auth.api.getSession({
      headers: new Headers({ host: "itb.localhost", cookie }),
    })
    expect(inProcess?.user.email).toBe(email)

    const enable = await post("/two-factor/enable", {}, { cookie })
    const { totpURI, backupCodes } = (await enable.json()) as {
      totpURI: string
      backupCodes: string[]
    }
    const secret = new URL(totpURI).searchParams.get("secret") ?? ""
    const enrol = await post(
      "/two-factor/verify-totp",
      { code: totp(secret) },
      { cookie },
    )
    expect(enrol.status).toBe(200)
    const enrolBody = await enrol.text()
    expect(JSON.parse(enrolBody)).not.toHaveProperty("token")
    expect(enrolBody).not.toContain(token(cookies(enrol)))

    const challenge = cookies(await signIn(email))
    const backup = await post(
      "/two-factor/verify-backup-code",
      { code: backupCodes[0] },
      { cookie: challenge },
    )
    expect(backup.status).toBe(200)
    const backupBody = await backup.text()
    expect(JSON.parse(backupBody)).not.toHaveProperty("token")
    expect(backupBody).not.toContain(token(cookies(backup)))
  })
})

describe("auth body fields", () => {
  async function signedIn(email: string): Promise<string> {
    const res = await signUp(email)
    expect(res.status).toBe(200)
    return cookies(res)
  }

  test("enrollment takes TOTP only, default issuer", async () => {
    const cookie = await signedIn("pendaftar@contoh.id")
    for (const body of [
      { method: "otp" },
      { issuer: "Bank Palsu" },
      { password: "x" },
      [],
      "totp",
    ]) {
      const res = await post("/two-factor/enable", body, { cookie })
      expect([body, res.status]).toEqual([body, 400])
    }
    const res = await post("/two-factor/enable", { method: "totp" }, { cookie })
    expect(res.status).toBe(200)
    const { totpURI } = (await res.json()) as { totpURI: string }
    expect(new URL(totpURI).searchParams.get("issuer")).toBe("Sadar Bersuara")
  })

  test("enrollment needs a sign-in within 300 s", async () => {
    // ASVS V7.5.1: MFA change re-authenticates
    const cookie = await signedIn("lama.enrol@contoh.id")
    await su.query(
      `UPDATE sessions SET created_at = now() - interval '301 seconds'
       WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      ["lama.enrol@contoh.id"],
    )
    const res = await post("/two-factor/enable", { method: "totp" }, { cookie })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("SESSION_NOT_FRESH")
  })

  test("sign-out takes no redirect fields", async () => {
    const cookie = await signedIn("keluar@contoh.id")
    const headers = new Headers({ cookie, host: "itb.localhost" })
    const res = await post(
      "/sign-out",
      { callbackURL: "https://jahat.example/" },
      { cookie },
    )
    expect(res.status).toBe(400)
    expect((await readSessionWith(auth, headers)).session).not.toBeNull()
    expect((await post("/sign-out", {}, { cookie })).status).toBe(200)
    expect((await readSessionWith(auth, headers)).session).toBeNull()
  })

  test("unused upstream routes are closed", async () => {
    for (const path of ["/ok", "/error?error=x&error_description=y"]) {
      const res = await auth.handler(
        new Request(`${origin}/api/auth${path}`, { headers: { origin } }),
      )
      expect([path, res.status]).toEqual([path, 404])
    }
  })
})

describe("rate limits", () => {
  // Production config, limiter on
  const prod = createAuth({
    db: database.db,
    hosts: ["itb.example.id"],
    dev: false,
    email: { send: async () => {} },
    hashKey: () => Buffer.alloc(32, 5),
    verifyCaptcha: async () => ({ ok: true }),
    whatsapp: fakeWhatsApp,
    secrets: [{ version: 1, value: "test-secret-test-secret-test-secret-1" }],
  })
  const prodOrigin = "https://itb.example.id"

  // Caps count earlier suite runs
  beforeEach(async () => {
    await su.query("DELETE FROM email_log")
  })

  async function prodPost(path: string, body: unknown, ip: string) {
    const res = await prod.handler(
      new Request(`${prodOrigin}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: prodOrigin,
          "x-client-ip": ip,
          "x-captcha-response": "pass",
        },
        body: JSON.stringify(body),
      }),
    )
    return res.status
  }

  test("one campus NAT address can send codes for many students", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 10; i++) {
      statuses.push(
        await prodPost(
          "/account/send-code",
          newAccount(`nat${i}@contoh.id`),
          "203.0.113.7",
        ),
      )
    }
    expect(statuses).toEqual(Array(10).fill(200))
  })

  test("one address waits 60 s and gets 8 codes a day", async () => {
    const email = "spasi@contoh.id"
    const body = newAccount(email)
    const send = (ip: string) => prodPost("/account/send-code", body, ip)
    expect(await send("192.0.2.1")).toBe(200)
    // Rotating IPs does not help
    expect(await send("192.0.2.2")).toBe(429)
    const hash = createHmac("sha256", Buffer.alloc(32, 5))
      .update(email)
      .digest("hex")
    await su.query(
      `UPDATE email_log SET created_at = now() - interval '2 minutes'
       WHERE address_hash = $1`,
      [hash],
    )
    expect(await send("192.0.2.3")).toBe(200)
    await su.query(
      `INSERT INTO email_log (kind, address_hash, status, created_at)
       SELECT 'otp', $1, 'sent', now() - interval '1 hour'
       FROM generate_series(1, 6)`,
      [hash],
    )
    await su.query(
      `UPDATE email_log SET created_at = now() - interval '2 minutes'
       WHERE address_hash = $1 AND created_at > now() - interval '1 minute'`,
      [hash],
    )
    expect(await send("192.0.2.4")).toBe(429)
  })

  test("other clients never lock the owner out", async () => {
    const email = "pemilik.kode@contoh.id"
    await insertUser(su, email)
    const body = { mode: "sign-in", identifier: email, channel: "email" }
    const send = (ip: string) => prodPost("/account/send-code", body, ip)
    for (let i = 1; i <= 9; i++) {
      expect(await send(`198.51.100.${i}`)).toBe(200)
    }
    expect(await send("203.0.113.77")).toBe(200)
    // Same client waits 60 s
    expect(await send("203.0.113.77")).toBe(429)
  })

  test("one proven address gets 20 codes a day", async () => {
    const email = "batas@contoh.id"
    await insertUser(su, email)
    const hash = createHmac("sha256", Buffer.alloc(32, 5))
      .update(email)
      .digest("hex")
    await su.query(
      `INSERT INTO email_log (kind, address_hash, status, purpose, client_hash, created_at)
       SELECT 'otp', $1, 'sent', 'sign_in', 'klien' || g, now() - interval '1 hour'
       FROM generate_series(1, 19) g`,
      [hash],
    )
    const body = { mode: "sign-in", identifier: email, channel: "email" }
    expect(await prodPost("/account/send-code", body, "203.0.113.78")).toBe(200)
    expect(await prodPost("/account/send-code", body, "203.0.113.79")).toBe(429)
  })

  test("one client has a daily cap on Daftar codes by email", async () => {
    const ip = "203.0.113.8"
    const send = (i: number) =>
      prodPost("/account/send-code", newAccount(`klien${i}@contoh.id`), ip)
    for (let i = 0; i < EMAIL_QUOTA.signUpPerClientDay; i++) {
      expect(await send(i)).toBe(200)
    }
    expect(await send(99)).toBe(503)
    const { rows } = await su.query(
      "SELECT DISTINCT purpose, client_hash FROM email_log",
    )
    expect(rows).toEqual([
      {
        purpose: "sign_up",
        client_hash: createHmac("sha256", Buffer.alloc(32, 5))
          .update(ip)
          .digest("hex"),
      },
    ])
  })

  test("a spent provider day refuses new codes", async () => {
    await su.query(
      `INSERT INTO email_log (kind, address_hash, status)
       SELECT 'notification', 'quota' || g, 'sent' FROM generate_series(1, 300) g`,
    )
    try {
      expect(
        await prodPost(
          "/account/send-code",
          newAccount("kuota@contoh.id"),
          "192.0.2.9",
        ),
      ).toBe(503)
    } finally {
      await su.query("DELETE FROM email_log WHERE address_hash LIKE 'quota%'")
    }
  })

  test("a flood from one address is throttled", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 40; i++) {
      statuses.push(
        await prodPost(
          "/account/verify-code",
          {
            mode: "sign-in",
            identifier: `flood${i}@contoh.id`,
            channel: "email",
            code: "000000",
          },
          "198.51.100.9",
        ),
      )
    }
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true)
    expect(statuses.at(-1)).toBe(429)
  })
})

describe("readSession", () => {
  async function signedIn(email: string): Promise<Headers> {
    const res = await signUp(email)
    expect(res.status).toBe(200)
    return new Headers({ cookie: cookies(res), host: "itb.localhost" })
  }

  test("a fresh session sets no cookie", async () => {
    const headers = await signedIn("segar@contoh.id")
    const read = await readSessionWith(auth, headers)
    expect(read.session?.user.email).toBe("segar@contoh.id")
    expect(read.setCookie).toEqual([])
  })

  test("a day-old session forwards the refreshed cookie", async () => {
    const headers = await signedIn("geser@contoh.id")
    await su.query(
      "UPDATE sessions SET expires_at = now() + interval '5 days' WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      ["geser@contoh.id"],
    )
    const read = await readSessionWith(auth, headers)
    expect(read.session?.user.email).toBe("geser@contoh.id")
    expect(read.setCookie.join("\n")).toContain("sb.session_token=")
    expect(read.setCookie.join("\n")).toContain("Max-Age=604800")
  })

  test("a session past 30 days ends, sliding or not", async () => {
    // ASVS V7.3.2: absolute lifetime
    const headers = await signedIn("tua@contoh.id")
    await su.query(
      "UPDATE sessions SET created_at = now() - interval '30 days 1 minute' WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      ["tua@contoh.id"],
    )
    const read = await readSessionWith(auth, headers)
    expect(read.session).toBeNull()
    expect(read.setCookie.join("\n")).toContain("sb.session_token=;")
    const { rows } = await su.query(
      "SELECT 1 FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      ["tua@contoh.id"],
    )
    expect(rows).toHaveLength(0)
  })

  test("a TOTP account idle 30 minutes is signed out", async () => {
    // ASVS V7.3.1: staff inactivity timeout
    const idOf = "(SELECT id FROM users WHERE email = $1)"
    const staff = await signedIn("diam@contoh.id")
    await su.query(
      `UPDATE users SET two_factor_enabled = true WHERE id = ${idOf}`,
      ["diam@contoh.id"],
    )
    await su.query(
      `UPDATE sessions SET created_at = now() - interval '2 hours',
         last_seen_at = now() - interval '10 minutes' WHERE user_id = ${idOf}`,
      ["diam@contoh.id"],
    )
    expect((await readSessionWith(auth, staff)).session).not.toBeNull()
    const { rows } = await su.query<{ idle: number }>(
      `SELECT extract(epoch FROM now() - last_seen_at)::int AS idle
       FROM sessions WHERE user_id = ${idOf}`,
      ["diam@contoh.id"],
    )
    expect(rows[0]?.idle).toBeLessThan(5)
    await su.query(
      `UPDATE sessions SET last_seen_at = now() - interval '31 minutes'
       WHERE user_id = ${idOf}`,
      ["diam@contoh.id"],
    )
    const idle = await readSessionWith(auth, staff)
    expect(idle.session).toBeNull()
    expect(idle.setCookie.join("\n")).toContain("sb.session_token=;")
    // Reporter: 7-day sliding window
    const reporter = await signedIn("warga.diam@contoh.id")
    await su.query(
      `UPDATE sessions SET created_at = now() - interval '2 hours'
       WHERE user_id = ${idOf}`,
      ["warga.diam@contoh.id"],
    )
    expect((await readSessionWith(auth, reporter)).session).not.toBeNull()
  })

  test("an auth error reads as signed out", async () => {
    const failing = {
      api: {
        getSession: async () => {
          throw new APIError("UNAUTHORIZED")
        },
      },
    } as unknown as Auth
    const read = await readSessionWith(failing, new Headers())
    expect(read).toEqual({ session: null, setCookie: [] })
  })

  test("a database error is not signed out", async () => {
    // Better Auth wraps adapter errors
    const failing = {
      api: {
        getSession: async () => {
          throw new APIError("INTERNAL_SERVER_ERROR")
        },
      },
    } as unknown as Auth
    await expect(readSessionWith(failing, new Headers())).rejects.toThrow(
      APIError,
    )
  })
})

describe("auth logger", () => {
  test("an adapter error logs no email", () => {
    const lines: string[] = []
    const original = console.error
    console.error = (line: string) => lines.push(line)
    try {
      authLog(
        "error",
        "INTERNAL_SERVER_ERROR",
        new DrizzleQueryError(
          'select * from "users" where "email" = $1',
          ["rahasia@contoh.id"],
          Object.assign(new Error("timeout"), {
            severity: "ERROR",
            code: "57014",
          }),
        ),
      )
    } finally {
      console.error = original
    }
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain("rahasia@contoh.id")
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      msg: "auth",
      level: "error",
      message: "INTERNAL_SERVER_ERROR",
      code: "57014",
    })
  })
})

describe("auth config", () => {
  test("matches the database schema", async () => {
    const context = await auth.$context
    await context.explicitSchemaCheck?.()
  })

  // ASVS V3.3.3: host-only names
  test("production cookies carry the __Host- prefix", async () => {
    const mails: EmailMessage[] = []
    const production = createAuth({
      db: database.db,
      hosts: ["itb.localhost"],
      dev: false,
      email: {
        send: async (message) => {
          mails.push(message)
        },
      },
      hashKey: () => Buffer.alloc(32, 5),
      verifyCaptcha: async () => ({ ok: true }),
      whatsapp: fakeWhatsApp,
      secrets: [{ version: 1, value: "test-secret-test-secret-test-secret-1" }],
    })
    const context = await production.$context
    const made = [
      ...Object.values(context.authCookies),
      context.createAuthCookie("two_factor"),
    ]
    for (const cookie of made) {
      expect(cookie.name).toMatch(/^__Host-sb\./)
      expect(cookie.attributes).toMatchObject({ secure: true, path: "/" })
      expect(cookie.attributes.domain).toBeUndefined()
    }
    const dev = await auth.$context
    expect(dev.authCookies.sessionToken.name).toBe("sb.session_token")
    expect(dev.authCookies.sessionToken.attributes.secure).toBe(false)

    // Round trip through Better Auth
    const https = "https://itb.localhost"
    const send = (path: string, body: unknown) =>
      production.handler(
        new Request(`${https}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: https },
          body: JSON.stringify(body),
        }),
      )
    const account = newAccount("host.prefix@contoh.id")
    expect((await send("/account/send-code", account)).status).toBe(200)
    for (let i = 0; i < 100 && mails.length === 0; i++) await Bun.sleep(10)
    const code = /\b(\d{6})\b/.exec(mails.at(-1)?.text ?? "")?.[1]
    const done = await send("/account/verify-code", {
      ...account,
      code,
      ...ageBox,
    })
    expect(done.status).toBe(200)
    const line = done.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Host-sb.session_token="))
    expect(line).toContain("Secure")
    expect(line).toContain("Path=/")
    expect(line?.toLowerCase()).not.toContain("domain=")
    const read = await production.api.getSession({
      headers: new Headers({
        host: "itb.localhost",
        cookie: line?.split(";")[0] ?? "",
      }),
    })
    expect(read?.user.email).toBe("host.prefix@contoh.id")
  })
})

describe("staffAccess", () => {
  const now = new Date("2026-10-13T10:00:00Z")
  const user = {
    twoFactorEnabled: true,
    updatedAt: new Date("2026-10-13T08:00:00Z"),
  }
  const session = { createdAt: new Date("2026-10-13T09:00:00Z") }

  test("staff role, TOTP and a session after the last change", () => {
    expect(staffAccess({ role: "admin", user, session, now })).toBe(true)
    expect(staffAccess({ role: "editor", user, session, now })).toBe(true)
  })

  test("dev switch skips TOTP, nowhere else", () => {
    const noTotp = { ...user, twoFactorEnabled: false }
    expect(
      staffAccess({ role: "admin", user: noTotp, session, now, totp: false }),
    ).toBe(true)
    // Role and session rules stay
    expect(
      staffAccess({
        role: "reporter",
        user: noTotp,
        session,
        now,
        totp: false,
      }),
    ).toBe(false)
    const off = { STAFF_TOTP: "off" }
    expect(staffTotpRequired({ ...off, NODE_ENV: "development" })).toBe(false)
    expect(staffTotpRequired({ ...off, NODE_ENV: "production" })).toBe(true)
    expect(staffTotpRequired({ ...off, NODE_ENV: "test" })).toBe(true)
    expect(staffTotpRequired({ ...off })).toBe(true)
    expect(staffTotpRequired({ NODE_ENV: "development" })).toBe(true)
  })

  test("fails closed otherwise", () => {
    expect(staffAccess({ role: "reporter", user, session, now })).toBe(false)
    expect(staffAccess({ role: null, user, session, now })).toBe(false)
    expect(
      staffAccess({
        role: "admin",
        user: { ...user, twoFactorEnabled: false },
        session,
        now,
      }),
    ).toBe(false)
    expect(
      staffAccess({
        role: "admin",
        user,
        session: { createdAt: new Date("2026-10-13T07:00:00Z") },
        now,
      }),
    ).toBe(false)
    expect(
      staffAccess({
        role: "admin",
        user,
        session,
        now: new Date("2026-10-13T21:00:01Z"),
      }),
    ).toBe(false)
  })
})

describe("account invariants", () => {
  const draft = (email: string) => ({
    name: "Warga Uji",
    email,
    emailVerified: true,
  })

  async function refusal(create: () => Promise<unknown>) {
    const error = await create().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(APIError)
    return (error as APIError).body?.code
  }

  test("Given an in-process account create without a phone, then it is refused and nothing is written", async () => {
    const email = `tanpa-hp-${crypto.randomUUID()}@contoh.id`
    const { internalAdapter } = await auth.$context
    const create = () =>
      internalAdapter.createUser(draft(email), { method: "in-process" })
    expect(await refusal(create)).toBe("PHONE_REQUIRED")
    expect(await userRow(email)).toBeUndefined()
  })

  test("Given an in-process account create without the 18+ box, then it is refused and nothing is written", async () => {
    const email = `tanpa-umur-${crypto.randomUUID()}@contoh.id`
    const { internalAdapter } = await auth.$context
    const create = () =>
      internalAdapter.createUser(
        { ...draft(email), phoneNumber: nextPhone() },
        { method: "in-process" },
      )
    expect(await refusal(create)).toBe("AGE_DECLARATION_REQUIRED")
    expect(await userRow(email)).toBeUndefined()
  })
})

describe("process auth", () => {
  // Hosts come from organizations
  const HOST = "procauth.localhost"

  beforeAll(async () => {
    await su.query("DELETE FROM organizations WHERE slug = 'procauth'")
    await insertOrg(su, "procauth")
  })

  afterAll(async () => {
    resetAuth()
    await su.query("DELETE FROM organizations WHERE slug = 'procauth'")
  })

  async function withEnv<T>(
    name: string,
    value: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const saved = process.env[name]
    resetAuth()
    try {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
      return await run()
    } finally {
      if (saved === undefined) delete process.env[name]
      else process.env[name] = saved
      resetAuth()
    }
  }

  test("Given a bad keyring at boot, when it is fixed, then getAuth retries instead of keeping the failure", async () => {
    const saved = process.env.BETTER_AUTH_SECRETS
    await withEnv("BETTER_AUTH_SECRETS", "1:pendek", async () => {
      await expect(getAuth()).rejects.toThrow("needs 32 bytes")
      process.env.BETTER_AUTH_SECRETS = saved
      const fixed = await getAuth()
      expect(await getAuth()).toBe(fixed)
    })
  })

  test("Given the process auth, when a code is asked without Turnstile, then it is refused before any send", async () => {
    resetAuth()
    const auth = await getAuth()
    const sends = async () =>
      (
        await su.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM email_log",
        )
      ).rows[0]?.n
    const before = await sends()
    const res = await auth.handler(
      new Request(`http://${HOST}/api/auth/account/send-code`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `http://${HOST}`,
        },
        body: JSON.stringify({
          mode: "sign-in",
          identifier: "warga@contoh.id",
          channel: "email",
        }),
      }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe("CAPTCHA_FAILED")
    expect(await sends()).toBe(before)
  })

  test("Given a reserved WhatsApp send, when its status is asked without the job key, then there is none to report", async () => {
    const statusWith = async (key: string | undefined, id: string) =>
      withEnv("WHATSAPP_JOB_KEY", key, async () => {
        const res = await (await getAuth()).handler(
          new Request(`http://${HOST}/api/auth/account/code-status`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: `http://${HOST}`,
            },
            body: JSON.stringify({ id }),
          }),
        )
        expect(res.status).toBe(200)
        return res.json()
      })
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO whatsapp_log (phone_hash, status)
       VALUES ('status-tanpa-kunci', 'reserved') RETURNING id`,
    )
    const id = rows[0]?.id ?? ""
    try {
      const key = Buffer.alloc(32, 7).toString("base64")
      expect(await statusWith(key, id)).toEqual({ status: "reserved" })
      expect(await statusWith(undefined, id)).toEqual({ status: null })
    } finally {
      await su.query("DELETE FROM whatsapp_log WHERE id = $1", [id])
    }
  })

  test("Given a malformed WhatsApp job key, when auth starts, then it refuses", async () => {
    await withEnv("WHATSAPP_JOB_KEY", "pendek", async () => {
      await expect(getAuth()).rejects.toThrow("WHATSAPP_JOB_KEY needs 32 bytes")
    })
  })

  test("Given a connected sender, when the job key is set or not, then WhatsApp reads ready only with the key", async () => {
    const readyWith = async (key: string | undefined) =>
      withEnv("WHATSAPP_JOB_KEY", key, async () => {
        const auth = await getAuth()
        const res = await auth.handler(
          new Request(`http://${HOST}/api/auth/account/check-new`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: `http://${HOST}`,
            },
            body: JSON.stringify({
              name: "Warga",
              email: `baru.${crypto.randomUUID()}@contoh.id`,
              phone: nextPhone(),
            }),
          }),
        )
        expect(res.status).toBe(200)
        return (await res.json()).whatsappReady
      })
    await su.query(
      `INSERT INTO whatsapp_sender (id, provider, status, last_seen_at)
       VALUES (1, 'baileys', 'connected', now())
       ON CONFLICT (id) DO UPDATE SET status = 'connected', last_seen_at = now()`,
    )
    try {
      expect(await readyWith(Buffer.alloc(32, 7).toString("base64"))).toBe(true)
      expect(await readyWith(undefined)).toBe(false)
    } finally {
      await su.query("DELETE FROM whatsapp_sender")
    }
  })
})

describe("code edge cases", () => {
  test("Given WhatsApp drops between the readiness check and the send, then the code is refused with the email hint", async () => {
    await signUp("putus@contoh.id")
    whatsapp.sendFails = "unavailable"
    try {
      const res = await post(
        "/account/send-code",
        { mode: "sign-in", identifier: "putus@contoh.id", channel: "whatsapp" },
        captcha,
      )
      expect(res.status).toBe(503)
      expect((await res.json()).code).toBe("WHATSAPP_UNAVAILABLE")
    } finally {
      whatsapp.sendFails = null
    }
    expect((await signIn("putus@contoh.id")).status).toBe(200)
  })

  test("Given the WhatsApp sender spaces codes, when another is asked, then it is 429 and email still works", async () => {
    await signUp("jeda@contoh.id")
    whatsapp.sendFails = "spacing"
    try {
      const res = await post(
        "/account/send-code",
        { mode: "sign-in", identifier: "jeda@contoh.id", channel: "whatsapp" },
        captcha,
      )
      expect(res.status).toBe(429)
      expect((await res.json()).code).toBe("OTP_LIMIT")
    } finally {
      whatsapp.sendFails = null
    }
    expect((await signIn("jeda@contoh.id")).status).toBe(200)
  })

  test("Given no account, when a sign-in code is verified, then the answer is only an invalid code", async () => {
    const res = await post("/account/verify-code", {
      mode: "sign-in",
      identifier: "tidak.pernah@contoh.id",
      channel: "email",
      code: "123456",
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("INVALID_OTP")
  })

  test("Given an email only stored, never proven, when it is looked up, then it is reported unproven, not found", async () => {
    const email = `belum.terbukti.${crypto.randomUUID()}@contoh.id`
    expect((await signUp(email, "whatsapp")).status).toBe(200)
    const res = await post("/account/lookup", { identifier: email })
    expect(await res.json()).toEqual({ found: false, unproven: true })
    const unknown = await post("/account/lookup", {
      identifier: `tidak.ada.${crypto.randomUUID()}@contoh.id`,
    })
    expect(await unknown.json()).toEqual({ found: false })
  })

  test("Given another sign-up commits the same email mid-verify, then this one is 409 ACCOUNT_EXISTS", async () => {
    const email = `balapan.${crypto.randomUUID()}@contoh.id`
    const body = newAccount(email)
    const code = await requestCode(body)
    const holder = await su.connect()
    try {
      await holder.query("BEGIN")
      await holder.query(
        `INSERT INTO users (name, email, email_verified, age_declared_at, age_consent_version)
         VALUES ('Lain', $1, true, now(), $2)`,
        [email, AGE_CONSENT_VERSION],
      )
      const verifying = post("/account/verify-code", {
        ...body,
        code,
        ...ageBox,
      })
      // Wait until the insert blocks
      let waiting = 0
      for (let i = 0; i < 200 && waiting === 0; i++) {
        const { rows } = await su.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
             AND query ILIKE 'insert into "users"%'`,
        )
        waiting = rows[0]?.n ?? 0
        if (waiting === 0) await Bun.sleep(10)
      }
      expect(waiting).toBe(1)
      await holder.query("COMMIT")
      const res = await verifying
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe("ACCOUNT_EXISTS")
    } finally {
      holder.release()
    }
    const { rows } = await su.query("SELECT name FROM users WHERE email = $1", [
      email,
    ])
    expect(rows).toEqual([{ name: "Lain" }])
  })
})
