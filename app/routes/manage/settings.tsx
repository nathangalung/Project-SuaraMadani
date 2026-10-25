import { ErrorSummary, errorTitle } from "~/components/ui/error-summary"
import { Note } from "~/components/ui/note"
import { readSettings } from "~/features/campus/settings.server"
import {
  type SettingsSaved,
  settingsAction,
} from "~/features/campus/settings-actions.server"
import { IntakeForm } from "~/features/campus/settings-forms"
import { requireAdmin } from "~/features/moderation/access.server"
import { requireFresh } from "~/features/moderation/step-up.server"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import type { Route } from "./+types/settings"

export async function loader({ context, request }: Route.LoaderArgs) {
  const { tenant } = await requireAdmin(context)
  // Window starts at page load
  await requireFresh(context, request)
  const settings = await readSettings(tenant.id)
  return {
    ...settings,
    campus: tenant.campusName,
  }
}

export const action = settingsAction

const SAVED: Record<SettingsSaved, () => string> = {
  intake: m.settings_saved_intake,
}

const H2 = "mb-2 font-bold text-2xl"

export default function Settings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const title = m.settings_title()
  const pageTitle = useSiteTitle(title)
  const failed = actionData && "error" in actionData ? actionData : null
  const errors = [
    ...(failed?.error === "intake_choice"
      ? [{ fieldId: "intake-choice", message: m.settings_error_choice() }]
      : []),
    ...(failed?.error === "status_url"
      ? [{ fieldId: "intake-status", message: m.settings_error_status_url() }]
      : []),
  ]
  const saved = actionData && "saved" in actionData ? actionData.saved : null
  return (
    <div>
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <ErrorSummary errors={errors} attempt={actionData} />
      {saved ? (
        <div role="status" className="confirm-in mb-8">
          <Note tone="success">{SAVED[saved]()}</Note>
        </div>
      ) : null}
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 text-ink-muted">
        {m.settings_lead({ campus: loaderData.campus })}
      </p>

      <section aria-labelledby="penerimaan-laporan" className="mt-10">
        <h2 id="penerimaan-laporan" className={H2}>
          {m.settings_intake_title()}
        </h2>
        <p className="mb-4 text-ink-muted">{m.settings_intake_lead()}</p>
        {loaderData.globalPause ? (
          <Note tone="info" className="mb-4">
            {m.settings_intake_global()}
          </Note>
        ) : null}
        <IntakeForm
          paused={loaderData.intakePaused}
          statusUrl={
            failed && "statusUrl" in failed
              ? (failed.statusUrl ?? "")
              : (loaderData.statusUrl ?? "")
          }
          errors={{
            choice: errors.find((e) => e.fieldId === "intake-choice")?.message,
            statusUrl: errors.find((e) => e.fieldId === "intake-status")
              ?.message,
          }}
        />
      </section>
    </div>
  )
}
