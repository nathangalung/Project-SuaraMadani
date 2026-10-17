import { kebabToken, THEME_DEFAULTS } from "./theme-defaults.ts"

// Token names, no --theme- prefix
export type Pair = readonly [fg: string, bg: string]

/** Text pairs, 4.5:1 or better. */
export const TEXT_PAIRS: readonly Pair[] = [
  ["ink", "surface"],
  ["ink", "surface-raised"],
  ["ink-muted", "surface"],
  ["ink-muted", "surface-raised"],
  ["ink-soft", "surface"],
  ["ink-soft", "surface-raised"],
  ["accent", "surface"],
  ["accent", "surface-raised"],
  ["accent", "accent-soft"],
  ["accent", "brand-soft"],
  ["on-accent", "accent"],
  ["on-accent", "accent-hover"],
  ["on-accent", "brand"],
  ["on-accent", "brand-hover"],
  ["on-accent", "pop-strong"],
  ["danger", "surface"],
  ["danger", "surface-raised"],
  ["on-accent", "danger"],
  // Danger button hover
  ["on-accent", "ink"],
  ["danger-ink", "danger-soft"],
  ["success", "surface"],
  ["on-accent", "success"],
  ["success-ink", "success-soft"],
  ["surface", "ink"],
  ["surface-raised", "ink"],
  ["surface-raised", "ink-hover"],
  ["highlight", "ink"],
  ["ink", "highlight"],
  ["ink", "line-subtle"],
  ["ink", "chip"],
  ["ink", "accent-soft"],
  ["ink", "brand-soft"],
  ["ink", "mint-soft"],
  ["ink", "success-soft"],
]

/** Large text only, 3:1. */
export const LARGE_TEXT_PAIRS: readonly Pair[] = [
  ["on-accent", "pop"],
  ["brand", "surface"],
]

/** Component edges and rings, 3:1. */
export const UI_PAIRS: readonly Pair[] = [
  ["line", "surface"],
  ["line", "surface-raised"],
  ["focus", "surface"],
  ["focus", "surface-raised"],
  // Error summary links
  ["focus", "danger-soft"],
  // Copy button on success box
  ["focus", "highlight"],
  // Ring colour inside ink bands
  ["highlight", "ink"],
  ["mint", "ink"],
]

/** Text token on every stop. */
export const BACKGROUND_TEXT: readonly Pair[] = [
  ["ink", "header-bg"],
  // Accent links on gradients
  ["accent", "header-bg"],
  ["accent", "footer-bg"],
  ["accent", "home-list-bg"],
  ["accent", "page-bg"],
  ["ink", "hero-bg"],
  ["ink", "page-bg"],
  ["ink", "home-list-bg"],
  ["ink", "footer-bg"],
  ["ink", "detail-bg"],
  ["ink-muted", "page-bg"],
  ["ink-muted", "detail-bg"],
  // Issue meta, timeline bodies
  ["ink-soft", "page-bg"],
  ["ink-soft", "detail-bg"],
  ["on-accent", "band-bg"],
]

/** Ring token, every stop, 3:1. */
export const BACKGROUND_UI: readonly Pair[] = [
  ["focus", "header-bg"],
  ["focus", "hero-bg"],
  ["focus", "page-bg"],
  ["focus", "home-list-bg"],
  ["focus", "footer-bg"],
  ["focus", "detail-bg"],
  ["highlight", "band-bg"],
]

/** Stops a ring sits on. */
export function ringStops(bg: string, background: string): string[] {
  const all = stops(background)
  // Mask hides the hero tail
  return bg === "hero-bg" && all.length > 1 ? all.slice(0, -1) : all
}

/** First :root block's --theme-* values. */
export function rootDefaults(css: string): Map<string, string> {
  const block = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ""
  return declarations(block)
}

/** All --theme-* declarations, unprefixed. */
export function declarations(css: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const [, name, value] of css.matchAll(/--theme-([\w-]+):\s*([^;}]+)/g)) {
    if (name && value) vars.set(name, value.trim())
  }
  return vars
}

/** Hex colour stops, transparent skipped. */
export function stops(background: string): string[] {
  return background.match(/#[0-9a-fA-F]{6}\b/g) ?? []
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const [r = 0, g = 0, b = 0] = channels
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

export type ContrastFailure = {
  fg: string
  bg: string
  // Failing background stop
  stop: string
  ratio: number
  min: number
}

/** CI pairs, tenant over defaults. */
export function checkTheme(
  theme: Readonly<Record<string, unknown>>,
): ContrastFailure[] {
  const merged = new Map(Object.entries(THEME_DEFAULTS))
  for (const [token, value] of Object.entries(theme)) {
    if (typeof value === "string") merged.set(kebabToken(token), value)
  }
  const value = (name: string) => merged.get(name) ?? ""
  const failures: ContrastFailure[] = []
  const check = (fg: string, bg: string, bgStops: string[], min: number) => {
    const colour = value(fg)
    for (const stop of bgStops) {
      const ratio = contrast(colour, stop)
      if (ratio < min) {
        failures.push({
          fg,
          bg,
          stop,
          ratio: Math.floor(ratio * 100) / 100,
          min,
        })
      }
    }
  }
  for (const [fg, bg] of TEXT_PAIRS) check(fg, bg, [value(bg)], 4.5)
  for (const [fg, bg] of LARGE_TEXT_PAIRS) check(fg, bg, [value(bg)], 3)
  for (const [fg, bg] of UI_PAIRS) check(fg, bg, [value(bg)], 3)
  for (const [fg, bg] of BACKGROUND_TEXT) check(fg, bg, stops(value(bg)), 4.5)
  for (const [fg, bg] of BACKGROUND_UI) {
    check(fg, bg, ringStops(bg, value(bg)), 3)
  }
  return failures
}
