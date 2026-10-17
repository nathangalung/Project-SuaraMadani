import { describe, expect, test } from "bun:test"
import { brandAssets, themeStyle } from "../../server/theme.server.ts"
import {
  BACKGROUND_TEXT,
  BACKGROUND_UI,
  checkTheme,
  contrast,
  declarations,
  LARGE_TEXT_PAIRS,
  ringStops,
  rootDefaults,
  stops,
  TEXT_PAIRS,
  UI_PAIRS,
} from "../../shared/theme-contrast.ts"
import { ITB_THEME } from "./organizations.ts"

const css = await Bun.file(
  new URL("../../app/styles.css", import.meta.url),
).text()

// Tenant CSS wins over defaults
const emitted = declarations(themeStyle(ITB_THEME))
const theme = new Map([...rootDefaults(css), ...emitted])

const color = (name: string): string => {
  const value = theme.get(name)
  if (!value?.match(/^#[0-9a-f]{6}$/i)) {
    throw new Error(`--theme-${name} is not a hex colour`)
  }
  return value
}

describe("KM ITB theme", () => {
  test("the validator keeps every seeded value", () => {
    const { brandAssets: _set, ...tokens } = ITB_THEME
    expect(emitted.size).toBe(Object.keys(tokens).length)
  })

  test("the settings check accepts it", () => {
    expect(checkTheme(ITB_THEME)).toEqual([])
  })

  test("names the KM ITB ornament set", () => {
    expect(brandAssets(ITB_THEME)).toBe("km-itb")
  })

  test("repeats no default value", () => {
    const defaults = rootDefaults(css)
    for (const [name, value] of emitted) {
      expect(`${name}: ${value}`).not.toBe(`${name}: ${defaults.get(name)}`)
    }
  })

  for (const [fg, bg] of TEXT_PAIRS) {
    test(`text ${fg} on ${bg} is at least 4.5:1`, () => {
      expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5)
    })
  }

  for (const [fg, bg] of LARGE_TEXT_PAIRS) {
    test(`large text ${fg} on ${bg} is at least 3:1`, () => {
      expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(3)
    })
  }

  for (const [fg, bg] of UI_PAIRS) {
    test(`component ${fg} on ${bg} is at least 3:1`, () => {
      expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(3)
    })
  }

  for (const [fg, bg] of BACKGROUND_TEXT) {
    test(`text ${fg} on every ${bg} stop is at least 4.5:1`, () => {
      const colours = stops(theme.get(bg) ?? "")
      expect(colours.length).toBeGreaterThan(0)
      for (const stop of colours) {
        expect(contrast(color(fg), stop)).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  for (const [fg, bg] of BACKGROUND_UI) {
    test(`ring ${fg} on every ${bg} stop is at least 3:1`, () => {
      const colours = ringStops(bg, theme.get(bg) ?? "")
      expect(colours.length).toBeGreaterThan(0)
      for (const stop of colours) {
        expect(contrast(color(fg), stop)).toBeGreaterThanOrEqual(3)
      }
    })
  }
})
