import { describe, expect, test } from "bun:test"
import { turnstileKeysProblem, verifyTurnstile } from "./turnstile.server.ts"

type Call = { url: string; body: URLSearchParams; redirect?: string }

function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: new URLSearchParams(String(init?.body)),
      redirect: init?.redirect,
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
    // API10: never follow redirects
    expect(calls[0]?.redirect).toBe("error")
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

  test("an odd or oversized reply fails closed", async () => {
    // API10: validate upstream replies
    for (const reply of [
      json({ success: "true" }),
      json({ success: true, "error-codes": "nope" }),
      new Response(JSON.stringify({ success: true }).padEnd(70_000)),
    ]) {
      const { fetch } = fakeFetch(() => reply)
      expect(await verifyTurnstile("t", { secret: "s", fetch })).toMatchObject({
        ok: false,
      })
    }
  })

  test("every failure is logged, outages as errors", async () => {
    // ASVS V16.3.4: control failures
    const run = async (
      token: string | null,
      options: { secret: string; reply?: () => Response | Promise<Response> },
    ) => {
      const errors: Record<string, unknown>[] = []
      const events: Record<string, unknown>[] = []
      const { fetch } = fakeFetch(
        options.reply ?? (() => json({ success: true })),
      )
      const result = await verifyTurnstile(token, {
        secret: options.secret,
        fetch,
        log: {
          error: (line) => errors.push(line),
          security: (line) => events.push(line),
        },
      })
      return { result, errors, events }
    }
    const outage = await run("t", {
      secret: "s",
      reply: () => new Response("busy", { status: 503 }),
    })
    expect(outage.errors).toEqual([
      expect.objectContaining({ msg: "turnstile unavailable", status: 503 }),
    ])
    const noSecret = await run("t", { secret: "" })
    expect(noSecret.errors).toEqual([
      expect.objectContaining({
        msg: "turnstile unavailable",
        cause: "no_secret",
      }),
    ])
    const down = await run("t", {
      secret: "s",
      reply: () => Promise.reject(new TypeError("fetch failed")),
    })
    expect(down.errors).toEqual([
      expect.objectContaining({
        msg: "turnstile unavailable",
        error: "TypeError",
      }),
    ])
    const rejected = await run("t", {
      secret: "s",
      reply: () => json({ success: false }),
    })
    expect(rejected.errors).toEqual([])
    expect(rejected.events).toEqual([
      expect.objectContaining({ event: "captcha_refused", reason: "rejected" }),
    ])
    const missing = await run(null, { secret: "s" })
    expect(missing.events).toEqual([
      expect.objectContaining({ event: "captcha_refused", reason: "missing" }),
    ])
    const passed = await run("t", { secret: "s" })
    expect([passed.errors, passed.events]).toEqual([[], []])
  })
})

describe("turnstileKeysProblem", () => {
  // ASVS V13.2.3: no shipped keys
  const live = {
    NODE_ENV: "production",
    APEX_HOST: "sadarbersuara.id",
    TURNSTILE_SITE_KEY: "0x4AAAAAAAB1cdEfGhIjKlMn",
    TURNSTILE_SECRET_KEY: "0x4AAAAAAAB1cdEfGhIjKlMnOpQrStUvWxYz",
  }

  test("real keys on a public apex pass", () => {
    expect(turnstileKeysProblem(live)).toBeNull()
  })

  test("Cloudflare's dummy keys refuse a public apex", () => {
    for (const secret of [
      "1x0000000000000000000000000000000AA",
      "2x0000000000000000000000000000000AA",
      "3x0000000000000000000000000000000AA",
    ]) {
      expect(
        turnstileKeysProblem({ ...live, TURNSTILE_SECRET_KEY: secret }),
      ).toContain("TURNSTILE_SECRET_KEY")
    }
    for (const site of [
      "1x00000000000000000000AA",
      "1x00000000000000000000BB",
      "3x00000000000000000000FF",
    ]) {
      expect(
        turnstileKeysProblem({ ...live, TURNSTILE_SITE_KEY: site }),
      ).toContain("TURNSTILE_SITE_KEY")
    }
  })

  test("local rigs and dev keep the dummy keys", () => {
    const dummy = {
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    }
    expect(
      turnstileKeysProblem({ ...live, ...dummy, APEX_HOST: "localhost" }),
    ).toBeNull()
    expect(
      turnstileKeysProblem({ ...live, ...dummy, APEX_HOST: "x.localhost" }),
    ).toBeNull()
    expect(
      turnstileKeysProblem({ ...live, ...dummy, NODE_ENV: "development" }),
    ).toBeNull()
  })
})
