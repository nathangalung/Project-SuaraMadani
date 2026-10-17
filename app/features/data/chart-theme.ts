import type { CategoryId } from "../../../shared/categories.ts"
import type { MapClass } from "../../../shared/dashboard.ts"

// Mockup chartTheme, purple fails CVD
export const CATEGORY_COLOR: Record<CategoryId, string> = {
  program: "#176bff",
  bencana: "#d81623",
  bansos: "#c8279a",
}

// DESIGN.md Charts, CVD validated
export const TREND_COLOR = { received: "#176bff", verified: "#e57b12" } as const

export const STATUS_RAMP = [
  "#86b6ef",
  "#5598e7",
  "#2a78d6",
  "#1c5cab",
  "#104281",
] as const

// Neutral for flow exits
export const SIDE_STATUS_COLOR = "#9aa3b8"

export const CHART_INK = {
  primary: "#151515",
  muted: "#5e5e5e",
  grid: "#ece6d6",
  axis: "#d9cfb6",
} as const

// Ordinal ramps, validator passed
export const MAP_FILL: Record<MapClass, string> = {
  none: "url(#map-no-data)",
  zero: "#dde2ea",
  few: "#86b6ef",
  low: "#5598e7",
  mid: "#2a78d6",
  high: "#104281",
}

// Tuntutan layer, violet ramp
export const DEMAND_FILL: Record<Exclude<MapClass, "none">, string> = {
  zero: "#dde2ea",
  few: "#ad97e8",
  low: "#8a6bd8",
  mid: "#6b3fb8",
  high: "#3f2180",
}
