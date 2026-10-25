import { jakartaYear } from "./format.ts"

// LPR-2026-10-0001, team 22 Oct
const REPORT_CODE = /^LPR-\d{4}-(0[1-9]|1[0-2])-\d{4,6}$/
const SEQUENCE_INPUT = /^(LPR|ISU)(\d{4})(0[1-9]|1[0-2])(\d{4,6})$/

// No I, L, O, U.
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

const RANDOM_LENGTH = 5
const CAMPUS_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/
const RANDOM_CODE = /^[A-Z][A-Z0-9]{1,9}-\d{2}-[0-9A-HJKMNP-TV-Z]{5}$/
const TYPO_MAP: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1" }

export type RandomFill = (target: Uint8Array) => Uint8Array

const cryptoFill: RandomFill = (target) => crypto.getRandomValues(target)

export function isCampusCode(value: string): boolean {
  return CAMPUS_PATTERN.test(value)
}

/** Prefix, year, month, number. */
export function formatSequenceCode(
  prefix: "LPR" | "ISU",
  year: number,
  month: number,
  number: number,
): string {
  const mm = String(month).padStart(2, "0")
  return `${prefix}-${year}-${mm}-${String(number).padStart(4, "0")}`
}

export function formatReportCode(
  year: number,
  month: number,
  number: number,
): string {
  return formatSequenceCode("LPR", year, month, number)
}

export function isReportCode(value: string): boolean {
  return REPORT_CODE.test(value)
}

/** Forgiving input, canonical or null. */
export function normalizeSequenceCode(
  input: string,
  prefix: "LPR" | "ISU",
): string | null {
  const compact = input.toUpperCase().replace(/[\s_\-‐-―]+/g, "")
  const match = SEQUENCE_INPUT.exec(compact)
  if (!match || match[1] !== prefix) return null
  const [, , year, month, number] = match
  return `${prefix}-${year}-${month}-${number}`
}

export function normalizeReportCode(input: string): string | null {
  return normalizeSequenceCode(input, "LPR")
}

/** Complaint codes, caller retries. */
export function generateRandomCode(
  campusCode: string,
  now: Date,
  fill: RandomFill = cryptoFill,
): string {
  if (!isCampusCode(campusCode)) {
    throw new Error(`Invalid campus code: ${campusCode}`)
  }
  const year = String(jakartaYear(now) % 100).padStart(2, "0")
  // 256 divides evenly by 32
  const random = Array.from(
    fill(new Uint8Array(RANDOM_LENGTH)),
    (byte) => CROCKFORD_ALPHABET[byte & 31],
  ).join("")
  return `${campusCode}-${year}-${random}`
}

export function isRandomCode(value: string): boolean {
  return RANDOM_CODE.test(value)
}

/** Canonical form or null. */
export function normalizeRandomCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s_\-‐-―]+/g, "")
  const tailStart = compact.length - RANDOM_LENGTH
  const campus = compact.slice(0, tailStart - 2)
  const year = compact.slice(tailStart - 2, tailStart)
  const random = compact
    .slice(tailStart)
    .replace(/[OIL]/g, (char) => TYPO_MAP[char] ?? char)
  const code = `${campus}-${year}-${random}`
  return isRandomCode(code) ? code : null
}
