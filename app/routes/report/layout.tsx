import { Outlet } from "react-router"
import { PageHeader } from "~/components/layout/page-header"
import { QueueNote } from "~/components/layout/queue-note"
import { Card } from "~/components/ui/card"
import { Container } from "~/components/ui/container"
import { ToastProvider } from "~/components/ui/toast"
import { reportIntake } from "~/features/report/intake.server"
import { queueSlow } from "~/features/report/queue-delay.server"
import { StepList, useDoneSteps } from "~/features/report/step-list"
import { type ReportOutlet, useCurrentStep } from "~/features/report/step-page"
import { m } from "~/paraglide/messages.js"
import { tenantContext } from "../../context.ts"
import type { Route } from "./+types/layout"

export function headers() {
  return { "Cache-Control": "private, no-store" }
}

export async function loader({ context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  return {
    ...reportIntake(tenant),
    slow: await queueSlow(tenant.id),
  }
}

// JS notice lives in StepFallback
export default function ReportLayout({ loaderData }: Route.ComponentProps) {
  const outlet: ReportOutlet = {
    paused: loaderData.paused,
    statusHref: loaderData.statusHref,
  }
  const step = useCurrentStep()
  const done = useDoneSteps()
  if (!step) {
    return (
      <ToastProvider>
        <Container width="3xl" className="pt-10 pb-24 sm:pb-10">
          <Outlet context={outlet} />
        </Container>
      </ToastProvider>
    )
  }
  return (
    <ToastProvider>
      <PageHeader
        title={m.report_title()}
        description={m.report_lead()}
        titleAs="p"
      />
      <div className="bg-page">
        {/* Form close to the title */}
        <Container width="5xl" className="pt-6 pb-24 sm:pt-8 sm:pb-10">
          {loaderData.slow ? <QueueNote className="mb-8" /> : null}
          <div className="grid gap-10 lg:grid-cols-[14rem_1fr]">
            <div className="hidden lg:block">
              <StepList current={step} done={done} />
            </div>
            <Card className="flex min-w-0 flex-col rounded-xl p-5 sm:p-8">
              <Outlet context={outlet} />
            </Card>
          </div>
          <p className="mt-3 text-center font-ui text-ink-muted text-sm noscript:hidden lg:ml-[16.5rem]">
            {m.report_draft_note()}
          </p>
        </Container>
      </div>
    </ToastProvider>
  )
}
