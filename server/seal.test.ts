import { describe, expect, test } from "bun:test"
import { openSealed, parseSealKey, seal } from "./seal.ts"

const key = Buffer.alloc(32, 7)

describe("seal", () => {
  test("round trip under one purpose", () => {
    const sealed = seal({ to: "+6281234567890", code: "123456" }, key, "job")
    expect(sealed).not.toContain("123456")
    expect(sealed).not.toContain("6281234567890")
    expect(openSealed(sealed, key, "job")).toEqual({
      to: "+6281234567890",
      code: "123456",
    })
  })

  test("other purpose, key or tampering fails", () => {
    const sealed = seal({ a: 1 }, key, "job")
    expect(() => openSealed(sealed, key, "creds")).toThrow()
    expect(() => openSealed(sealed, Buffer.alloc(32, 8), "job")).toThrow()
    const bytes = Buffer.from(sealed, "base64url")
    bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1
    expect(() => openSealed(bytes.toString("base64url"), key, "job")).toThrow()
  })

  test("each seal uses a fresh nonce", () => {
    expect(seal({ a: 1 }, key, "job")).not.toBe(seal({ a: 1 }, key, "job"))
  })
})

describe("parseSealKey", () => {
  test("needs 32 bytes of base64", () => {
    expect(parseSealKey(key.toString("base64"), "K")).toEqual(key)
    expect(() => parseSealKey(undefined, "K")).toThrow("K is not set")
    expect(() =>
      parseSealKey(Buffer.alloc(16).toString("base64"), "K"),
    ).toThrow("K needs 32 bytes")
  })
})
