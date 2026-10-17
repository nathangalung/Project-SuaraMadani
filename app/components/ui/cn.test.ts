import { describe, expect, test } from "bun:test"
import { cn } from "./cn"

// Plain join, no conflicts
describe("cn", () => {
  test("joins classes in order", () => {
    expect(cn("text-ink", "text-lg")).toBe("text-ink text-lg")
  })

  test("drops falsy values", () => {
    expect(cn("p-2", false, undefined, null, "", "m-1")).toBe("p-2 m-1")
  })

  test("does not merge conflicting utilities", () => {
    expect(cn("p-2", "p-4")).toBe("p-2 p-4")
  })
})
