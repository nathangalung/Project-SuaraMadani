import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { createHmac } from "node:crypto"
import { APIError } from "better-auth/api"
import { DrizzleQueryError } from "drizzle-orm/errors"
import { addPhone } from "../app/features/report/add-phone.server.ts"
import { createDatabase } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import { insertOrg, resetData, superuserPool, testUrl } from "../db/testing.ts"
import { EMAIL_QUOTA } from "../shared/notifications.ts"
import { AGE_CONSENT_VERSION } from "../shared/report-fields.ts"
import {
  type Auth,
  authLog,
  createAuth,
  readSessionWith,
  staffAccess,
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
  logs: new Map<string, "reserved" | "sent" | "failed">(),
}

// Fake sender, no WhatsApp
const fakeWhatsApp: WhatsAppGateway = {
  ready: async () => whatsapp.isReady,
  sendCode: async (to, code, purpose) => {
    if (!whatsapp.isReady) return { ok: false, reason: "unavailable" }
    const logId = crypto.randomUUID()
    texts.push({
      to,
      code,
      purpose: purpose?.purpose,
      client: purpose?.purpose === "sign-up" ? purpose.client : undefined,
    })
    whatsapp.logs.set(logId, "reserved")
    return { ok: true, logId }
  },
  status: async (logId) => whatsapp.logs.get(logId) ?? null,
}

const auth = createAuth({
  db: database.db,
  hosts: ["itb.localhost", "ugm.localhost"],
  dev: true,
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
    expect(setCookie).toContain("sm.session_token=")
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
    expect(cookies(done)).toContain("sm.session_token=")
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
    await requestCode(body)
    expect(texts.at(-1)?.purpose).toBe("sign-in")
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
    expect(enrolled).toContain("sm.session_token=")

    const again = await signIn(email)
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ twoFactorRedirect: true })
    expect(cookies(again)).not.toContain("sm.session_token")
    const challenge = cookies(again)
    expect(challenge).toContain("sm.two_factor")

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
    expect(cookies(chat)).not.toContain("sm.session_token")

    const stepUp = await post(
      "/two-factor/verify-totp",
      { code: totp(secret, Date.now() + 30_000) },
      { cookie: challenge },
    )
    expect(stepUp.status).toBe(200)
    const staff = cookies(stepUp)
    expect(staff).toContain("sm.session_token=")

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
    const code = totp(secret)
    const enrol = await post(
      "/two-factor/verify-totp",
      { code },
      { cookie: emailOnly },
    )
    expect(enrol.status).toBe(200)

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
    expect(cookies(replay)).not.toContain("sm.session_token=")

    const next = await post(
      "/two-factor/verify-totp",
      { code: totp(secret, Date.now() + 30_000) },
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
    expect(cookies(backup)).toContain("sm.session_token=")

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

describe("server-only auth calls", () => {
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
    expect(read.setCookie.join("\n")).toContain("sm.session_token=")
    expect(read.setCookie.join("\n")).toContain("Max-Age=604800")
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
