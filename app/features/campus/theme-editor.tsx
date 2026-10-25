import { CircleCheck, Palette } from "lucide-react"
import { type CSSProperties, useState } from "react"
import { Form } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { TextInput } from "~/components/ui/field"
import { Select } from "~/components/ui/select"
import { useSubmitting } from "~/features/moderation/submitting"
import { m } from "~/paraglide/messages.js"
import type { ContrastFailure } from "../../../shared/theme-contrast.ts"
import {
  defaultFor,
  FONT_CHOICES,
  kebabToken,
  SYSTEM_FONT,
  THEME_GROUPS,
  type ThemeField,
  type ThemeGroup,
} from "../../../shared/theme-defaults.ts"
import { TOKEN_TEXT } from "./theme-labels"

type Text = () => string

const GROUP_TEXT: Record<ThemeGroup, Text> = {
  main: m.theme_group_main,
  text: m.theme_group_text,
  status: m.theme_group_status,
  background: m.theme_group_background,
  font: m.theme_group_font,
}

const FONT_TEXT: Record<(typeof FONT_CHOICES)[number], Text> = {
  [SYSTEM_FONT]: m.theme_font_system,
  "Aleo, Georgia, serif": () => "Aleo",
  '"Tilt Warp", system-ui, sans-serif': () => "Tilt Warp",
  "Barlow, system-ui, sans-serif": () => "Barlow",
}

const HEX = /^#[0-9a-fA-F]{6}$/
// Preview only, server validates
const CSS_VALUE = /^[a-z0-9#%(),. "-]+$/i

const camel = (kebab: string) =>
  kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

/** Readable CI pair token name. */
function tokenName(kebab: string): string {
  const token = camel(kebab) as ThemeField
  return Object.hasOwn(TOKEN_TEXT, token) ? TOKEN_TEXT[token]() : kebab
}

// 4,5 and 3,21 style ratios
const RATIO = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 })
const ratio = (value: number) => RATIO.format(value)

function failureText(failure: ContrastFailure): string {
  return m.theme_failure({
    fg: tokenName(failure.fg),
    bg: tokenName(failure.bg),
    ratio: ratio(failure.ratio),
    min: ratio(failure.min),
    stop: failure.stop,
  })
}

function previewStyle(values: Record<string, string>): CSSProperties {
  const style: Record<string, string> = {}
  for (const [token, value] of Object.entries(values)) {
    const ok = token.startsWith("font")
      ? (FONT_CHOICES as readonly string[]).includes(value)
      : token.endsWith("Bg")
        ? CSS_VALUE.test(value) && !/url/i.test(value)
        : HEX.test(value)
    if (ok) style[`--theme-${kebabToken(token)}`] = value
  }
  return style as CSSProperties
}

/** Typed value, else default. */
function swatch(token: ThemeField, value: string | undefined): string {
  const usable = token.endsWith("Bg")
    ? value && CSS_VALUE.test(value) && !/url/i.test(value)
    : value && HEX.test(value)
  return usable && value ? value : defaultFor(token)
}

/** Scoped variables, live without saving. */
function ThemePreview({ values }: { values: Record<string, string> }) {
  return (
    <div
      style={previewStyle(values)}
      className="overflow-hidden border border-line-subtle bg-surface font-body text-ink transition-colors"
      aria-label={m.theme_preview_label()}
      role="img"
    >
      <div className="header-bg flex items-center gap-2 border-line-subtle border-b px-4 py-3">
        <span className="grid size-7 place-items-center bg-brand text-on-accent">
          <Palette aria-hidden="true" className="size-4" />
        </span>
        <span className="font-bold font-heading">{m.theme_preview_site()}</span>
      </div>
      <div className="bg-page p-4">
        <p className="font-bold font-heading text-xl">
          {m.theme_preview_heading()}
        </p>
        <p className="mt-1 text-ink-soft text-sm">{m.theme_preview_body()}</p>
        <p className="mt-1 text-ink-muted text-xs">{m.theme_preview_meta()}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-[10px] bg-brand px-4 py-2 font-heading text-on-accent text-sm">
            {m.theme_preview_button()}
          </span>
          <span className="font-semibold text-accent text-sm underline underline-offset-4">
            {m.theme_preview_link()}
          </span>
        </div>
        <div className="mt-3 border border-line-subtle bg-surface-raised p-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="soft">{m.theme_preview_badge()}</Badge>
            <Badge tone="success">
              <CircleCheck aria-hidden="true" className="size-3.5" />
              {m.theme_preview_done()}
            </Badge>
          </div>
          <div className="mt-3 h-9 border-2 border-line bg-surface-raised" />
        </div>
      </div>
      <div className="bg-band px-4 py-3 font-heading text-on-accent text-sm">
        {m.theme_preview_band()}
      </div>
    </div>
  )
}

