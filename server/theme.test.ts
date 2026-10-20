import { describe, expect, test } from "bun:test"
import { FONT_CHOICES, THEME_GROUPS } from "../shared/theme-defaults.ts"
import {
  brandAssets,
  headingFont,
  isThemeValue,
  THEME_TOKENS,
  themeColor,
  themeStyle,
} from "./theme.server.ts"

describe("settings form tokens", () => {
  test("the form groups cover every token once", () => {
    const grouped = Object.values(THEME_GROUPS).flat()
    expect([...grouped].sort()).toEqual([...THEME_TOKENS].sort())
  })

  test("every font choice is a known stack", () => {
    for (const stack of FONT_CHOICES) {
      expect(isThemeValue("fontBody", stack)).toBe(true)
    }
    expect(isThemeValue("fontBody", "Comic Sans MS")).toBe(false)
  })

  test("values use the themeStyle grammar", () => {
    expect(isThemeValue("brand", "#176bff")).toBe(true)
    expect(isThemeValue("brand", "red")).toBe(false)
    expect(isThemeValue("pageBg", "url(x)")).toBe(false)
  })
})

describe("themeStyle", () => {
  test("writes valid tokens as --theme-* variables", () => {
    expect(
      themeStyle({
        surface: "#fff8e5",
        accentHover: "#0B44AB",
        ink: "#08266e",
      }),
    ).toBe(
      ":root{--theme-surface:#fff8e5;--theme-ink:#08266e;--theme-accent-hover:#0B44AB}",
    )
  })

  test("accepts the KM ITB gradient and font stacks", () => {
    const css = themeStyle({
      headerBg:
        "linear-gradient(100deg, #a8efe2 0%, #e9f7d8 45%, #f3f3a6 100%)",
      fontBody: "Aleo, Georgia, serif",
      fontHeading: '"Tilt Warp", system-ui, sans-serif',
    })
    expect(css).toContain(
      "--theme-header-bg:linear-gradient(100deg, #a8efe2 0%, #e9f7d8 45%, #f3f3a6 100%)",
    )
    expect(css).toContain(
      '--theme-font-body:Aleo, "Aleo Fallback", Georgia, serif',
    )
    expect(css).toContain(
      '--theme-font-heading:"Tilt Warp", "Tilt Warp Fallback", system-ui',
    )
  })

  test("drops values that could break out of the style block", () => {
    const css = themeStyle({
      surface: "#fff}body{display:none",
      ink: "red",
      accent: "#0f55d6</style><script>alert(1)</script>",
      fontBody: "Comic Sans; color: red",
      headerBg: "url(https://evil.example/x.png)",
      unknownToken: "#000000",
    })
    expect(css).toBe("")
  })

  test("accepts the KM ITB layered backgrounds", () => {
    const backgrounds = {
      heroBg:
        "linear-gradient(180deg, #f3f6cf 0%, #dff3e3 30%, #b9daf3 62%, #5f95ea 100%)",
      pageBg:
        "radial-gradient(55% 45% at 100% 40%, #e3eefc 0%, transparent 70%), #fff8e5",
      homeListBg:
        "radial-gradient(45% 30% at 0% 6%, #fbe29a 0%, transparent 70%), radial-gradient(45% 35% at 100% 70%, #c4e2f6 0%, transparent 70%), radial-gradient(45% 30% at 0% 80%, #e3f3b9 0%, transparent 70%), linear-gradient(180deg, #f7f6dc 0%, #f2f8ec 55%, #eef6f6 100%)",
    }
    const css = themeStyle(backgrounds)
    expect(css).toContain(`--theme-hero-bg:${backgrounds.heroBg}`)
    expect(css).toContain(`--theme-page-bg:${backgrounds.pageBg}`)
    expect(css).toContain(`--theme-home-list-bg:${backgrounds.homeListBg}`)
  })

  test("writes the new colour tokens", () => {
    expect(
      themeStyle({ brand: "#176bff", popStrong: "#d43092", dangerInk: "x" }),
    ).toBe(":root{--theme-brand:#176bff;--theme-pop-strong:#d43092}")
  })

  test("rejects unsafe or oversized background layers", () => {
    const radial =
      "radial-gradient(45% 30% at 0% 6%, #fbe29a 0%, transparent 70%)"
    const rejected = [
      `${radial}, url(https://evil.example/x.png)`,
      "conic-gradient(#000000 0%, #ffffff 100%)",
      "repeating-linear-gradient(90deg, #000000 0%, #ffffff 100%)",
      `${radial}, ${radial}, ${radial}, ${radial}, ${radial}, #ffffff`,
      `#ffffff, ${radial}`,
      `${radial}, red`,
      `${radial}), #ffffff`,
      "radial-gradient(45% 30% at 0% 6%, #fbe29a 0%, #000000 70%)",
      `${radial};}body{display:none`,
    ]
    for (const pageBg of rejected) expect(themeStyle({ pageBg })).toBe("")
  })

  test("ignores non-object input", () => {
    expect(themeStyle(null)).toBe("")
    expect(themeStyle("#fff")).toBe("")
    expect(themeStyle([1, 2])).toBe("")
  })
})

