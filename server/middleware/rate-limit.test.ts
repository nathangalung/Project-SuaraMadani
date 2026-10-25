import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { rateLimit } from "./rate-limit.ts"

function appWith(now: { t: number }) {
  const app = new Hono()
  app.use(
    rateLimit({
      max: 2,
      windowMs: 60_000,
      key: (c) => c.req.header("x-client-ip") ?? "unknown",
      now: () => now.t,
    }),
  )
  app.get("/", (c) => c.text("ok"))
  return app
}

const from = (ip: string) => ({ headers: { "x-client-ip": ip } })

describe("rateLimit", () => {
  test("allows max per window, then 429 until it ends", async () => {
    const clock = { t: 1_000 }
    const app = appWith(clock)
    expect((await app.request("/", from("a"))).status).toBe(200)
    expect((await app.request("/", from("a"))).status).toBe(200)
    const refused = await app.request("/", from("a"))
    expect(refused.status).toBe(429)
    expect(refused.headers.get("Retry-After")).toBe("59")
    expect(refused.headers.get("Cache-Control")).toBe("no-store")
    expect(await refused.json()).toEqual({ error: "rate_limited" })
    // Other clients are separate
    expect((await app.request("/", from("b"))).status).toBe(200)
    clock.t = 61_000
    expect((await app.request("/", from("a"))).status).toBe(200)
  })
})
