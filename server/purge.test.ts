import { describe, expect, test } from "bun:test"
import { createPurgeClient } from "./purge.server.ts"

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
