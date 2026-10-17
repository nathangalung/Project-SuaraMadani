import { useEffect } from "react"
import { useRevalidator } from "react-router"
import { ErrorSummary, errorTitle } from "~/components/ui/error-summary"
import { Note } from "~/components/ui/note"
import { requireSuperadmin } from "~/features/campus/campuses.server"
import { requireFresh } from "~/features/moderation/step-up.server"
import { useSiteTitle } from "~/features/report/page-title"
import {
  isSenderIntent,
  readSender,
  requestSender,
} from "~/features/whatsapp/admin.server"
import {
  FixedProviderNote,
  LinkForms,
  LinkingStep,
  SenderState,
  UnlinkForm,
  WA_PHONE_ID,
} from "~/features/whatsapp/sender-panel"
import { m } from "~/paraglide/messages.js"
import type { Route } from "./+types/whatsapp"

// Linking changes within seconds
const REFRESH_MS = 3000

export async function loader({ context }: Route.LoaderArgs) {
  requireSuperadmin(context)
  return { view: await readSender(new Date()) }
}

export async function action({ request, context }: Route.ActionArgs) {
  const { session } = requireSuperadmin(context)
  await requireFresh(context, request)
  const form = await request.formData()
  const intent = form.get("intent")
  if (!isSenderIntent(intent)) return { error: null }
  const result = await requestSender({
    intent,
    phone: String(form.get("phone") ?? ""),
    actorId: session.user.id,
  })
  return { error: result.ok ? null : result.error }
}

export default function WhatsAppSender({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { view } = loaderData
  const title = useSiteTitle(m.wa_title())
  const revalidator = useRevalidator()
  const waiting = view.pending || view.status === "linking"
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate()
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [waiting, revalidator])
  const errors =
    actionData?.error === "phone"
      ? [{ fieldId: WA_PHONE_ID, message: m.error_wa_phone() }]
      : []
  const fixed = view.provider !== null && view.provider !== "baileys"
  return (
    <div className="flex flex-col gap-10">
      <title>{errorTitle(title, errors.length > 0)}</title>
      <ErrorSummary errors={errors} attempt={actionData} />
      <div>
        <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
          {m.wa_title()}
        </h1>
        <p className="mt-2 max-w-3xl text-ink-muted">{m.wa_lead()}</p>
      </div>
      <section aria-labelledby="wa-state" className="flex flex-col gap-4">
        <h2 id="wa-state" className="font-bold text-2xl">
          {m.wa_state_title()}
        </h2>
        {!view.running && <Note tone="danger">{m.wa_stopped_note()}</Note>}
        {view.pending && (
          <p role="status" className="text-ink-muted text-sm">
            {m.wa_pending()}
          </p>
        )}
        <div className="border border-line-subtle bg-surface-raised p-5">
          <SenderState view={view} />
        </div>
        <LinkingStep view={view} />
      </section>
      {fixed && view.provider ? (
        <FixedProviderNote provider={view.provider} />
      ) : view.status === "connected" ? (
        <section aria-labelledby="wa-unlink" className="flex flex-col gap-4">
          <h2 id="wa-unlink" className="font-bold text-2xl">
            {m.wa_unlink_title()}
          </h2>
          <UnlinkForm />
        </section>
      ) : (
        <section aria-labelledby="wa-link" className="flex flex-col gap-4">
          <div>
            <h2 id="wa-link" className="font-bold text-2xl">
              {m.wa_link_title()}
            </h2>
            <p className="mt-1 text-ink-muted">{m.wa_link_lead()}</p>
          </div>
          <LinkForms phoneError={errors[0]?.message} />
        </section>
      )}
    </div>
  )
}
