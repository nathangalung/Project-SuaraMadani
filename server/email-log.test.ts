import { describe, expect, test } from "bun:test"
import { addressHash, parseHashKey } from "./email-log.ts"

const key = parseHashKey(Buffer.alloc(32, 7).toString("base64"))

describe("email_log address hash", () => {
  test("case and spaces do not split one address", () => {
    expect(addressHash(" Warga@Contoh.ID ", key)).toBe(
      addressHash("warga@contoh.id", key),
    )
  })

  test("keyed, never the plain digest", () => {
    const other = parseHashKey(Buffer.alloc(32, 8).toString("base64"))
    expect(addressHash("warga@contoh.id", key)).not.toBe(
      addressHash("warga@contoh.id", other),
    )
    expect(addressHash("warga@contoh.id", key)).toMatch(/^[0-9a-f]{64}$/)
  })

  test("refuses a missing or short key", () => {
    expect(() => parseHashKey(undefined)).toThrow("AUDIT_HMAC_KEY")
    expect(() => parseHashKey("c2hvcnQ=")).toThrow("32 bytes")
  })
})
