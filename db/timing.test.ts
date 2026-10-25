import { afterAll, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { Pool } from "pg"
import { serverTiming } from "../server/middleware/server-timing.ts"
import { testUrl } from "./testing.ts"
import { instrumentPool, timed, timingHeader } from "./timing.server.ts"

const pool = new Pool({ connectionString: testUrl("TEST_DATABASE_URL") })
instrumentPool(pool)

afterAll(() => pool.end())

describe("query timing", () => {
  test("counts pool and client queries inside a request", async () => {
    const [timing] = await timed(async () => {
      await pool.query("SELECT 1")
      const client = await pool.connect()
      try {
        await client.query("SELECT $1::int", [2])
      } finally {
        client.release()
      }
    })
    expect(timing.queries).toBe(2)
    expect(timing.dbMs).toBeGreaterThan(0)
  })

  test("a failed query still counts and rejects", async () => {
    const [timing, error] = await timed(() =>
      pool.query("SELECT * FROM no_such_table").catch((e: unknown) => e),
    )
    expect(timing.queries).toBe(1)
    expect(error).toBeInstanceOf(Error)
  })

  test("queries outside a request are not counted", async () => {
    await pool.query("SELECT 1")
    const [timing] = await timed(async () => undefined)
    expect(timing.queries).toBe(0)
  })

  test("the header names db time, count and total", () => {
    expect(timingHeader({ queries: 3, dbMs: 4.26 }, 12.5)).toBe(
      'db;dur=4.3;desc="3 queries", total;dur=12.5',
    )
  })
})

describe("Server-Timing middleware", () => {
  test("sets the header on the response", async () => {
    const app = new Hono()
    app.use(serverTiming())
    app.get("/", async (c) => {
      await pool.query("SELECT 1")
      return c.text("ok")
    })
    const response = await app.request("/")
    const header = response.headers.get("Server-Timing") ?? ""
    expect(header).toMatch(
      /^db;dur=[0-9.]+;desc="1 queries", total;dur=[0-9.]+$/,
    )
  })
})
