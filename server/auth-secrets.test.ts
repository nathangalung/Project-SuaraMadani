import { describe, expect, test } from "bun:test"
import { parseAuthSecrets } from "./auth-secrets.ts"

const key = (byte: number, bytes = 32) =>
  Buffer.alloc(bytes, byte).toString("base64")

describe("parseAuthSecrets", () => {
  test("keeps the original strings, newest first", () => {
    expect(parseAuthSecrets(`2:${key(2)}, 1:${key(1)}`)).toEqual([
      { version: 2, value: key(2) },
      { version: 1, value: key(1) },
    ])
  })

  test("refuses short, retired-short and malformed values", () => {
    // ASVS V11.2.3: 256-bit keys
    expect(() => parseAuthSecrets(undefined)).toThrow("not set")
    expect(() => parseAuthSecrets("1:short")).toThrow("32 bytes")
    expect(() => parseAuthSecrets(`2:${key(2)},1:${key(1, 16)}`)).toThrow(
      "version 1 needs 32 bytes",
    )
    expect(() => parseAuthSecrets(key(1))).toThrow("<version>:<base64>")
    expect(() => parseAuthSecrets(`1:${key(1)},1:${key(2)}`)).toThrow(
      "Duplicate",
    )
  })
})
