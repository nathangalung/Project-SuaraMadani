import { browserStorage, readDraft } from "~/features/report/draft"
import type { ReportHandle } from "~/features/report/step-page"
import { EvidenceStep } from "~/features/report/steps/evidence"
import type { Route } from "./+types/evidence"

export { StepFallback as HydrateFallback } from "~/features/report/step-page"

export const handle: ReportHandle = { reportStep: "evidence" }

// Draft lives in sessionStorage
export function clientLoader() {
  return { draft: readDraft(browserStorage()) }
}
clientLoader.hydrate = true as const

export default function Step({ loaderData }: Route.ComponentProps) {
  return <EvidenceStep draft={loaderData.draft} />
}
