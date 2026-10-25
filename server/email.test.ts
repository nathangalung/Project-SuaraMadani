import { describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import {
  brevoSender,
  createEmailSender,
  EmailSendError,
  mailpitSender,
  neverSent,
  parseAddress,
  sesSender,
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
    expect(parseAddress("Sadar Bersuara <no-reply@sadarbersuara.id>")).toEqual({
      name: "Sadar Bersuara",
      email: "no-reply@sadarbersuara.id",
    })
    expect(parseAddress("no-reply@sadarbersuara.id")).toEqual({
      name: "",
      email: "no-reply@sadarbersuara.id",
    })
  })
})

describe("brevoSender", () => {
  test("posts the transactional email with the API key", async () => {
    const { fetch, calls } = fakeFetch(201)
    await brevoSender({
      apiKey: "key-1",
      from: "Sadar Bersuara <no-reply@sadarbersuara.id>",
      fetch,
    }).send(message)
    expect(calls[0]?.url).toBe("https://api.brevo.com/v3/smtp/email")
    // API10: never follow redirects
    expect(calls[0]?.init.redirect).toBe("error")
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get("api-key")).toBe("key-1")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      sender: { name: "Sadar Bersuara", email: "no-reply@sadarbersuara.id" },
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

const SES = {
  region: "ap-southeast-3",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  from: "Sadar Bersuara <no-reply@sadarbersuara.id>",
  now: () => new Date("2026-10-21T01:02:03.456Z"),
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest()
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

// Independent SigV4 reference
function expectedSignature(call: Call, signed: string[]): string {
  const url = new URL(call.url)
  const headers = new Headers(call.init.headers)
  const amzDate = headers.get("x-amz-date") ?? ""
  const scope = `${amzDate.slice(0, 8)}/${SES.region}/ses/aws4_request`
  const canonical = [
    "POST",
    url.pathname,
    "",
    signed
      .map(
        (name) => `${name}:${name === "host" ? url.host : headers.get(name)}`,
      )
      .join("\n"),
    "",
    signed.join(";"),
    sha256(String(call.init.body)),
  ].join("\n")
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)]
  let key = hmac(`AWS4${SES.secretAccessKey}`, amzDate.slice(0, 8))
  for (const part of [SES.region, "ses", "aws4_request"]) key = hmac(key, part)
  return hmac(key, toSign.join("\n")).toString("hex")
}

describe("sesSender", () => {
  test("posts SendEmail v2 with UTF-8 content", async () => {
    const { fetch, calls } = fakeFetch(200)
    await sesSender({ ...SES, fetch }).send({
      ...message,
      subject: "Status laporan – diperbarui",
      idempotencyKey: "0199e000-0000-7000-8000-000000000001",
    })
    expect(calls[0]?.url).toBe(
      "https://email.ap-southeast-3.amazonaws.com/v2/email/outbound-emails",
    )
    expect(calls[0]?.init.method).toBe("POST")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      FromEmailAddress: "Sadar Bersuara <no-reply@sadarbersuara.id>",
      Destination: { ToAddresses: ["warga@contoh.id"] },
      Content: {
        Simple: {
          Subject: { Data: "Status laporan – diperbarui", Charset: "UTF-8" },
          Body: {
            Text: { Data: "Kode Anda 123456", Charset: "UTF-8" },
            Html: { Data: "<p>Kode Anda 123456</p>", Charset: "UTF-8" },
          },
        },
      },
    })
  })

  test("signs the exact body with SigV4", async () => {
    const { fetch, calls } = fakeFetch(200)
    await sesSender({ ...SES, fetch }).send(message)
    const call = calls[0] as Call
    const headers = new Headers(call.init.headers)
    expect(headers.get("x-amz-date")).toBe("20261021T010203Z")
    expect(headers.get("content-type")).toBe("application/json")
    const auth = headers.get("authorization") ?? ""
    const match =
      /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
        auth,
      )
    expect(match?.[1]).toBe(
      "AKIDEXAMPLE/20261021/ap-southeast-3/ses/aws4_request",
    )
    const signed = (match?.[2] ?? "").split(";")
    expect(signed).toEqual(["host", "x-amz-date"])
    expect(match?.[3]).toBe(expectedSignature(call, signed))
  })

  test("classifies SES errors by type, not status", async () => {
    const send = (
      status: number,
      headers: Record<string, string>,
      body = "{}",
    ) => {
      const fetch = async () => new Response(body, { status, headers })
      return sesSender({ ...SES, fetch })
        .send(message)
        .then(
          () => null,
          (error: unknown) => error,
        )
    }
    const typed = (name: string) => ({ "x-amzn-errortype": name })
    expect(
      await send(400, typed("ThrottlingException:http://internal.amazon.com/")),
    ).toMatchObject({
      status: 400,
      code: "ThrottlingException",
      permanent: false,
      rateLimited: true,
    })
    expect(await send(429, typed("TooManyRequestsException"))).toMatchObject({
      permanent: false,
      rateLimited: true,
    })
    for (const name of [
      "SendingPausedException",
      "AccountSuspendedException",
      "MailFromDomainNotVerifiedException",
      "LimitExceededException",
    ]) {
      expect(await send(400, typed(name))).toMatchObject({
        code: name,
        permanent: false,
        rateLimited: false,
      })
    }
    expect(await send(400, typed("MessageRejected"))).toMatchObject({
      code: "MessageRejected",
      permanent: true,
    })
    expect(
      await send(
        400,
        {},
        '{"__type":"com.amazonaws.sesv2#BadRequestException","message":"warga@contoh.id"}',
      ),
    ).toMatchObject({ code: "BadRequestException", permanent: true })
    expect(await send(400, {}, '{"code":"ThrottlingException"}')).toMatchObject(
      { rateLimited: true },
    )
    expect(await send(403, typed("UnrecognizedClientException"))).toMatchObject(
      { status: 403, permanent: false },
    )
    expect(await send(400, {}, "not json")).toMatchObject({
      code: null,
      permanent: false,
    })
    expect(await send(503, {})).toMatchObject({ permanent: false })
  })

  test("never echoes the error message", async () => {
    const fetch = async () =>
      new Response('{"message":"warga@contoh.id is not verified"}', {
        status: 400,
        headers: { "x-amzn-errortype": "MessageRejected" },
      })
    const error = await sesSender({ ...SES, fetch })
      .send(message)
      .catch((caught: unknown) => caught)
    expect(String(error)).toBe(
      "EmailSendError: ses send failed: 400 MessageRejected",
    )
    expect(JSON.stringify(error)).not.toContain("warga")
  })

  test("drops an unsafe error type", async () => {
    const fetch = async () =>
      new Response("{}", {
        status: 400,
        headers: { "x-amzn-errortype": "warga@contoh.id" },
      })
    const error = await sesSender({ ...SES, fetch })
      .send(message)
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: null, permanent: false })
  })

  test("encodes a non-ASCII sender name", async () => {
    const { fetch, calls } = fakeFetch(200)
    await sesSender({
      ...SES,
      from: "Sadar Bersuara – ITB <no-reply@sadarbersuara.id>",
      fetch,
    }).send(message)
    const name = Buffer.from("Sadar Bersuara – ITB").toString("base64")
    expect(JSON.parse(String(calls[0]?.init.body)).FromEmailAddress).toBe(
      `=?UTF-8?B?${name}?= <no-reply@sadarbersuara.id>`,
    )
    expect(() =>
      sesSender({ ...SES, from: "no-reply@sadarbersuära.id" }),
    ).toThrow("ASCII")
  })
})

describe("EmailSendError", () => {
  test("a request timeout is never permanent", () => {
    expect(new EmailSendError("brevo", 408, null)).toMatchObject({
      permanent: false,
      rateLimited: false,
      code: null,
    })
    expect(new EmailSendError("brevo", 429, null)).toMatchObject({
      rateLimited: true,
    })
  })
})

describe("createEmailSender with SES", () => {
  test("needs region and both keys", () => {
    const env = {
      EMAIL_PROVIDER: "ses",
      EMAIL_FROM: "a@b.id",
      SES_REGION: "ap-southeast-3",
      SES_ACCESS_KEY_ID: "AKIDEXAMPLE",
      SES_SECRET_ACCESS_KEY: "secret",
    }
    expect(createEmailSender(env)).toHaveProperty("send")
    for (const name of [
      "SES_REGION",
      "SES_ACCESS_KEY_ID",
      "SES_SECRET_ACCESS_KEY",
    ] as const) {
      expect(() => createEmailSender({ ...env, [name]: "" })).toThrow(name)
    }
    expect(() =>
      createEmailSender({ ...env, SES_REGION: "ap-southeast-3/x" }),
    ).toThrow("SES_REGION")
  })
})
