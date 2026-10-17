import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { database } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import { superuserPool, testUrl } from "../db/testing.ts"
import { seal } from "../server/seal.ts"
import { WHATSAPP_LIMITS } from "../shared/whatsapp.ts"
import type { SendResult, WhatsAppProvider } from "./whatsapp/provider.ts"
import { createWhatsAppSendHandler } from "./whatsapp-send.ts"

const su = superuserPool()
const jobKey = Buffer.alloc(32, 6)
const NOW = new Date("2026-10-16T03:00:00Z")
const to = "+6281234500088"

let sent: { to: string; code: string }[] = []
let next: SendResult | Error = "sent"
let waited: number[] = []

const provider: WhatsAppProvider = {
  name: "dev",
  send: async (message) => {
    if (next instanceof Error) throw next
    if (next === "sent") sent.push(message)
    return next
  },
}

function handler(now = NOW) {
  return createWhatsAppSendHandler({
    db: database().db,
    jobKey: () => jobKey,
    provider,
    now: () => now,
    wait: async (ms) => {
      waited.push(ms)
    },
  })
}

async function reserved(): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "INSERT INTO whatsapp_log (phone_hash, status) VALUES ('h', 'reserved') RETURNING id",
  )
  return rows[0]?.id ?? ""
}

async function row(id: string) {
  const { rows } = await su.query<{ status: string; error: string | null }>(
    "SELECT status, error FROM whatsapp_log WHERE id = $1",
    [id],
  )
  return rows[0]
}

const job = (logId: string, expiresAt = NOW.getTime() + 60_000) => ({
  logId,
  sealed: seal({ to, code: "654321", expiresAt }, jobKey, "job"),
})

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await su.query("DELETE FROM whatsapp_log")
  sent = []
  next = "sent"
  waited = []
})

afterAll(async () => {
  await su.query("DELETE FROM whatsapp_log")
  await su.end()
})

describe("whatsapp-send", () => {
  test("sends the code and marks the row sent", async () => {
    const id = await reserved()
    expect(await handler()(job(id), new AbortController().signal)).toBe("sent")
    expect(sent).toEqual([{ to, code: "654321" }])
    expect(await row(id)).toEqual({ status: "sent", error: null })
  })

  test("a sent row is not sent twice", async () => {
    const id = await reserved()
    const run = handler()
    await run(job(id), new AbortController().signal)
    expect(await run(job(id), new AbortController().signal)).toBe("duplicate")
    expect(sent.length).toBe(1)
  })

  test("an expired code is dropped, never sent", async () => {
    const id = await reserved()
    const outcome = await handler()(
      job(id, NOW.getTime() - 1),
      new AbortController().signal,
    )
    expect(outcome).toBe("expired")
    expect(sent).toEqual([])
    expect(await row(id)).toEqual({ status: "failed", error: "expired" })
  })

  test("permanent refusals complete with the reason", async () => {
    for (const result of ["not_on_whatsapp", "unavailable"] as const) {
      const id = await reserved()
      next = result
      expect(await handler()(job(id), new AbortController().signal)).toBe(
        result,
      )
      expect(await row(id)).toEqual({ status: "failed", error: result })
    }
  })

  test("a provider error marks failed and throws for retry", async () => {
    const id = await reserved()
    next = new Error("socket closed")
    await expect(
      handler()(job(id), new AbortController().signal),
    ).rejects.toThrow("socket closed")
    expect(await row(id)).toEqual({ status: "failed", error: "provider" })
  })

  test("a tampered payload is dropped", async () => {
    const id = await reserved()
    const outcome = await handler()(
      { logId: id, sealed: "AAAA" },
      new AbortController().signal,
    )
    expect(outcome).toBe("unreadable")
    expect(await row(id)).toEqual({ status: "failed", error: "provider" })
  })

  test("sends keep a gap between them", async () => {
    const run = handler()
    await run(job(await reserved()), new AbortController().signal)
    await run(job(await reserved()), new AbortController().signal)
    expect(waited.at(-1)).toBeGreaterThanOrEqual(WHATSAPP_LIMITS.gapMs)
  })
})
