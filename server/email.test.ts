import { describe, expect, test } from "bun:test"
import {
  brevoSender,
  createEmailSender,
  EmailSendError,
  mailpitSender,
  neverSent,
  parseAddress,
} from "./email.ts"

type Call = { url: string; init: RequestInit }

function fakeFetch(status = 201, headers: Record<string, string> = {}) {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response("{}", { status, headers })
  }
  return { fetch, calls }
}

const message = {
  to: "warga@contoh.id",
  subject: "Kode verifikasi",
  text: "Kode Anda 123456",
  html: "<p>Kode Anda 123456</p>",
}

describe("parseAddress", () => {
  test("reads name and email", () => {
    expect(parseAddress("Sadar Bersuara <no-reply@suaramadani.id>")).toEqual({
      name: "Sadar Bersuara",
      email: "no-reply@suaramadani.id",
    })
    expect(parseAddress("no-reply@suaramadani.id")).toEqual({
      name: "",
      email: "no-reply@suaramadani.id",
    })
  })
})

describe("brevoSender", () => {
  test("posts the transactional email with the API key", async () => {
    const { fetch, calls } = fakeFetch(201)
    await brevoSender({
      apiKey: "key-1",
      from: "Sadar Bersuara <no-reply@suaramadani.id>",
      fetch,
    }).send(message)
    expect(calls[0]?.url).toBe("https://api.brevo.com/v3/smtp/email")
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get("api-key")).toBe("key-1")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      sender: { name: "Sadar Bersuara", email: "no-reply@suaramadani.id" },
      to: [{ email: "warga@contoh.id" }],
      subject: "Kode verifikasi",
      textContent: "Kode Anda 123456",
      htmlContent: "<p>Kode Anda 123456</p>",
    })
  })

  test("passes the stored idempotency key", async () => {
    const { fetch, calls } = fakeFetch(201)
    await brevoSender({ apiKey: "k", from: "a@b.id", fetch }).send({
      ...message,
      idempotencyKey: "0199e000-0000-7000-8000-000000000001",
    })
    expect(JSON.parse(String(calls[0]?.init.body)).headers).toEqual({
      idempotencyKey: "0199e000-0000-7000-8000-000000000001",
    })
  })

  test("classifies provider errors", async () => {
    const send = (status: number, headers: Record<string, string> = {}) =>
      brevoSender({
        apiKey: "k",
        from: "a@b.id",
        fetch: fakeFetch(status, headers).fetch,
      })
        .send(message)
        .then(
          () => null,
          (error: unknown) => error,
        )
    const invalid = await send(400)
    expect(invalid).toBeInstanceOf(EmailSendError)
    expect(invalid).toMatchObject({ status: 400, permanent: true })
    expect(await send(503)).toMatchObject({ status: 503, permanent: false })
    // Account errors must alert
    for (const status of [401, 402, 403]) {
      expect(await send(status)).toMatchObject({ status, permanent: false })
    }
    expect(await send(422)).toMatchObject({ status: 422, permanent: true })
    expect(await send(429, { "retry-after": "120" })).toMatchObject({
      status: 429,
      permanent: false,
      retryAfterSeconds: 120,
    })
    expect(await send(429)).toMatchObject({ retryAfterSeconds: null })
  })

  test("throws on a provider error without echoing the body", async () => {
    const { fetch } = fakeFetch(401)
    const sender = brevoSender({ apiKey: "k", from: "a@b.id", fetch })
    await expect(sender.send(message)).rejects.toThrow("brevo send failed: 401")
  })
})

describe("mailpitSender", () => {
  test("posts to the Mailpit send API", async () => {
    const { fetch, calls } = fakeFetch(200)
    await mailpitSender({
      url: "http://127.0.0.1:58025",
      from: "Sadar Bersuara <no-reply@localhost>",
      fetch,
    }).send(message)
    expect(calls[0]?.url).toBe("http://127.0.0.1:58025/api/v1/send")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      From: { Email: "no-reply@localhost", Name: "Sadar Bersuara" },
      To: [{ Email: "warga@contoh.id" }],
      Subject: "Kode verifikasi",
      Text: "Kode Anda 123456",
      HTML: "<p>Kode Anda 123456</p>",
    })
  })
})

describe("createEmailSender", () => {
  test("chooses the provider from EMAIL_PROVIDER", () => {
    expect(() =>
      createEmailSender({ EMAIL_PROVIDER: "brevo", EMAIL_FROM: "a@b.id" }),
    ).toThrow("BREVO_API_KEY")
    expect(() => createEmailSender({ EMAIL_PROVIDER: "smtp" })).toThrow(
      "EMAIL_PROVIDER",
    )
    expect(
      createEmailSender({
        EMAIL_PROVIDER: "mailpit",
        EMAIL_FROM: "a@b.id",
        MAILPIT_URL: "http://127.0.0.1:58025",
      }),
    ).toHaveProperty("send")
  })

  test("refuses Mailpit in production", () => {
    expect(() =>
      createEmailSender({
        NODE_ENV: "production",
        EMAIL_PROVIDER: "mailpit",
        EMAIL_FROM: "a@b.id",
        MAILPIT_URL: "http://127.0.0.1:58025",
      }),
    ).toThrow("production")
  })
})

describe("neverSent", () => {
  test("only errors before a connection free the slot", () => {
    const coded = (code: string) => Object.assign(new TypeError("x"), { code })
    for (const code of [
      "ECONNREFUSED",
      "ENOTFOUND",
      "EPROTO",
      "CERT_HAS_EXPIRED",
    ]) {
      expect([code, neverSent(coded(code))]).toEqual([code, true])
    }
    expect(neverSent(coded("ECONNRESET"))).toBe(false)
    expect(neverSent(new DOMException("timed out", "TimeoutError"))).toBe(false)
    expect(neverSent(new Error("deadline exceeded"))).toBe(false)
  })
})
