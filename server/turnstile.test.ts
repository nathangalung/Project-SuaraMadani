import { describe, expect, test } from "bun:test"
import { verifyTurnstile } from "./turnstile.server.ts"

type Call = { url: string; body: URLSearchParams }

function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: new URLSearchParams(String(init?.body)),
    })
    return reply()
  }
  return { fetch, calls }
}

const json = (body: unknown) => Response.json(body)

describe("verifyTurnstile", () => {
  test("posts secret, token and client IP once", async () => {
    const { fetch, calls } = fakeFetch(() => json({ success: true }))
    const result = await verifyTurnstile("tok", {
      secret: "sec",
      remoteIp: "203.0.113.9",
      fetch,
    })
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    )
    expect(calls[0]?.body.get("secret")).toBe("sec")
    expect(calls[0]?.body.get("response")).toBe("tok")
    expect(calls[0]?.body.get("remoteip")).toBe("203.0.113.9")
  })

  test("missing token never calls Cloudflare", async () => {
    const { fetch, calls } = fakeFetch(() => json({ success: true }))
    expect(await verifyTurnstile(null, { secret: "sec", fetch })).toEqual({
      ok: false,
      reason: "missing",
    })
    expect(calls).toHaveLength(0)
  })

  test("duplicate tokens are reported apart from other failures", async () => {
    const dup = fakeFetch(() =>
      json({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    )
    expect(
      await verifyTurnstile("t", { secret: "s", fetch: dup.fetch }),
    ).toEqual({ ok: false, reason: "duplicate" })
    const bad = fakeFetch(() =>
      json({ success: false, "error-codes": ["invalid-input-response"] }),
    )
    expect(
      await verifyTurnstile("t", { secret: "s", fetch: bad.fetch }),
    ).toEqual({ ok: false, reason: "rejected" })
  })

  test("network errors and timeouts fail closed", async () => {
    const down = fakeFetch(() => {
      throw new Error("ECONNREFUSED")
    })
    expect(
      await verifyTurnstile("t", { secret: "s", fetch: down.fetch }),
    ).toEqual({ ok: false, reason: "unavailable" })
    const slow = fakeFetch(() => new Promise<Response>(() => {}))
    const started = Date.now()
    expect(
      await verifyTurnstile("t", {
        secret: "s",
        fetch: slow.fetch,
        timeoutMs: 50,
      }),
    ).toEqual({ ok: false, reason: "unavailable" })
    expect(Date.now() - started).toBeLessThan(1000)
    const html = fakeFetch(() => new Response("<html>", { status: 502 }))
    expect(
      await verifyTurnstile("t", { secret: "s", fetch: html.fetch }),
    ).toEqual({ ok: false, reason: "unavailable" })
  })

  test("no secret configured fails closed", async () => {
    const { fetch, calls } = fakeFetch(() => json({ success: true }))
    expect(await verifyTurnstile("t", { secret: "", fetch })).toEqual({
      ok: false,
      reason: "unavailable",
    })
    expect(calls).toHaveLength(0)
  })
})
