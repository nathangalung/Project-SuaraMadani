import { brandImages } from "~/components/layout/brand-assets"
import { ErrorSummary, errorTitle } from "~/components/ui/error-summary"
import { Note } from "~/components/ui/note"
import { readSettings } from "~/features/campus/settings.server"
import {
  type SettingsSaved,
  settingsAction,
} from "~/features/campus/settings-actions.server"
import {
  IdentityForm,
  IntakeForm,
  identityErrors,
  LogoForm,
} from "~/features/campus/settings-forms"
import { ThemeEditor } from "~/features/campus/theme-editor"
import { TOKEN_TEXT } from "~/features/campus/theme-labels"
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
  logo: m.settings_saved_logo,
  logo_removed: m.settings_saved_logo_removed,
  theme: m.settings_saved_theme,
  identity: m.settings_saved_identity,
}

const H2 = "mb-2 font-bold text-2xl"

export default function Settings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const title = m.settings_title()
  const pageTitle = useSiteTitle(title)
  const failed = actionData && "error" in actionData ? actionData : null
  const theme = failed?.error === "theme" ? failed : null
  const errors = [
    ...(failed?.error === "intake_choice"
      ? [{ fieldId: "intake-choice", message: m.settings_error_choice() }]
      : []),
    ...(failed?.error === "status_url"
      ? [{ fieldId: "intake-status", message: m.settings_error_status_url() }]
      : []),
    ...(failed?.error === "logo"
      ? [{ fieldId: "logo-file", message: m.settings_error_logo() }]
      : []),
    ...(failed?.error === "identity" ? identityErrors(failed.fields) : []),
    ...(theme?.invalid ?? []).map((token) => ({
      fieldId: `theme-${token}`,
      message: m.settings_error_token({ name: TOKEN_TEXT[token]() }),
    })),
    ...(theme && theme.failures.length > 0
      ? [{ fieldId: "theme-contrast", message: m.settings_error_contrast() }]
      : []),
  ]
  const saved = actionData && "saved" in actionData ? actionData.saved : null
  const { theme: current, identity } = loaderData
  const defaultLogo = brandImages(
    current.brandAssets === "km-itb" ? "km-itb" : null,
  ).logoSrc
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
      <p className="mt-2 max-w-3xl text-ink-muted">
        {m.settings_lead({ campus: loaderData.campus })}
      </p>

      <section aria-labelledby="penerimaan-laporan" className="mt-10 max-w-2xl">
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

      <section
        aria-labelledby="identitas-pengelola"
        className="mt-12 max-w-2xl"
      >
        <h2 id="identitas-pengelola" className={H2}>
          {m.settings_identity_title()}
        </h2>
        <p className="mb-4 text-ink-muted">{m.settings_identity_lead()}</p>
        <IdentityForm
          key={saved === "identity" ? "saved" : "identity"}
          values={
            failed?.error === "identity"
              ? {
                  name: failed.values.name ?? "",
                  campusName: failed.values.campusName ?? "",
                  contactEmail: failed.values.contactEmail ?? "",
                  alliance: failed.values.alliance ?? "",
                  legalNumber: failed.values.legalNumber ?? "",
                  credit: failed.values.credit ?? "",
                  officers: failed.values.officers ?? "",
                }
              : {
                  name: identity.name,
                  campusName: identity.campusName,
                  contactEmail: identity.contactEmail ?? "",
                  alliance: identity.alliance ?? "",
                  legalNumber: identity.legalNumber ?? "",
                  credit: identity.credit ?? "",
                  officers: identity.officers.join("\n"),
                }
          }
          invalid={failed?.error === "identity" ? failed.fields : []}
        />
      </section>

      <section aria-labelledby="logo-kampus" className="mt-12 max-w-2xl">
        <h2 id="logo-kampus" className={H2}>
          {m.settings_logo_title()}
        </h2>
        <p className="mb-4 text-ink-muted">{m.settings_logo_lead()}</p>
        <LogoForm
          logoSrc={
            loaderData.logoFile ? `/logo/${loaderData.logoFile}` : defaultLogo
          }
          custom={loaderData.logoFile !== null}
          error={errors.find((e) => e.fieldId === "logo-file")?.message}
        />
      </section>

      <section aria-labelledby="tema-kampus" className="mt-12">
        <h2 id="tema-kampus" className={H2}>
          {m.settings_theme_title()}
        </h2>
        <p className="mb-6 max-w-3xl text-ink-muted">
          {m.settings_theme_lead()}
        </p>
        <ThemeEditor
          key={saved === "theme" ? "saved" : "theme"}
          current={current}
          submitted={theme?.values}
          invalid={theme?.invalid ?? []}
          failures={theme?.failures ?? []}
        />
      </section>
    </div>
  )
}
