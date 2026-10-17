import { describe, expect, test } from "bun:test"
import { isTrustedRequest } from "./csrf.ts"

const url = "https://itb.example.id/lapor/periksa"

function req(method: string, headers: Record<string, string>) {
  return new Request(url, { method, headers })
}

describe("isTrustedRequest", () => {
  test("safe methods always pass", () => {
    expect(isTrustedRequest(req("GET", { origin: "https://evil.test" }))).toBe(
      true,
    )
    expect(isTrustedRequest(req("HEAD", {}))).toBe(true)
  })

  test("same origin passes", () => {
    expect(
      isTrustedRequest(req("POST", { origin: "https://itb.example.id" })),
    ).toBe(true)
  })

  test("another tenant on the same site is refused", () => {
    expect(
      isTrustedRequest(
        req("POST", {
          origin: "https://ugm.example.id",
          "sec-fetch-site": "same-site",
        }),
      ),
    ).toBe(false)
  })

  test("scheme and port must match", () => {
    expect(
      isTrustedRequest(req("POST", { origin: "http://itb.example.id" })),
    ).toBe(false)
    expect(
      isTrustedRequest(req("POST", { origin: "https://itb.example.id:8443" })),
    ).toBe(false)
  })

  test("without Origin, Sec-Fetch-Site decides", () => {
    expect(
      isTrustedRequest(req("POST", { "sec-fetch-site": "same-origin" })),
    ).toBe(true)
    expect(
      isTrustedRequest(req("POST", { "sec-fetch-site": "cross-site" })),
    ).toBe(false)
  })

  test("no browser signal at all fails closed", () => {
    expect(isTrustedRequest(req("POST", {}))).toBe(false)
    expect(isTrustedRequest(req("DELETE", { origin: "null" }))).toBe(false)
  })
})
