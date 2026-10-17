import { describe, expect, test } from "bun:test"
import { providerName } from "./provider.ts"

describe("providerName", () => {
  test("unknown names fail at boot", () => {
    expect(providerName(" meta ")).toBe("meta")
    expect(() => providerName("twilio")).toThrow("WHATSAPP_PROVIDER")
  })
})
