import type { BrandAssets, ThemeToken } from "../db/schema/organizations.ts"

const HEX = /^#[0-9a-fA-F]{6}$/
const LINEAR =
  /^linear-gradient\(\d{1,3}deg(, (#[0-9a-fA-F]{6}|transparent) \d{1,3}%){2,4}\)$/
const RADIAL =
  /^radial-gradient\(\d{1,3}% \d{1,3}% at \d{1,3}% \d{1,3}%, #[0-9a-fA-F]{6} \d{1,3}%, transparent \d{1,3}%\)$/
const MAX_LAYERS = 5

export type WebFont = "tilt-warp" | "aleo" | "barlow"

type Stack = { font: WebFont | null; css: string }

// Fallback faces live in styles.css
const FONT_STACKS = new Map<string, Stack>([
  [
    "Aleo, Georgia, serif",
    { font: "aleo", css: 'Aleo, "Aleo Fallback", Georgia, serif' },
  ],
  [
    '"Tilt Warp", system-ui, sans-serif',
    {
      font: "tilt-warp",
      css: '"Tilt Warp", "Tilt Warp Fallback", system-ui, sans-serif',
    },
  ],
  [
    "Barlow, system-ui, sans-serif",
    {
      font: "barlow",
      css: 'Barlow, "Barlow Fallback", system-ui, sans-serif',
    },
  ],
  [
    'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    {
      font: null,
      css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    },
  ],
])

// Value, or null to drop
type Emit = (value: string) => string | null
const color: Emit = (value) => (HEX.test(value) ? value : null)
const font: Emit = (value) => FONT_STACKS.get(value)?.css ?? null

// Split on top-level commas only
function layers(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === "(") depth++
    else if (c === ")") depth--
    else if (c === "," && depth === 0) {
      parts.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts
}

// Gradient layers, hex only last
const background: Emit = (value) => {
  const parts = layers(value)
  if (parts.length > MAX_LAYERS) return null
  const ok = parts.every(
    (part, i) =>
      LINEAR.test(part) ||
      RADIAL.test(part) ||
      (i === parts.length - 1 && HEX.test(part)),
  )
  return ok ? value : null
}

// Token order is output order
const TOKENS: Record<ThemeToken, Emit> = {
  surface: color,
  surfaceRaised: color,
  ink: color,
  inkMuted: color,
  inkSoft: color,
  inkHover: color,
  accent: color,
  accentHover: color,
  accentSoft: color,
  onAccent: color,
  brand: color,
  brandHover: color,
  brandSoft: color,
  pop: color,
  popStrong: color,
  chip: color,
  mint: color,
  mintSoft: color,
  line: color,
  lineSubtle: color,
  danger: color,
  dangerSoft: color,
  dangerInk: color,
  success: color,
  successSoft: color,
  successInk: color,
  highlight: color,
  focus: color,
  headerBg: background,
  heroBg: background,
  bandBg: background,
  pageBg: background,
  homeListBg: background,
  footerBg: background,
  detailBg: background,
  fontBody: font,
  fontHeading: font,
  fontUi: font,
}

export const THEME_TOKENS = Object.keys(TOKENS) as ThemeToken[]

/** Same grammar as themeStyle. */
export function isThemeValue(token: ThemeToken, value: string): boolean {
  return TOKENS[token](value) !== null
}

function cssName(token: string): string {
  return `--theme-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

// styles.css default --theme-ink
const DEFAULT_INK = "#08266e"

function token(theme: unknown, name: ThemeToken | "brandAssets"): unknown {
  return theme && typeof theme === "object" && !Array.isArray(theme)
    ? (theme as Record<string, unknown>)[name]
    : undefined
}

/** Browser bar matches the ink. */
export function themeColor(theme: unknown): string {
  const ink = token(theme, "ink")
  return typeof ink === "string" && HEX.test(ink) ? ink : DEFAULT_INK
}

/** Known ornament set, else none. */
export function brandAssets(theme: unknown): BrandAssets | null {
  return token(theme, "brandAssets") === "km-itb" ? "km-itb" : null
}

/** Webfont worth preloading, if any. */
export function headingFont(theme: unknown): WebFont | null {
  const stack = token(theme, "fontHeading")
  return typeof stack === "string"
    ? (FONT_STACKS.get(stack)?.font ?? null)
    : null
}

/** Safe tenant CSS, drops unknowns. */
export function themeStyle(theme: unknown): string {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) return ""
  const values = theme as Record<string, unknown>
  const declarations = Object.entries(TOKENS).flatMap(([token, emit]) => {
    const value = values[token]
    const css = typeof value === "string" ? emit(value) : null
    return css === null ? [] : [`${cssName(token)}:${css}`]
  })
  return declarations.length ? `:root{${declarations.join(";")}}` : ""
}