export type ThemeEditorProps = {
  current: Partial<Record<ThemeField, string>>
  // Failed submit wins over saved
  submitted?: Partial<Record<ThemeField, string>>
  invalid: ThemeField[]
  failures: ContrastFailure[]
}

export function ThemeEditor({
  current,
  submitted,
  invalid,
  failures,
}: ThemeEditorProps) {
  const initial = submitted ?? current
  const [values, setValues] = useState<Record<string, string>>(
    () => ({ ...initial }) as Record<string, string>,
  )
  const pending = useSubmitting("theme")
  const update = (token: ThemeField, value: string) =>
    setValues((all) => ({ ...all, [token]: value.trim() }))
  return (
    <Form method="post" className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <input type="hidden" name="intent" value="theme" />
      <div className="flex min-w-0 flex-col gap-8">
        {failures.length > 0 ? (
          <div id="theme-contrast" className="text-danger text-sm">
            <p className="font-bold">{m.theme_failures_title()}</p>
            <ul className="mt-2 list-disc pl-5">
              {failures.map((failure) => (
                <li key={`${failure.fg}-${failure.bg}-${failure.stop}`}>
                  {failureText(failure)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {(Object.keys(THEME_GROUPS) as ThemeGroup[]).map((group) => (
          <fieldset key={group} className="min-w-0">
            <legend className="mb-3 font-bold text-xl">
              {GROUP_TEXT[group]()}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {THEME_GROUPS[group].map((token) =>
                group === "font" ? (
                  <Select
                    key={token}
                    id={`theme-${token}`}
                    name={token}
                    label={TOKEN_TEXT[token]()}
                    defaultValue={initial[token] ?? SYSTEM_FONT}
                    error={
                      invalid.includes(token) ? m.theme_error_font() : undefined
                    }
                    onChange={(event) => update(token, event.target.value)}
                  >
                    {FONT_CHOICES.map((stack) => (
                      <option key={stack} value={stack}>
                        {FONT_TEXT[stack]()}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    key={token}
                    id={`theme-${token}`}
                    name={token}
                    label={TOKEN_TEXT[token]()}
                    defaultValue={initial[token] ?? ""}
                    placeholder={defaultFor(token)}
                    spellCheck={false}
                    autoComplete="off"
                    pattern={
                      group === "background" ? undefined : "#[0-9a-fA-F]{6}"
                    }
                    error={
                      invalid.includes(token)
                        ? group === "background"
                          ? m.theme_error_background()
                          : m.theme_error_colour()
                        : undefined
                    }
                    aside={
                      <span
                        aria-hidden="true"
                        className="size-6 shrink-0 border border-line"
                        style={{ background: swatch(token, values[token]) }}
                      />
                    }
                    onChange={(event) => update(token, event.target.value)}
                  />
                ),
              )}
            </div>
            {group === "background" ? (
              <p className="mt-3 text-ink-muted text-sm">
                {m.theme_background_hint()}
              </p>
            ) : null}
          </fieldset>
        ))}
        <div>
          <Button type="submit" pending={pending}>
            {m.theme_submit()}
          </Button>
        </div>
      </div>
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <p className="mb-2 font-bold">{m.theme_preview_title()}</p>
        <ThemePreview values={values} />
        <p className="mt-3 text-ink-muted text-sm">{m.theme_preview_hint()}</p>
      </aside>
    </Form>
  )
}