describe("themeColor", () => {
  test("matches the theme ink", () => {
    expect(themeColor({ ink: "#1a2b3c" })).toBe("#1a2b3c")
  })

  test("falls back to the default ink from styles.css", async () => {
    const css = await Bun.file(
      new URL("../app/styles.css", import.meta.url),
    ).text()
    const ink = css.match(/--theme-ink:\s*(#[0-9a-f]{6});/i)?.[1]
    expect(themeColor({})).toBe(ink ?? "")
    expect(themeColor({ ink: "red" })).toBe(ink ?? "")
    expect(themeColor(null)).toBe(ink ?? "")
  })
})

describe("headingFont", () => {
  test("names the webfont the heading stack loads", () => {
    expect(
      headingFont({ fontHeading: '"Tilt Warp", system-ui, sans-serif' }),
    ).toBe("tilt-warp")
    expect(headingFont({ fontHeading: "Aleo, Georgia, serif" })).toBe("aleo")
    expect(headingFont({ fontHeading: "Barlow, system-ui, sans-serif" })).toBe(
      "barlow",
    )
  })

  test("system stack and bad input load none", () => {
    expect(
      headingFont({
        fontHeading: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }),
    ).toBeNull()
    expect(headingFont({ fontHeading: "Comic Sans" })).toBeNull()
    expect(headingFont({})).toBeNull()
    expect(headingFont(null)).toBeNull()
  })
})

describe("brandAssets", () => {
  test("only the known set, never CSS", () => {
    expect(brandAssets({ brandAssets: "km-itb" })).toBe("km-itb")
    expect(brandAssets({ brandAssets: "km-ugm" })).toBeNull()
    expect(brandAssets({ brandAssets: ["km-itb"] })).toBeNull()
    expect(brandAssets(null)).toBeNull()
    expect(themeStyle({ brandAssets: "km-itb" })).toBe("")
  })
})

describe("fallback faces", () => {
  test("every emitted fallback family has metric overrides", async () => {
    const styles = await Bun.file(
      new URL("../app/styles.css", import.meta.url),
    ).text()
    const css = themeStyle({
      fontBody: "Aleo, Georgia, serif",
      fontHeading: '"Tilt Warp", system-ui, sans-serif',
      fontUi: "Barlow, system-ui, sans-serif",
    })
    const families = [...css.matchAll(/"([^"]+ Fallback)"/g)].map((m) => m[1])
    expect(families).toEqual([
      "Aleo Fallback",
      "Tilt Warp Fallback",
      "Barlow Fallback",
    ])
    for (const family of families) {
      const faces = [...styles.matchAll(/@font-face\s*\{([^}]*)\}/g)]
        .map((m) => m[1] ?? "")
        .filter((body) => body.includes(`font-family: "${family}"`))
      expect(faces.length).toBeGreaterThan(0)
      for (const face of faces) {
        expect(face).toMatch(/src:\s+local\(/)
        expect(face).toMatch(/size-adjust: [\d.]+%/)
        expect(face).toMatch(/ascent-override: [\d.]+%/)
        expect(face).toMatch(/descent-override: [\d.]+%/)
      }
    }
  })
})
