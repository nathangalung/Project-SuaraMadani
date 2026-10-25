import { describe, expect, spyOn, test } from "bun:test"
import { createPurgeClient, purgeQuietly } from "./purge.server.ts"

type Call = { url: string; init: RequestInit }

function fakeFetch(ok = true) {
  const calls: Call[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return Response.json({ success: ok }, { status: ok ? 200 : 400 })
  }
  return { fetch, calls }
}

const body = (call: Call | undefined) => JSON.parse(String(call?.init.body))

describe("createPurgeClient", () => {
  test("is a no-op without a token", async () => {
    const { fetch, calls } = fakeFetch()
    const client = createPurgeClient({ zoneId: "z", token: "", fetch })
    expect(await client.purgeUrls(["https://itb.x.id/isu"])).toEqual({
      skipped: true,
    })
    expect(await client.purgeHosts(["itb.x.id"])).toEqual({ skipped: true })
    expect(calls).toHaveLength(0)
  })

  test("purges URLs in batches of 100", async () => {
    const { fetch, calls } = fakeFetch()
    const client = createPurgeClient({ zoneId: "zone1", token: "t", fetch })
    const urls = Array.from({ length: 205 }, (_, i) => `https://itb.x.id/${i}`)
    expect(await client.purgeUrls(urls)).toEqual({ skipped: false })
    expect(calls).toHaveLength(3)
    expect(calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/zones/zone1/purge_cache",
    )
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
      "Bearer t",
    )
    // API10: token never follows redirects
    expect(calls[0]?.init.redirect).toBe("error")
    expect(body(calls[0]).files).toHaveLength(100)
    expect(body(calls[2]).files).toHaveLength(5)
  })

  test("purges hosts and reports API failures", async () => {
    const ok = fakeFetch()
    await createPurgeClient({
      zoneId: "z",
      token: "t",
      fetch: ok.fetch,
    }).purgeHosts(["itb.x.id"])
    expect(body(ok.calls[0])).toEqual({ hosts: ["itb.x.id"] })
    const bad = fakeFetch(false)
    await expect(
      createPurgeClient({
        zoneId: "z",
        token: "t",
        fetch: bad.fetch,
      }).purgeUrls(["https://itb.x.id/"]),
    ).rejects.toThrow("purge failed: 400")
  })
})

describe("purgeQuietly", () => {
  test("a failure reaches the error stream", async () => {
    // ASVS V16.3.4: runbook error query
    const lines: string[] = []
    const spy = spyOn(console, "error").mockImplementation((line) => {
      lines.push(String(line))
    })
    try {
      await purgeQuietly(
        ["https://itb.localhost/isu"],
        { host: "x" },
        {
          purge: {
            purgeUrls: async () => {
              throw new Error("purge failed: 429")
            },
            purgeHosts: async () => ({ skipped: false }),
          },
        },
      )
    } finally {
      spy.mockRestore()
    }
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        level: "error",
        msg: "purge failed",
        host: "x",
        error: "Error",
        message: "purge failed: 429",
      }),
    ])
  })
})
