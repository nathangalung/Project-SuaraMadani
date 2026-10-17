import { describe, expect, test } from "bun:test"
import { devProvider } from "./dev.ts"
import { metaProvider } from "./meta.ts"

const signal = new AbortController().signal
const config = {
  token: "token-uji",
  phoneNumberId: "105954558954427",
  template: "kode_masuk",
  language: "id",
}

function fetchReturning(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), { status })
  }
  return { calls, fetch }
}

describe("Meta Cloud API adapter", () => {
  test("sends the copy-code authentication template", async () => {
    const { calls, fetch } = fetchReturning(200, { messages: [{ id: "x" }] })
    const result = await metaProvider({ ...config, fetch }).send(
      { to: "+6281234567890", code: "123456" },
      signal,
    )
    expect(result).toBe("sent")
    expect(calls[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/105954558954427/messages",
    )
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: "Bearer token-uji",
    })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "6281234567890",
      type: "template",
      template: {
        name: "kode_masuk",
        language: { code: "id" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "123456" }] },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: "123456" }],
          },
        ],
      },
    })
  })

  test("no WhatsApp account is permanent, others throw", async () => {
    const missing = fetchReturning(400, { error: { code: 131026 } })
    expect(
      await metaProvider({ ...config, fetch: missing.fetch }).send(
        { to: "+6281234567890", code: "123456" },
        signal,
      ),
    ).toBe("not_on_whatsapp")
    for (const [status, code] of [
      [429, 130429],
      [500, 1],
      [401, 190],
    ] as const) {
      const failing = fetchReturning(status, { error: { code } })
      await expect(
        metaProvider({ ...config, fetch: failing.fetch }).send(
          { to: "+6281234567890", code: "123456" },
          signal,
        ),
      ).rejects.toThrow(`meta send failed: ${status}`)
    }
  })
})

describe("dev adapter", () => {
  test("writes the plain message to the dev inbox", async () => {
    const mails: { to: string; subject: string; text: string }[] = []
    const result = await devProvider({
      send: async (message) => {
        mails.push(message)
      },
    }).send({ to: "+6281234567890", code: "123456" }, signal)
    expect(result).toBe("sent")
    expect(mails[0]?.to).toBe("wa-6281234567890@whatsapp.localhost")
    expect(mails[0]?.subject).toBe("WhatsApp ke +6281234567890")
    expect(mails[0]?.text).toContain("123456")
    expect(mails[0]?.text).not.toContain("http")
  })
})
