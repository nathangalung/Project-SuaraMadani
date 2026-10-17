// GitHub org invites: 7 days
const INVITATION_TTL_DAYS = 7

export function invitationExpiry(sentAt: Date): Date {
  return new Date(sentAt.getTime() + INVITATION_TTL_DAYS * 86_400_000)
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>".]+(\.[^\s@<>".]+)+$/
const EMAIL_MAX = 254

/** Lowercase address, else null. */
export function parseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return email.length <= EMAIL_MAX && EMAIL.test(email) ? email : null
}

export type RemovalRefusal = "self" | "last_admin"

/** No self-removal, keep one admin. */
export function removalRefusal(
  admins: readonly string[],
  actorId: string,
  target: string,
): RemovalRefusal | null {
  if (actorId === target) return "self"
  if (!admins.includes(target)) return null
  return admins.some((id) => id !== target) ? null : "last_admin"
}

// DNS label, lowercase
const SLUG = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/
const RESERVED_SLUGS = new Set([
  "www",
  "api",
  "admin",
  "media",
  "mail",
  "status",
  "app",
])
// Same rule as organizations CHECK
const CAMPUS_CODE = /^[A-Z][A-Z0-9]{1,9}$/
const NAME_MAX = 120

export type CampusInput = {
  slug: string
  name: string
  campusName: string
  campusCode: string
  adminEmail: string
  contactEmail: string | null
}

export type CampusField =
  | keyof CampusInput
  | Exclude<keyof CampusInput, "contactEmail">
  | "contactEmail"

type Parsed =
  | { ok: true; value: CampusInput }
  | { ok: false; errors: CampusField[] }

function name(value: unknown): string | null {
  const text =
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return text.length >= 2 && text.length <= NAME_MAX ? text : null
}

/** Superadmin form, form order errors. */
export function parseCampusForm(
  fields: Readonly<Record<string, unknown>>,
): Parsed {
  const slug = String(fields.slug ?? "")
    .trim()
    .toLowerCase()
  const code = String(fields.campusCode ?? "")
    .trim()
    .toUpperCase()
  const rawContact = String(fields.contactEmail ?? "").trim()
  const value = {
    campusName: name(fields.campusName),
    name: name(fields.name),
    slug: SLUG.test(slug) && !RESERVED_SLUGS.has(slug) ? slug : null,
    campusCode: CAMPUS_CODE.test(code) ? code : null,
    adminEmail: parseEmail(fields.adminEmail),
    contactEmail: rawContact === "" ? "" : parseEmail(rawContact),
  }
  const errors = (Object.keys(value) as CampusField[]).filter(
    (key) => value[key] === null,
  )
  if (
    errors.length > 0 ||
    !value.campusName ||
    !value.name ||
    !value.slug ||
    !value.campusCode ||
    !value.adminEmail ||
    value.contactEmail === null
  ) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    value: {
      slug: value.slug,
      name: value.name,
      campusName: value.campusName,
      campusCode: value.campusCode,
      adminEmail: value.adminEmail,
      contactEmail: value.contactEmail || null,
    },
  }
}

// Fits 128 KB form body
export const LOGO_MAX_BYTES = 96 * 1024

/** Browser check, body cap 413s. */
export function logoTooLarge(file: { size: number } | undefined): boolean {
  return file !== undefined && file.size > LOGO_MAX_BYTES
}

export type LogoKind = "png" | "jpeg" | "webp"

const startsWith = (bytes: Uint8Array, at: number, ...values: number[]) =>
  values.every((value, i) => bytes[at + i] === value)

/** Raster only: SVG may script. */
export function sniffLogo(bytes: Uint8Array): LogoKind | null {
  if (startsWith(bytes, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "png"
  }
  if (startsWith(bytes, 0, 0xff, 0xd8, 0xff)) return "jpeg"
  // RIFF....WEBP
  if (
    startsWith(bytes, 0, 0x52, 0x49, 0x46, 0x46) &&
    startsWith(bytes, 8, 0x57, 0x45, 0x42, 0x50)
  ) {
    return "webp"
  }
  return null
}

// Footer and /tentang facts
export type IdentityInput = {
  name: string
  campusName: string
  contactEmail: string | null
  alliance: string | null
  legalNumber: string | null
  credit: string | null
  officers: string[]
}
export type IdentityField = keyof IdentityInput

// Same cap as site-identity text
const IDENTITY_MAX = { alliance: 120, legalNumber: 80, credit: 120 } as const
const OFFICERS_MAX = 20

/** Optional text, null when blank. */
function optional(value: unknown, max: number): string | null | "invalid" {
  const text =
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  if (text === "") return null
  return text.length <= max ? text : "invalid"
}

/** Admin form, ordered errors. */
export function parseIdentityForm(
  fields: Readonly<Record<string, unknown>>,
): { ok: true; value: IdentityInput } | { ok: false; errors: IdentityField[] } {
  const rawContact = String(fields.contactEmail ?? "").trim()
  const contactEmail = rawContact === "" ? null : parseEmail(rawContact)
  const officers = String(fields.officers ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
  const value = {
    name: name(fields.name),
    campusName: name(fields.campusName),
    contactEmail,
    alliance: optional(fields.alliance, IDENTITY_MAX.alliance),
    legalNumber: optional(fields.legalNumber, IDENTITY_MAX.legalNumber),
    credit: optional(fields.credit, IDENTITY_MAX.credit),
  }
  const errors: IdentityField[] = []
  if (!value.name) errors.push("name")
  if (!value.campusName) errors.push("campusName")
  if (rawContact !== "" && !contactEmail) errors.push("contactEmail")
  for (const key of ["alliance", "legalNumber", "credit"] as const) {
    if (value[key] === "invalid") errors.push(key)
  }
  if (
    officers.length > OFFICERS_MAX ||
    officers.some((line) => line.length > NAME_MAX)
  ) {
    errors.push("officers")
  }
  if (
    errors.length > 0 ||
    !value.name ||
    !value.campusName ||
    value.alliance === "invalid" ||
    value.legalNumber === "invalid" ||
    value.credit === "invalid"
  ) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    value: {
      name: value.name,
      campusName: value.campusName,
      contactEmail,
      alliance: value.alliance,
      legalNumber: value.legalNumber,
      credit: value.credit,
      officers,
    },
  }
}
