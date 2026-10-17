import { describe, expect, test } from "bun:test"
import {
  checkTheme,
  contrast,
  declarations,
  ringStops,
  rootDefaults,
  stops,
} from "./theme-contrast.ts"

describe("contrast helper", () => {
  test("matches WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5)
    // Mockup audit: km-blue on cream
    expect(contrast("#176bff", "#fff8e5")).toBeCloseTo(4.32, 2)
  })
})

describe("parsers", () => {
  test("reads the first :root block only", () => {
    const css =
      ":root { --theme-ink: #08266e; --dur-hover: 1s; } :root { --theme-ink: #000000; }"
    expect([...rootDefaults(css)]).toEqual([["ink", "#08266e"]])
  })

  test("reads emitted tenant CSS with gradients", () => {
    const css =
      ":root{--theme-ink:#1a2b3c;--theme-band-bg:linear-gradient(180deg, #0f49d4 0%, #08266e 100%)}"
    expect(declarations(css).get("band-bg")).toBe(
      "linear-gradient(180deg, #0f49d4 0%, #08266e 100%)",
    )
    expect(declarations(css).get("ink")).toBe("#1a2b3c")
  })

  test("stops skip transparent and keep the base colour", () => {
    expect(
      stops(
        "radial-gradient(55% 45% at 100% 40%, #e3eefc 0%, transparent 70%), #fff8e5",
      ),
    ).toEqual(["#e3eefc", "#fff8e5"])
    expect(stops("#ffffff")).toEqual(["#ffffff"])
  })
})

describe("ring stops", () => {
  const hero = "linear-gradient(180deg, #f3f6cf 0%, #b9daf3 62%, #5f95ea 100%)"

  test("the hero drops only its masked tail", () => {
    expect(ringStops("hero-bg", hero)).toEqual(["#f3f6cf", "#b9daf3"])
    expect(ringStops("hero-bg", "#ffffff")).toEqual(["#ffffff"])
  })

  test("other backgrounds keep every stop", () => {
    expect(ringStops("detail-bg", hero)).toEqual([
      "#f3f6cf",
      "#b9daf3",
      "#5f95ea",
    ])
  })
})

describe("checkTheme", () => {
  test("the default theme passes", () => {
    expect(checkTheme({})).toEqual([])
  })

  test("white text on a light brand fails", () => {
    const failures = checkTheme({ brand: "#ffd400" })
    expect(failures).toContainEqual(
      expect.objectContaining({ fg: "on-accent", bg: "brand", min: 4.5 }),
    )
    // Large text pair checked too
    expect(failures).toContainEqual(
      expect.objectContaining({ fg: "brand", bg: "surface", min: 3 }),
    )
  })

  test("every gradient stop is checked", () => {
    const failures = checkTheme({
      pageBg: "linear-gradient(180deg, #fff8e5 0%, #0a1a40 100%)",
    })
    expect(failures).toContainEqual(
      expect.objectContaining({ fg: "ink", bg: "page-bg", stop: "#0a1a40" }),
    )
  })

  test("reports the ratio rounded down", () => {
    const [failure] = checkTheme({ inkMuted: "#9aa0b0" }).filter(
      (f) => f.fg === "ink-muted" && f.bg === "surface",
    )
    expect(failure?.ratio).toBe(Math.floor((failure?.ratio ?? 0) * 100) / 100)
    expect(failure?.ratio).toBeLessThan(4.5)
  })
})
