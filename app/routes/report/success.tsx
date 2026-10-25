import { Printer } from "lucide-react"
import { useEffect } from "react"
import { data, useLocation } from "react-router"
import { Button, ButtonLink } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { Note } from "~/components/ui/note"
import { ContactLine } from "~/features/content/policy-page"
import { CopyCode } from "~/features/report/copy-code"
import { EmergencyBanner } from "~/features/report/emergency"
import { useHydrated } from "~/features/report/hydrated"
import { useSiteTitle } from "~/features/report/page-title"
import { ReportLabel } from "~/features/report/report-label"
import type { ReportHandle } from "~/features/report/step-page"
import { reportCodeExists } from "~/features/report/tracking.server"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import { normalizeReportCode } from "../../../shared/report-id.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/success"

// Full width, no step list
export const handle: ReportHandle = { reportStep: null }

// Bookmarkable, code is not secret
export async function loader({ params, context }: Route.LoaderArgs) {
  const code = normalizeReportCode(params.code)
  const tenant = context.get(tenantContext)
  // Tenant lookup: other campuses 404
  if (!code || !(await reportCodeExists(tenant.id, code))) {
    throw data(null, { status: 404 })
  }
  return {
    code,
    tenant: tenant.name,
    campus: tenant.campusName,
    signedIn: context.get(sessionContext) !== null,
    // WhatsApp-only accounts get no mail
    emailReady: context.get(sessionContext)?.user.emailVerified ?? true,
    // PLAN §5.5, real median only
  }
}

type ArrivalState = {
  filesFailed?: unknown
  emergency?: unknown
  sentAt?: unknown
} | null

// Reload renders like the server
function useForgetArrival() {
  useEffect(() => {
    const current: unknown = window.history.state
    if (typeof current !== "object" || current === null) return
    if (!("usr" in current) || current.usr == null) return
    window.history.replaceState({ ...current, usr: null }, "")
  }, [])
}

/** Date only on fresh arrival. */
function sentOn(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : formatDate(date)
}

/** Browser print dialog saves PDF. */
function PrintButton() {
  const hydrated = useHydrated()
  if (!hydrated) return null
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      onClick={() => window.print()}
    >
      <Printer aria-hidden="true" className="size-5" />
      {m.success_print()}
    </Button>
  )
}

export default function Success({ loaderData }: Route.ComponentProps) {
  const state = useLocation().state as ArrivalState
  useForgetArrival()
  const sent = sentOn(state?.sentAt)
  const rows = [
    { label: m.report_label_campus(), value: loaderData.campus },
    ...(sent ? [{ label: m.report_label_sent(), value: sent }] : []),
  ]
  const next = [
    {
      title: m.success_next_check(),
      body: loaderData.signedIn
        ? m.success_next_body_signed_in()
        : m.success_next_body(),
    },
    {
      title: m.success_next_merge(),
      body: m.success_next_merge_body(),
    },
    {
      title: m.success_next_follow(),
      body: m.home_how_step_4(),
    },
  ]
  return (
    <>
      <title>{useSiteTitle(m.success_title())}</title>
      {/* Root focuses h1 on arrival */}
      <div className="text-center">
        <h1 className="font-bold font-heading text-[clamp(2rem,6vw,3rem)] text-ink leading-tight [font-synthesis-weight:none]">
          {m.success_title()}
        </h1>
        <p className="mt-5 text-lg leading-relaxed">{m.success_code_note()}</p>
      </div>
      <div className="mt-10 flex flex-col items-center">
        <ReportLabel
          code={loaderData.code}
          tenant={loaderData.tenant}
          rows={rows}
        />
        <CopyCode code={loaderData.code} />
      </div>
      {state?.filesFailed === true && (
        <Note tone="danger" className="mt-6">
          {m.success_files_failed()}
        </Note>
      )}
      {loaderData.emailReady === false ? (
        <Note tone="info" className="mt-6">
          {m.report_email_unverified()}
        </Note>
      ) : null}
      {state?.emergency === true && (
        <div className="mt-6">
          <EmergencyBanner />
        </div>
      )}
      <Card className="mt-6 p-6 sm:p-8">
        <h2 className="font-bold text-2xl">{m.success_next_title()}</h2>
        <ol className="mt-5 flex flex-col gap-5">
          {next.map((step, index) => (
            <li key={step.title} className="flex items-start gap-4">
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft font-heading text-brand text-lg"
              >
                {index + 1}
              </span>
              <div className="pt-1.5">
                <p className="font-semibold text-lg">{step.title}</p>
                <p className="mt-1 text-ink-soft leading-relaxed">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      {/* Question and answer print together */}
      <div className="mt-6 break-inside-avoid text-center">
        <p>{m.success_contact_lead()}</p>
        <ContactLine />
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center print:hidden">
        <ButtonLink to="/lacak" size="lg">
          {m.nav_track()}
        </ButtonLink>
        <PrintButton />
      </div>
    </>
  )
}
