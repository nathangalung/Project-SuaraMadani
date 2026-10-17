import type { OrgTheme } from "../../../db/schema/organizations.ts"
import { isThemeValue } from "../../../server/theme.server.ts"
import {
  type ContrastFailure,
  checkTheme,
} from "../../../shared/theme-contrast.ts"
import {
  defaultFor,
  THEME_GROUPS,
  type ThemeField,
} from "../../../shared/theme-defaults.ts"

const THEME_FIELDS: readonly ThemeField[] = Object.values(THEME_GROUPS).flat()

export type ThemeFormResult = {
  theme: OrgTheme
  // Raw input, shown back
  values: Partial<Record<ThemeField, string>>
  invalid: ThemeField[]
  failures: ContrastFailure[]
  changed: ThemeField[]
}

// Formatter-proof comparison
const flat = (value: string) => value.replace(/\s+/g, " ").trim()

function normalize(token: ThemeField, value: string): string {
  const trimmed = flat(value)
  return token.startsWith("font") ? trimmed : trimmed.toLowerCase()
}

/** Grammar first, then contrast. */
export function parseThemeForm(
  fields: Readonly<Record<string, unknown>>,
  current: OrgTheme,
): ThemeFormResult {
  const theme: OrgTheme = current.brandAssets
    ? { brandAssets: current.brandAssets }
    : {}
  const values: ThemeFormResult["values"] = {}
  const invalid: ThemeField[] = []
  for (const token of THEME_FIELDS) {
    const raw = fields[token]
    if (typeof raw !== "string" || raw.trim() === "") continue
    const value = normalize(token, raw)
    values[token] = value
    if (!isThemeValue(token, value)) {
      invalid.push(token)
      continue
    }
    // Defaults follow future releases
    if (value !== normalize(token, defaultFor(token))) theme[token] = value
  }
  const changed = THEME_FIELDS.filter(
    (token) => theme[token] !== current[token],
  )
  return {
    theme,
    values,
    invalid,
    failures: invalid.length > 0 ? [] : checkTheme(theme),
    changed,
  }
}
