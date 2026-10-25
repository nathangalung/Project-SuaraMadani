import { describe, expect, test } from "bun:test"
import { returnPath } from "./return-path.ts"

describe("returnPath", () => {
  test("an issue page or /lacak", () => {
    expect(returnPath("/isu/ISU-2026-10-0042")).toBe("/isu/ISU-2026-10-0042")
    expect(returnPath("/lacak")).toBe("/lacak")
  })

  test("a tuntutan to follow, a complaint to read", () => {
    for (const path of [
      "/tuntutan/TUN-ITB-26-0003",
      "/aduan/ADU-ITB-26-ZEMX1",
    ]) {
      expect(returnPath(path)).toBe(path)
    }
  })

  test("a staff invitation", () => {
    const path = "/undangan/0199c2b0-1d2e-7000-8000-000000000001"
    expect(returnPath(path)).toBe(path)
  })

  test("anything else is dropped", () => {
    for (const value of [
      null,
      "",
      "//evil.example/isu/X",
      "https://evil.example",
      "/\\evil.example",
      "/isu/ISU-1/berhenti",
      "/tuntutan/TUN-1/laporkan",
      "/aduan/<x>",
      "/kelola",
      "/isu/<script>",
      "/lacak?t=x",
      "/undangan/x",
      "/undangan/0199C2B0-1D2E-7000-8000-000000000001/x",
    ]) {
      expect(returnPath(value)).toBe(null)
    }
  })
})
