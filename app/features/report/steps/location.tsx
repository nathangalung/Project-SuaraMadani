import { useState } from "react"
import { Note } from "~/components/ui/note"
import { Select } from "~/components/ui/select"
import { m } from "~/paraglide/messages.js"
import {
  browserStorage,
  type Draft,
  type LocationAnswer,
  saveStep,
} from "../draft"
import type { RegionOption } from "../regions.server"
import { errorText, StepPage, useStepNav } from "../step-page"
import { type StepError, validateLocation } from "../validate"

export type RegionLists = {
  provinces: RegionOption[]
  regencies: RegionOption[]
  districts: RegionOption[]
  villages: RegionOption[]
}

const LEVELS = [
  "provinceCode",
  "regencyCode",
  "districtCode",
  "villageCode",
] as const
type Level = (typeof LEVELS)[number]
const LIST_OF: Record<Level, keyof RegionLists> = {
  provinceCode: "provinces",
  regencyCode: "regencies",
  districtCode: "districts",
  villageCode: "villages",
}

/** Children from the cached route. */
export async function fetchRegions(parent: string): Promise<RegionOption[]> {
  const response = await fetch(`/wilayah/${parent}.json`)
  if (!response.ok) throw new Error(`regions ${response.status}`)
  return (await response.json()) as RegionOption[]
}

export function LocationStep({
  draft,
  lists: initialLists,
}: {
  draft: Draft
  lists: RegionLists
}) {
  const { next } = useStepNav("location")
  const [errors, setErrors] = useState<StepError[]>([])
  const [answer, setAnswer] = useState<LocationAnswer>(draft.location ?? {})
  const [lists, setLists] = useState(initialLists)
  const [loadFailed, setLoadFailed] = useState(
    initialLists.provinces.length === 0,
  )

  const choose = async (level: Level, code: string) => {
    const index = LEVELS.indexOf(level)
    const lower = LEVELS.slice(index + 1)
    // Children follow the parent
    setAnswer((current) => {
      const updated: LocationAnswer = { ...current, [level]: code || undefined }
      for (const child of lower) delete updated[child]
      return updated
    })
    setLists((current) => {
      const updated = { ...current }
      for (const child of lower) updated[LIST_OF[child]] = []
      return updated
    })
    const child = lower[0]
    if (!child || !code) return
    try {
      const options = await fetchRegions(code)
      setLoadFailed(false)
      setLists((current) => ({ ...current, [LIST_OF[child]]: options }))
    } catch {
      setLoadFailed(true)
    }
  }

  const onContinue = () => {
    const found = validateLocation(answer)
    setErrors(found)
    if (found.length > 0) return
    const names = [...LEVELS]
      .reverse()
      .map((level) =>
        lists[LIST_OF[level]].find((o) => o.code === answer[level]),
      )
      .flatMap((option) => (option ? [option.name] : []))
    saveStep(browserStorage(), draft, "location", {
      ...answer,
      label: names.join(", "),
    })
    next()
  }

  const labels: Record<Level, string> = {
    provinceCode: m.location_province(),
    regencyCode: m.location_regency(),
    districtCode: m.location_district(),
    villageCode: m.location_village(),
  }
  // Locked select names its parent
  const firstPick: Record<Level, string> = {
    provinceCode: m.location_choose(),
    regencyCode: m.location_choose_province_first(),
    districtCode: m.location_choose_regency_first(),
    villageCode: m.location_choose_district_first(),
  }

  return (
    <StepPage
      step="location"
      title={m.step_location_title()}
      errors={errors}
      onContinue={onContinue}
    >
      <Note tone="info">{m.location_reason()}</Note>
      {loadFailed && (
        <div role="alert">
          <Note tone="danger">{m.location_load_failed()}</Note>
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {LEVELS.map((level, index) => {
          const options = lists[LIST_OF[level]]
          const parent = LEVELS[index - 1]
          const locked = parent !== undefined && !answer[parent]
          return (
            <Select
              key={level}
              id={level}
              name={level}
              label={labels[level]}
              optional={level === "villageCode"}
              requiredMark={level !== "villageCode"}
              error={errorText(errors, level)}
              value={answer[level] ?? ""}
              disabled={locked}
              onChange={(event) => choose(level, event.currentTarget.value)}
            >
              <option value="">
                {locked ? firstPick[level] : m.location_choose()}
              </option>
              {options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </Select>
          )
        })}
      </div>
    </StepPage>
  )
}
