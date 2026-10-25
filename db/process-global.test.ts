import { describe, expect, test } from "bun:test"
import { processGlobal } from "./process-global.ts"

describe("processGlobal", () => {
  test("a second bundle copy gets the same value", () => {
    const first = processGlobal("test.shared", () => new Set<string>())
    const second = processGlobal("test.shared", () => new Set<string>())
    expect(second).toBe(first)
  })

  test("names do not collide", () => {
    const a = processGlobal("test.a", () => ({ name: "a" }))
    const b = processGlobal("test.b", () => ({ name: "b" }))
    expect(a).not.toBe(b)
  })

  test("create runs once", () => {
    let runs = 0
    processGlobal("test.once", () => ++runs)
    processGlobal("test.once", () => ++runs)
    expect(runs).toBe(1)
  })
})
