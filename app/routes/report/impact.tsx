import { browserStorage, readDraft } from "~/features/report/draft"
import type { ReportHandle } from "~/features/report/step-page"
import { ImpactStep } from "~/features/report/steps/impact"
import type { Route } from "./+types/impact"

export { StepFallback as HydrateFallback } from "~/features/report/step-page"

export const handle: ReportHandle = { reportStep: "impact" }

// Draft lives in sessionStorage
export function clientLoader() {
  return { draft: readDraft(browserStorage()) }
}
clientLoader.hydrate = true as const

export default function Step({ loaderData }: Route.ComponentProps) {
  return <ImpactStep draft={loaderData.draft} />
}
