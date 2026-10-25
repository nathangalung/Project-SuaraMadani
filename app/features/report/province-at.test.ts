import { describe, expect, test } from "bun:test"
import { action } from "~/routes/region-point"
import { provinceAt } from "./province-at.server"

function post(body: string) {
  const request = new Request("http://itb.localhost/wilayah/titik", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
  return action({ request } as Parameters<typeof action>[0])
}

describe("province at a point", () => {
  test("cities land in their Kemendagri province", () => {
    // Bandung, Jakarta, Denpasar, Makassar
    expect(provinceAt({ lat: -6.9, lng: 107.6 })).toBe("32")
    expect(provinceAt({ lat: -6.2, lng: 106.85 })).toBe("31")
    expect(provinceAt({ lat: -8.65, lng: 115.2 })).toBe("51")
    expect(provinceAt({ lat: -5.14, lng: 119.43 })).toBe("73")
  })

  test("open sea matches nothing", () => {
    expect(provinceAt({ lat: -5.5, lng: 110.5 })).toBeNull()
  })

  test("the route answers with no-store", async () => {
    const res = await post(JSON.stringify({ lat: -6.9, lng: 107.6 }))
    expect(await res.json()).toEqual({ provinceCode: "32" })
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  test("points outside Indonesia and junk are 400", async () => {
    for (const body of [
      JSON.stringify({ lat: 51.5, lng: -0.1 }),
      JSON.stringify({ lat: "-6.9", lng: 107.6 }),
      "not json",
    ]) {
      const thrown = await post(body).catch((error: unknown) => error)
      expect(thrown).toMatchObject({ init: { status: 400 } })
    }
  })
})
