import { describe, expect, test } from "bun:test"
import { WHATSAPP_FRESH_MS, whatsappReady } from "./whatsapp.ts"

describe("whatsappReady", () => {
  const now = new Date("2026-10-16T05:00:00Z")
  const seen = (ms: number) => new Date(now.getTime() - ms)

  test("connected with a fresh heartbeat", () => {
    expect(
      whatsappReady({ status: "connected", lastSeenAt: seen(1000) }, now),
    ).toBe(true)
  })

  test("stale heartbeat, other states or no row", () => {
    expect(
      whatsappReady(
        { status: "connected", lastSeenAt: seen(WHATSAPP_FRESH_MS + 1) },
        now,
      ),
    ).toBe(false)
    for (const status of [
      "unlinked",
      "linking",
      "disconnected",
      "logged_out",
    ] as const) {
      expect(whatsappReady({ status, lastSeenAt: seen(1000) }, now)).toBe(false)
    }
    expect(whatsappReady({ status: "connected", lastSeenAt: null }, now)).toBe(
      false,
    )
    expect(whatsappReady(undefined, now)).toBe(false)
  })
})
