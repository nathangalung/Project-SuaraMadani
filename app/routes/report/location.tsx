import { browserStorage, readDraft } from "~/features/report/draft"
import type { ReportHandle } from "~/features/report/step-page"
import {
  fetchRegions,
  LocationStep,
  type RegionLists,
} from "~/features/report/steps/location"
import type { Route } from "./+types/location"

export { StepFallback as HydrateFallback } from "~/features/report/step-page"

export const handle: ReportHandle = { reportStep: "location" }

async function listOrEmpty(parent: string | undefined) {
  if (!parent) return []
  try {
    return await fetchRegions(parent)
  } catch {
    return []
  }
}

// Draft codes need their lists
export async function clientLoader() {
  const draft = readDraft(browserStorage())
  const saved = draft.location ?? {}
  const [provinces, regencies, districts, villages] = await Promise.all([
    listOrEmpty("id"),
    listOrEmpty(saved.provinceCode),
    listOrEmpty(saved.regencyCode),
    listOrEmpty(saved.districtCode),
  ])
  const lists: RegionLists = { provinces, regencies, districts, villages }
  return { draft, lists }
}
clientLoader.hydrate = true as const

export default function Step({ loaderData }: Route.ComponentProps) {
  return <LocationStep draft={loaderData.draft} lists={loaderData.lists} />
}
