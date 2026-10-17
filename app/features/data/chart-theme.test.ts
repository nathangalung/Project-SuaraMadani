import { describe, expect, test } from "bun:test"
import { contrast } from "../../../shared/theme-contrast.ts"
import {
  CATEGORY_COLOR,
  DEMAND_FILL,
  MAP_FILL,
  TREND_COLOR,
} from "./chart-theme"

describe("chart palette", () => {
  test("category bars use the CVD checked palette", () => {
    const colors = Object.values(CATEGORY_COLOR)
    expect(new Set(colors).size).toBe(colors.length)
    // Tenant purple fails deutan
    expect(colors).not.toContain("#a500fd")
    for (const color of colors) {
      expect(contrast(color, "#ffffff")).toBeGreaterThanOrEqual(3)
    }
    expect(CATEGORY_COLOR.program).toBe(TREND_COLOR.received)
  })

  test("both map ramps darken step by step", () => {
    const steps = ["zero", "few", "low", "mid", "high"] as const
    for (const ramp of [MAP_FILL, DEMAND_FILL]) {
      const against = steps.map((id) => contrast(ramp[id], "#ffffff"))
      for (let i = 1; i < against.length; i++) {
        expect(against[i] ?? 0).toBeGreaterThan(against[i - 1] ?? 0)
      }
      // dataviz light-end floor
      expect(against[1] ?? 0).toBeGreaterThanOrEqual(2)
    }
    // Layers never share a hue
    expect(DEMAND_FILL.mid).not.toBe(MAP_FILL.mid)
    expect(DEMAND_FILL.zero).toBe(MAP_FILL.zero)
  })
})
