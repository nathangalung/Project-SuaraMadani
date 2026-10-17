import { describe, expect, test } from "bun:test"
import {
  BACKGROUND_TEXT,
  BACKGROUND_UI,
  contrast,
  LARGE_TEXT_PAIRS,
  ringStops,
  rootDefaults,
  stops,
  TEXT_PAIRS,
  UI_PAIRS,
} from "../shared/theme-contrast.ts"

const css = await Bun.file(new URL("./styles.css", import.meta.url)).text()

const theme = rootDefaults(css)
const color = (name: string): string => {
  const value = theme.get(name)
  if (!value?.match(/^#[0-9a-f]{6}$/i)) {
    throw new Error(`--theme-${name} needs a 6-digit hex default`)
  }
  return value
}

describe("default theme tokens", () => {
  test("every theme variable used by Tailwind has a default", () => {
    const used = [...css.matchAll(/var\(--theme-([\w-]+)\)/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    for (const name of used) expect(theme.has(name ?? "")).toBe(true)
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

describe("background tokens", () => {
  test("are utilities, so variants apply", () => {
    const names = [...css.matchAll(/var\(--theme-([\w-]+)-bg\)/g)].map(
      (m) => m[1],
    )
    expect(names.length).toBe(7)
    for (const name of names) {
      const utility = name === "header" ? "header-bg" : `bg-${name}`
      expect(css).toContain(`@utility ${utility} {`)
    }
  })
})

describe("hero scroll", () => {
  const keyframes = (name: string) =>
    css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ""

  test("heading fades but stays in the tree", () => {
    const text = keyframes("hero-text")
    expect(text).toContain("opacity: 0")
    expect(text).not.toContain("visibility")
  })

  test("only the actions leave the tab order", () => {
    expect(keyframes("hero-actions")).toContain("visibility: hidden")
    expect(css).toMatch(
      /\.hero-scroll \.hero-actions \{\s*animation-name: hero-actions;/,
    )
  })

  // Scroll model, header 6rem
  test("Cara Kerja arrives while the hero fades", () => {
    const rule = css.match(/\.hero-scroll \{([^}]*)\}/)?.[1] ?? ""
    const extra = Number(rule.match(/100svh - 6rem \+ (\d+)vh/)?.[1])
    const overlap = Number(rule.match(/margin-bottom: -(\d+)vh/)?.[1])
    const end = (name: string) =>
      Number(keyframes(name).match(/(\d+)%,\s*100% \{\s*opacity: 0/)?.[1])
    const faded = end("hero-bg") / 100
    const textGone = end("hero-text") / 100
    for (const view of [864, 900, 1080]) {
      const track = (extra / 100) * view + 96
      const top = (p: number) =>
        view + (1 - p) * track - 96 - (overlap / 100) * view
      expect(top(textGone)).toBeGreaterThanOrEqual(view)
      expect(top(faded)).toBeLessThan(view * 0.6)
      // Graphic gone above the heading
      expect(top(end("hero-fade-late") / 100)).toBeGreaterThanOrEqual(
        view * 0.6,
      )
    }
  })

  test("hero graphic is not pre-rasterised", () => {
    const rule = css.match(/\.hero-scroll \.hero-graphic \{([^}]*)\}/)?.[1]
    expect(rule).toContain("animation-name: hero-graphic")
    expect(rule).not.toContain("will-change")
  })
})

describe("focus ring on dark bands", () => {
  test("ink bands switch the ring to highlight", () => {
    const rule = css.match(/\.bg-ink\s+:focus-visible\s*\{([^}]*)\}/)?.[1]
    expect(rule).toContain("outline-color: var(--color-highlight)")
  })

  test("page bands switch the ring too", () => {
    const rule = css.match(/\.bg-band\s+:focus-visible\s*\{([^}]*)\}/)?.[1]
    expect(rule).toContain("outline-color: var(--color-highlight)")
  })
})

function durations(block: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, name, value] of block.matchAll(
    /--((?:dur|step)-[\w-]+):\s*([^;]+);/g,
  )) {
    if (name && value) found.set(name, value.trim())
  }
  return found
}

const ms = (value: string | undefined): number => {
  const match = value?.match(/^([\d.]+)(ms|s)$/)
  if (!match) throw new Error(`not a duration: ${value}`)
  return Number(match[1]) * (match[2] === "s" ? 1000 : 1)
}

describe("motion tokens", () => {
  const defaults = durations(css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "")
  const reduceBlock =
    css.match(
      /prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/,
    )?.[1] ?? ""
  const reduced = durations(reduceBlock)

  test("exits are shorter than entries", () => {
    const exit = ms(defaults.get("dur-exit"))
    expect(exit).toBeLessThan(ms(defaults.get("dur-dialog-in")))
    expect(exit).toBeLessThan(ms(defaults.get("dur-toast-in")))
  })

  test("reduced motion zeroes every duration token", () => {
    expect(defaults.size).toBeGreaterThan(0)
    expect([...reduced.keys()].sort()).toEqual([...defaults.keys()].sort())
    for (const value of reduced.values()) expect(ms(value)).toBe(0)
  })

  test("every motion token used has a default", () => {
    const used = [...css.matchAll(/var\(--((?:dur|step)-[\w-]+)\)/g)].map(
      (m) => m[1],
    )
    expect(used.length).toBeGreaterThan(0)
    for (const name of used) expect(defaults.has(name ?? "")).toBe(true)
  })

  test("transitions default to the tokens", () => {
    expect(css).toContain("--default-transition-duration: var(--dur-hover);")
    expect(css).toContain(
      "--default-transition-timing-function: var(--ease-out);",
    )
  })

  test("stagger delay is capped at five steps", () => {
    expect(css).toContain(
      "transition-delay: calc(min(var(--i, 0), 5) * var(--step-stagger));",
    )
  })
})

// Static class string naming one
const HIDING = /className=(?:"[^"]*|\{[^}]*)\b(?:reveal|stagger)\b/

describe("content visible by default", () => {
  test("no markup ships a hiding motion class", async () => {
    const hits: string[] = []
    const glob = new Bun.Glob("**/*.tsx")
    for await (const file of glob.scan({ cwd: import.meta.dir })) {
      if (file.endsWith(".test.tsx")) continue
      const source = await Bun.file(new URL(file, import.meta.url)).text()
      if (HIDING.test(source)) hits.push(file)
    }
    expect(hits).toEqual([])
  })

  test("view-rise hides only under motion and support", () => {
    const guard =
      "@media screen and (prefers-reduced-motion: no-preference) {\n  @supports (animation-timeline: view()) {"
    const start = css.indexOf(guard)
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf("\n}\n", start))
    const rules = [...css.matchAll(/^\s*\.view-rise[\w-]*[^{]*\{/gm)]
    expect(rules.length).toBe(2)
    for (const rule of rules) expect(block).toContain(rule[0].trim())
  })
})

describe("fonts", () => {
  test("font files are bundled so their names carry a hash", async () => {
    const urls = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((m) => m[1])
    expect(urls.length).toBe(5)
    for (const url of urls) {
      expect(url).toStartWith("./fonts/")
      const file = Bun.file(new URL(url ?? "", import.meta.url))
      expect(await file.exists()).toBe(true)
    }
  })
})
