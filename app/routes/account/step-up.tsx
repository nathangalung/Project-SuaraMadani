import { Form, redirect } from "react-router"
import { AUTH_TITLE, AuthCard } from "~/components/layout/auth-card"
import { Button } from "~/components/ui/button"
import { ErrorSummary } from "~/components/ui/error-summary"
import { TextInput } from "~/components/ui/field"
import { stepUpAction } from "~/features/moderation/step-up.server"
import { useSubmitting } from "~/features/moderation/submitting"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { sessionContext } from "../../context.ts"
import type { Route } from "./+types/step-up"

// Logo-only header, task focus
export const handle = { shell: "auth" }

export function headers() {
  return { "Cache-Control": "private, no-store" }
}

const CODE_ID = "stepup-code"

function requireSession(context: Route.LoaderArgs["context"]) {
  const session = context.get(sessionContext)
  if (!session) throw redirect("/masuk")
  if (!session.user.twoFactorEnabled) throw redirect("/masuk/dua-langkah")
  return session
}

export function loader({ context }: Route.LoaderArgs) {
  requireSession(context)
  return null
}

export function action({ request, context }: Route.ActionArgs) {
  requireSession(context)
  return stepUpAction(request, context)
}

export default function StepUp({ actionData }: Route.ComponentProps) {
  const busy = useSubmitting()
  const error = actionData?.error
  const message =
    error === "format"
      ? m.error_totp_format()
      : error === "wrong"
        ? m.error_stepup_wrong()
        : undefined
  return (
    <AuthCard>
      <title>{useSiteTitle(m.stepup_title())}</title>
      {message ? (
        <ErrorSummary errors={[{ fieldId: CODE_ID, message }]} />
      ) : null}
      <h1 className={AUTH_TITLE}>{m.stepup_title()}</h1>
      <p className="mt-3 text-ink-soft leading-relaxed">{m.stepup_lead()}</p>
      <Form method="post" noValidate className="mt-8 flex flex-col gap-6">
        <TextInput
          id={CODE_ID}
          name="code"
          label={m.twofactor_code_label()}
          hint={m.twofactor_code_hint()}
          error={message}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
        />
        <Button
          type="submit"
          className="w-full"
          pending={busy}
          pendingLabel={m.code_checking()}
        >
          {m.stepup_submit()}
        </Button>
      </Form>
    </AuthCard>
  )
}
