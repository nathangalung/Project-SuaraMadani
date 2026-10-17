import { describe, expect, test } from "bun:test"
import { parseRegions, readRegions, TEST_REGIONS } from "./regions.ts"
import { SAMPLE_REGIONS } from "./sample-content.ts"

describe("Kepmendagri region list", () => {
  test("every level is complete", async () => {
    const rows = await readRegions()
    const levels = [1, 2, 3, 4].map(
      (level) =>
        rows.filter(([code]) => code.split(".").length === level).length,
    )
    expect(levels).toEqual([38, 514, 7285, 83762])
    expect(new Set(rows.map(([code]) => code)).size).toBe(rows.length)
  })

  test("parents come first and exist", async () => {
    const seen = new Set<string>()
    for (const [code, parent] of await readRegions()) {
      if (parent) {
        expect(code.startsWith(`${parent}.`)).toBe(true)
        expect(seen.has(parent)).toBe(true)
      }
      seen.add(code)
    }
  })

  test("test and sample rows use official names", async () => {
    const official = new Map(
      (await readRegions()).map(([code, , name]) => [code, name]),
    )
    for (const [code, parent, name] of [...TEST_REGIONS, ...SAMPLE_REGIONS]) {
      expect([code, official.get(code)]).toEqual([code, name])
      if (parent) expect(official.has(parent)).toBe(true)
    }
  })

  test("a malformed line is refused", () => {
    expect(parseRegions("32\tJawa Barat\n32.73\tKota Bandung\n")).toEqual([
      ["32", null, "Jawa Barat"],
      ["32.73", "32", "Kota Bandung"],
    ])
    expect(() => parseRegions("32.7\tSalah\n")).toThrow()
    expect(() => parseRegions("32\t\n")).toThrow()
    expect(() =>
      parseRegions("32.73\tKota Bandung\n32\tJawa Barat\n"),
    ).toThrow()
  })
})
