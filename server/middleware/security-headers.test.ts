import { describe, expect, test } from "bun:test"
import { hstsPolicy } from "./security-headers.ts"

describe("hstsPolicy", () => {
  test("unset keeps the staged value", () => {
    expect(hstsPolicy(undefined)).toBe("max-age=300")
    expect(hstsPolicy("")).toBe("max-age=300")
  })

  test("the launch policy passes as given", () => {
    const launch = "max-age=31536000; includeSubDomains"
    expect(hstsPolicy(launch)).toBe(launch)
  })

  test("anything else refuses to boot", () => {
    for (const bad of [
      "max-age=abc",
      "includeSubDomains",
      "max-age=1\r\nX: y",
    ]) {
      expect(() => hstsPolicy(bad)).toThrow("HSTS_POLICY invalid")
    }
  })
})
