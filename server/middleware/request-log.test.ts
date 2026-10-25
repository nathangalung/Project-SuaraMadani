import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import type { LogRecord } from "../log.ts"
import { requestLog } from "./request-log.ts"

/** One request, its log line. */
async function logged(
  handler: (signal: AbortController) => Response,
): Promise<LogRecord | undefined> {
  const lines: LogRecord[] = []
  const client = new AbortController()
  const app = new Hono()
  app.use(requestLog((line) => lines.push(line)))
  app.all("*", () => handler(client))
  await app.fetch(
    new Request("http://itb.localhost/api/upload/x", {
      method: "PATCH",
      signal: client.signal,
    }),
  )
  return lines[0]
}

describe("requestLog", () => {
  test("a request the client cut off is 499, not 500", async () => {
    // React Router answers 500
    const line = await logged((client) => {
      client.abort()
      return new Response(null, { status: 500 })
    })
    expect(line).toMatchObject({ method: "PATCH", status: 499 })
  })

  test("a connected client keeps the status", async () => {
    expect(
      await logged(() => new Response(null, { status: 500 })),
    ).toMatchObject({ status: 500 })
    expect(
      await logged(() => new Response(null, { status: 204 })),
    ).toMatchObject({ status: 204 })
  })

  test("the line names no address", async () => {
    const line = await logged(() => new Response(null, { status: 204 }))
    expect(Object.keys(line ?? {}).sort()).toEqual([
      "dur_ms",
      "host",
      "method",
      "msg",
      "path",
      "req_id",
      "status",
      "user_id",
    ])
  })
})
