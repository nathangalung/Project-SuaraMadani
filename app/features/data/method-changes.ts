// PLAN §5.8 method change marker
export type DashboardChart = "monthly" | "category" | "status"

export type MethodChange = {
  // ISO date the rule changed
  on: string
  charts: readonly DashboardChart[]
  text: () => string
}

// Taxonomy or verification, newest first
export const METHOD_CHANGES: readonly MethodChange[] = []
