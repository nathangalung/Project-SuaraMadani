import { data, type RouterContextProvider } from "react-router"
import { forgetTenant } from "../../../db/tenant.server.ts"
import { requireAdmin } from "../moderation/access.server.ts"
import { requireFresh } from "../moderation/step-up.server.ts"
import { setIntakePause } from "./settings.server.ts"

export type SettingsSaved = "intake"

export type SettingsActionData =
  | { saved: SettingsSaved }
  | { error: "status_url" | "intake_choice"; statusUrl?: string }

/** Intake form only. */
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

  throw data(null, { status: 400 })
}
