import { describe, expect, test } from "bun:test"
import { parseThemeForm } from "./theme-form.server.ts"

describe("theme form", () => {
  test("empty fields and defaults store nothing", () => {
    const result = parseThemeForm({ brand: "", ink: "#08266E" }, {})
    expect(result).toMatchObject({ theme: {}, invalid: [], failures: [] })
  })

  test("keeps the ornament set and lowercases colours", () => {
    const result = parseThemeForm(
      { brand: " #176BFF " },
      { brandAssets: "km-itb", brand: "#0f55d6" },
    )
    expect(result.theme).toEqual({ brandAssets: "km-itb", brand: "#176bff" })
    expect(result.changed).toEqual(["brand"])
  })

  test("names values outside the grammar", () => {
    const result = parseThemeForm(
      { brand: "blue", pageBg: "url(https://x)", fontUi: "Papyrus" },
      {},
    )
    expect(result.invalid).toEqual(["brand", "pageBg", "fontUi"])
    expect(result.failures).toEqual([])
  })

  test("contrast failures block the save", () => {
    const result = parseThemeForm({ brand: "#ffd400" }, {})
    expect(result.failures.length).toBeGreaterThan(0)
  })
})
