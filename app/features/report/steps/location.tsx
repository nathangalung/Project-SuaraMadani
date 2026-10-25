import { LocateFixed } from "lucide-react"
import { useState } from "react"
import { Button } from "~/components/ui/button"
import { Note } from "~/components/ui/note"
import { Select } from "~/components/ui/select"
import { m } from "~/paraglide/messages.js"
import { inIndonesia, type LatLng } from "../../../../shared/report-fields.ts"
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

/** Province code under a point. */
export async function fetchProvinceAt(point: LatLng): Promise<string | null> {
  const response = await fetch("/wilayah/titik", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(point),
  })
  if (!response.ok) throw new Error(`point ${response.status}`)
  const body = (await response.json()) as { provinceCode: string | null }
  return body.provinceCode
}

type GpsStatus =
  | "idle"
  | "searching"
  | "found"
  | "unmatched"
  | "outside"
  | "denied"
  | "unsupported"
  | "failed"

// Mockup StepLokasi options
const GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 60_000,
}

const GPS_FAILED: Partial<Record<GpsStatus, () => string>> = {
  outside: m.location_gps_outside,
  denied: m.location_gps_denied,
  unsupported: m.location_gps_unsupported,
  failed: m.location_gps_failed,
}

// About 1 m precision
const round = (value: number) => Math.round(value * 1e5) / 1e5

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
  const [gps, setGps] = useState<GpsStatus>("idle")
  // Province the point fell in
  const [gpsProvince, setGpsProvince] = useState(
    draft.location?.point ? draft.location.provinceCode : undefined,
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

  // Another province drops the point
  const pick = (level: Level, code: string) => {
    if (level === "provinceCode" && gpsProvince && code !== gpsProvince) {
      setAnswer(({ point: _, ...rest }) => rest)
      setGpsProvince(undefined)
      setGps("idle")
    }
    return choose(level, code)
  }

  const locate = () => {
    if (!("geolocation" in navigator)) return setGps("unsupported")
    setGps("searching")
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const point = {
          lat: round(coords.latitude),
          lng: round(coords.longitude),
        }
        if (!inIndonesia(point)) return setGps("outside")
        try {
          const code = await fetchProvinceAt(point)
          setAnswer((current) => ({ ...current, point }))
          setGpsProvince(code ?? undefined)
          if (!code) return setGps("unmatched")
          // Same province keeps lower picks
          if (code !== answer.provinceCode) await choose("provinceCode", code)
          setErrors((current) =>
            current.filter((error) => error.field !== "provinceCode"),
          )
          setGps("found")
        } catch {
          setGps("failed")
        }
      },
      (error) =>
        setGps(error.code === error.PERMISSION_DENIED ? "denied" : "failed"),
      GPS_OPTIONS,
    )
  }
  const gpsFailed = GPS_FAILED[gps]

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
      setErrors={setErrors}
      onContinue={onContinue}
    >
      {/* One child, one step gap */}
      <div>
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="secondary"
            onClick={locate}
            pending={gps === "searching"}
            pendingLabel={m.location_gps_pending()}
            aria-describedby="gps-hint"
          >
            <LocateFixed aria-hidden="true" className="size-5" />
            {m.location_gps_button()}
          </Button>
          <p id="gps-hint" className="text-ink-muted text-sm">
            {m.location_gps_hint()}
          </p>
        </div>
        <div aria-live="polite">
          {gps === "found" && (
            <Note tone="success" className="mt-4">
              {m.location_gps_found()}
            </Note>
          )}
          {gps === "unmatched" && (
            <Note tone="info" className="mt-4">
              {m.location_gps_unmatched()}
            </Note>
          )}
        </div>
        {gpsFailed && (
          <div role="alert" className="mt-4">
            <Note tone="danger">{gpsFailed()}</Note>
          </div>
        )}
      </div>
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
              onChange={(event) => pick(level, event.currentTarget.value)}
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
