import { browserStorage, readDraft } from "~/features/report/draft"
import type { ReportHandle } from "~/features/report/step-page"
import { DetailsStep } from "~/features/report/steps/details"
import type { Route } from "./+types/details"

export { StepFallback as HydrateFallback } from "~/features/report/step-page"

export const handle: ReportHandle = { reportStep: "details" }

// Draft lives in sessionStorage
export function clientLoader() {
  return { draft: readDraft(browserStorage()) }
}
clientLoader.hydrate = true as const

export default function Step({ loaderData }: Route.ComponentProps) {
  return <DetailsStep draft={loaderData.draft} />
}
