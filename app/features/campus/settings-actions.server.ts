import { data, type RouterContextProvider } from "react-router"
import { forgetTenant } from "../../../db/tenant.server.ts"
import {
  type IdentityField,
  parseIdentityForm,
} from "../../../shared/campus.ts"
import type { ContrastFailure } from "../../../shared/theme-contrast.ts"
import type { ThemeField } from "../../../shared/theme-defaults.ts"
import { requireAdmin } from "../moderation/access.server.ts"
import { requireFresh } from "../moderation/step-up.server.ts"
import {
  readSettings,
  removeLogo,
  saveIdentity,
  saveLogo,
  saveTheme,
  setIntakePause,
} from "./settings.server.ts"
import { parseThemeForm } from "./theme-form.server.ts"

export type SettingsSaved =
  | "intake"
  | "logo"
  | "logo_removed"
  | "theme"
  | "identity"

export type SettingsActionData =
  | { saved: SettingsSaved }
  | {
      error: "identity"
      fields: IdentityField[]
      values: Record<string, string>
    }
  | { error: "status_url" | "logo" | "intake_choice"; statusUrl?: string }
  | {
      error: "theme"
      values: Partial<Record<ThemeField, string>>
      invalid: ThemeField[]
      failures: ContrastFailure[]
    }

/** Forms for intake, logo, theme. */
export async function settingsAction({
  request,
  context,
}: {
  request: Request
  context: Readonly<RouterContextProvider>
}): Promise<SettingsActionData> {
  const { tenant, session } = await requireAdmin(context)
  await requireFresh(context, request)
  const actor = { tenant, actorId: session.user.id }
  const form = await request.formData()
  const intent = form.get("intent")
  const done = (saved: SettingsSaved): SettingsActionData => {
    // This process shows it now
    forgetTenant(tenant.host)
    return { saved }
  }
  const refuse = (result: { ok: false; reason: string }) => {
    if (result.reason === "forbidden") throw data(null, { status: 403 })
  }

  if (intent === "intake") {
    const choice = form.get("intake")
    const statusUrl = String(form.get("statusUrl") ?? "")
    if (choice !== "open" && choice !== "paused") {
      return { error: "intake_choice", statusUrl }
    }
    const result = await setIntakePause({
      ...actor,
      paused: choice === "paused",
      statusUrl,
    })
    if (result.ok) return done("intake")
    refuse(result)
    return { error: "status_url", statusUrl }
  }

  if (intent === "logo") {
    const file = form.get("logo")
    if (!(file instanceof File) || file.size === 0) return { error: "logo" }
    const result = await saveLogo({
      ...actor,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
    if (result.ok) return done("logo")
    refuse(result)
    return { error: "logo" }
  }

  if (intent === "logo_remove") {
    const result = await removeLogo(actor)
    if (!result.ok) refuse(result)
    return done("logo_removed")
  }

  if (intent === "identity") {
    const values = Object.fromEntries(
      [...form.entries()].filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    )
    const parsed = parseIdentityForm(values)
    if (!parsed.ok) return { error: "identity", fields: parsed.errors, values }
    const result = await saveIdentity({ ...actor, identity: parsed.value })
    if (!result.ok) refuse(result)
    return done("identity")
  }

  if (intent === "theme") {
    const current = await readSettings(tenant.id)
    const fields = Object.fromEntries(
      [...form.entries()].filter(([, value]) => typeof value === "string"),
    )
    const parsed = parseThemeForm(fields, current.theme)
    if (parsed.invalid.length > 0 || parsed.failures.length > 0) {
      return {
        error: "theme",
        values: parsed.values,
        invalid: parsed.invalid,
        failures: parsed.failures,
      }
    }
    const result = await saveTheme({
      ...actor,
      theme: parsed.theme,
      changed: parsed.changed,
    })
    if (!result.ok) refuse(result)
    return done("theme")
  }
  throw data(null, { status: 400 })
}
