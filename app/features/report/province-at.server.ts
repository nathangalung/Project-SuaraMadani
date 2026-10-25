import { geoContains } from "d3-geo"
import type { LatLng } from "../../../shared/report-fields.ts"
import { PROVINCE_FEATURES } from "../data/region-map.server"

/** Simplified shapes: coasts may miss. */
export function provinceAt({ lat, lng }: LatLng): string | null {
  const hit = PROVINCE_FEATURES.features.find((shape) =>
    geoContains(shape, [lng, lat]),
  )
  return typeof hit?.id === "string" ? hit.id : null
}
