import { jakartaYear } from "./format.ts"

// No I, L, O, U.
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

const RANDOM_LENGTH = 5
const CAMPUS_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/
const CODE_PATTERN = /^[A-Z][A-Z0-9]{1,9}-\d{2}-[0-9A-HJKMNP-TV-Z]{5}$/
const TYPO_MAP: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1" }

export type RandomFill = (target: Uint8Array) => Uint8Array

const cryptoFill: RandomFill = (target) => crypto.getRandomValues(target)

export function isCampusCode(value: string): boolean {
  return CAMPUS_PATTERN.test(value)
}

/** Caller retries on unique collision. */
export function generateReportCode(
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

export function isReportCode(value: string): boolean {
  return CODE_PATTERN.test(value)
}

/** Canonical form or null. */
export function normalizeReportCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s_\-‐-―]+/g, "")
  const tailStart = compact.length - RANDOM_LENGTH
  const campus = compact.slice(0, tailStart - 2)
  const year = compact.slice(tailStart - 2, tailStart)
  const random = compact
    .slice(tailStart)
    .replace(/[OIL]/g, (char) => TYPO_MAP[char] ?? char)
  const code = `${campus}-${year}-${random}`
  return isReportCode(code) ? code : null
}
