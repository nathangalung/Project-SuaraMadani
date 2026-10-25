/** styles.css :root, unprefixed names. */
export const THEME_DEFAULTS: Readonly<Record<string, string>> = {
  surface: "#fff8e5",
  "surface-raised": "#ffffff",
  ink: "#08266e",
  "ink-muted": "#4a5578",
  "ink-soft": "#2c3a66",
  "ink-hover": "#0a2c86",
  accent: "#0f55d6",
  "accent-hover": "#0b44ab",
  "accent-soft": "#dde9ff",
  "on-accent": "#ffffff",
  brand: "#0f55d6",
  "brand-hover": "#0b44ab",
  "brand-soft": "#eef4fd",
  pop: "#0f55d6",
  "pop-strong": "#6b3fb8",
  chip: "#d5d9e4",
  mint: "#9cf0e1",
  "mint-soft": "#e6fbf6",
  line: "#6c7591",
  "line-subtle": "#d5d9e4",
  danger: "#c0141f",
  "danger-soft": "#fde3e5",
  "danger-ink": "#970f18",
  success: "#17784a",
  "success-soft": "#bff3cf",
  "success-ink": "#094e2c",
  highlight: "#ffe030",
  focus: "#0f55d6",
  "header-bg": "#ffffff",
  "hero-bg": "linear-gradient(180deg, #ffffff 0%, #dde9ff 100%)",
  "band-bg": "linear-gradient(180deg, #0f55d6 0%, #0f55d6 34%, #08266e 100%)",
  "page-bg": "#fff8e5",
  "home-list-bg": "#fff8e5",
  "footer-bg": "#ffffff",
  "detail-bg": "linear-gradient(180deg, #ffffff 0%, #dde9ff 100%)",
}

// Settings form order, camelCase
export const THEME_GROUPS = {
  main: [
    "brand",
    "brandHover",
    "accent",
    "accentHover",
    "pop",
    "popStrong",
    "highlight",
    "focus",
  ],
  text: [
    "ink",
    "inkMuted",
    "inkSoft",
    "inkHover",
    "onAccent",
    "surface",
    "surfaceRaised",
    "line",
    "lineSubtle",
    "chip",
  ],
  status: [
    "accentSoft",
    "brandSoft",
    "mint",
    "mintSoft",
    "danger",
    "dangerSoft",
    "dangerInk",
    "success",
    "successSoft",
    "successInk",
  ],
  background: [
    "headerBg",
    "heroBg",
    "bandBg",
    "pageBg",
    "homeListBg",
    "footerBg",
    "detailBg",
  ],
  font: ["fontBody", "fontHeading", "fontUi"],
} as const

type ThemeGroup = keyof typeof THEME_GROUPS
export type ThemeField = (typeof THEME_GROUPS)[ThemeGroup][number]

const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

// theme.server.ts holds fallbacks
export const FONT_CHOICES = [
  SYSTEM_FONT,
  "Aleo, Georgia, serif",
  '"Tilt Warp", system-ui, sans-serif',
  "Barlow, system-ui, sans-serif",
] as const

export const kebabToken = (token: string): string =>
  token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
