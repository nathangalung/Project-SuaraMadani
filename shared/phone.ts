// Zod-free for small client chunks.

// Mobile 8x, never 0800-0809
const MOBILE = /^(?:\+62|62|0)?(8[1-9]\d{7,10})$/
const SEPARATORS = /[\s\-().]/g
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HIDDEN = "•"

/** E.164 mobile number, else null. */
export function normalizePhone(input: string): string | null {
  const match = MOBILE.exec(input.replace(SEPARATORS, ""))
  return match ? `+62${match[1]}` : null
}

// RFC 2606, never delivered
const RELEASED_DOMAIN = "dilepas.invalid"

export function normalizeEmail(input: string): string | null {
  const value = input.trim().toLowerCase()
  if (value.endsWith(".invalid")) return null
  return EMAIL.test(value) ? value : null
}

/** Unique stand-in, address proven elsewhere. */
export function releasedEmail(userId: string): string {
  return `${userId}@${RELEASED_DOMAIN}`
}

export function isReleasedEmail(email: string): boolean {
  return email.endsWith(`@${RELEASED_DOMAIN}`)
}

/** Shown as "Masuk sebagai". */
export function accountLabel(user: {
  email: string
  phoneNumber?: string | null
}): string {
  return isReleasedEmail(user.email) && user.phoneNumber
    ? user.phoneNumber
    : user.email
}

export type Identifier = { kind: "email" | "phone"; value: string }

/** Masuk takes email or phone. */
export function identifierKind(input: string): Identifier | null {
  if (input.includes("@")) {
    const value = normalizeEmail(input)
    return value ? { kind: "email", value } : null
  }
  const value = normalizePhone(input)
  return value ? { kind: "phone", value } : null
}

// Masked only when typed
export type Destination =
  | { kind: "masked"; value: string }
  | { kind: "registered" }
  | null

/** "+62 812•••••890" from E.164. */
export function maskPhone(e164: string): string {
  const national = e164.replace(/^\+62/, "")
  const hidden = Math.max(0, national.length - 6)
  return `+62 ${national.slice(0, 3)}${HIDDEN.repeat(hidden)}${national.slice(-3)}`
}

/** "wa•••@contoh.id", domain kept. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@")
  const local = email.slice(0, at)
  const shown = local.length > 2 ? 2 : 1
  return `${local.slice(0, shown)}${HIDDEN.repeat(3)}${email.slice(at)}`
}
