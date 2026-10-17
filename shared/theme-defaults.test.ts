import { describe, expect, test } from "bun:test"
import { rootDefaults } from "./theme-contrast.ts"
import { THEME_DEFAULTS } from "./theme-defaults.ts"

const css = await Bun.file(new URL("../app/styles.css", import.meta.url)).text()

// Formatter may wrap long values
const flat = (value: string) =>
  value.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim()

describe("THEME_DEFAULTS", () => {
  test("matches every colour default in styles.css", () => {
    const fromCss = [...rootDefaults(css)]
      .filter(([name]) => !name.startsWith("font-"))
      .map(([name, value]): [string, string] => [name, flat(value)])
    expect(Object.entries(THEME_DEFAULTS)).toEqual(fromCss)
  })
})
