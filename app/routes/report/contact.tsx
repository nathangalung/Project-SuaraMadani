import { browserStorage, readDraft } from "~/features/report/draft"
import type { ReportHandle } from "~/features/report/step-page"
import { ContactStep } from "~/features/report/steps/contact"
import type { Route } from "./+types/contact"

export { StepFallback as HydrateFallback } from "~/features/report/step-page"

export const handle: ReportHandle = { reportStep: "contact" }

// Draft lives in sessionStorage
export function clientLoader() {
  return { draft: readDraft(browserStorage()) }
}
clientLoader.hydrate = true as const

export default function Step({ loaderData }: Route.ComponentProps) {
  return <ContactStep draft={loaderData.draft} />
}
