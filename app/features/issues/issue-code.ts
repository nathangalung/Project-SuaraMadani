// PLAN §5.4: ISU-ITB-26-0042
const ISSUE_CODE = /^ISU-[A-Z][A-Z0-9]{1,9}-\d{2}-\d{4,6}$/

export function formatIssueCode(
  campusCode: string,
  year: number,
  number: number,
): string {
  const yy = String(year % 100).padStart(2, "0")
  return `ISU-${campusCode}-${yy}-${String(number).padStart(4, "0")}`
}

/** Canonical code or null. */
export function normalizeIssueCode(input: string): string | null {
  const code = input.trim().toUpperCase()
  return ISSUE_CODE.test(code) ? code : null
}
