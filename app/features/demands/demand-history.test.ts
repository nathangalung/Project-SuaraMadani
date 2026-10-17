import { describe, expect, test } from "bun:test"
import { demandHistory } from "./demand-history"
import type { DemandEvent } from "./demands.server"

function event(over: Partial<DemandEvent>): DemandEvent {
  return {
    id: "e1",
    action: "publish",
    item: null,
    response: null,
    fulfilment: null,
    occurredOn: "2026-09-06",
    note: null,
    sourceText: null,
    sourceUrl: null,
    createdAt: new Date("2026-09-06T05:00:00Z"),
    ...over,
  }
}

describe("demandHistory", () => {
  test("a sub-tuntutan update keeps its text under the sub-tuntutan only", () => {
    const [entry] = demandHistory(
      [
        event({
          action: "status",
          item: 3,
          response: "responded",
          fulfilment: "fulfilled",
          note: "Peta gangguan terbit setiap pagi.",
          sourceText: "Pemeriksaan tim",
        }),
      ],
      "Admin KM ITB",
    )
    expect(entry?.title).toBe("Status subtuntutan 3 berubah")
    // Verb said once
    expect(entry?.status).toBe("Menjadi Direspons · Dipenuhi")
    expect(entry?.body).toBeUndefined()
    // Jumps to the sub-tuntutan
    expect(entry?.href).toBe("#sub-3")
  })

  test("a note on the tuntutan itself stays in the timeline", () => {
    const [entry] = demandHistory(
      [event({ action: "close", note: "Semua sub-tuntutan selesai." })],
      "Admin KM ITB",
    )
    expect(entry?.body).toBe("Semua sub-tuntutan selesai.")
    expect(entry?.href).toBeUndefined()
  })
})
