import { browserStorage, readDraft } from "~/features/report/draft"
import type { ReportHandle } from "~/features/report/step-page"
import { RelationStep } from "~/features/report/steps/relation"
import type { Route } from "./+types/relation"

export { StepFallback as HydrateFallback } from "~/features/report/step-page"

export const handle: ReportHandle = { reportStep: "relation" }

// Draft lives in sessionStorage
export function clientLoader() {
  return { draft: readDraft(browserStorage()) }
}
clientLoader.hydrate = true as const

export default function Step({ loaderData }: Route.ComponentProps) {
  return <RelationStep draft={loaderData.draft} />
}
