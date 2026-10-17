import { describe, expect, test } from "bun:test"
import { createServer } from "node:net"
import { clamdFromEnv, scanBytes } from "./clamav.ts"
import { eicar, pdfWithAttachment, simplePdf } from "./fixtures.ts"

// Live clamd from infra/compose.dev.yaml
const clamd = clamdFromEnv()

describe("clamd INSTREAM", () => {
  test("clean PDF passes", async () => {
    expect(await scanBytes(simplePdf(2), clamd)).toEqual({ infected: false })
  })

  test("EICAR inside a PDF is found", async () => {
    const result = await scanBytes(pdfWithAttachment(eicar()), clamd)
    expect(result.infected).toBe(true)
    if (result.infected) expect(result.signature).toMatch(/eicar/i)
  })

  test("raw EICAR is found", async () => {
    const result = await scanBytes(eicar(), clamd)
    expect(result.infected).toBe(true)
  })

  test("unreachable clamd throws for retry", async () => {
    await expect(
      scanBytes(simplePdf(1), { host: "127.0.0.1", port: 1, timeoutMs: 2000 }),
    ).rejects.toThrow()
  })

  test("silent clamd times out", async () => {
    const server = createServer(() => {})
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    try {
      await expect(
        scanBytes(simplePdf(1), { host: "127.0.0.1", port, timeoutMs: 300 }),
      ).rejects.toThrow("clamd timeout")
    } finally {
      server.close()
    }
  })

  test("an error reply throws", async () => {
    const server = createServer((socket) => {
      socket.on("data", () => {
        socket.end("INSTREAM size limit exceeded. ERROR\0")
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    try {
      await expect(
        scanBytes(simplePdf(1), { host: "127.0.0.1", port, timeoutMs: 2000 }),
      ).rejects.toThrow("clamd error")
    } finally {
      server.close()
    }
  })
})
