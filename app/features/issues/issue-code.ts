import {
  formatSequenceCode,
  normalizeSequenceCode,
} from "../../../shared/report-id.ts"

// PLAN §5.4: ISU-2026-10-0042
export function formatIssueCode(
  year: number,
  month: number,
  number: number,
): string {
  return formatSequenceCode("ISU", year, month, number)
}

/** Canonical code or null. */
export function normalizeIssueCode(input: string): string | null {
  return normalizeSequenceCode(input, "ISU")
}
