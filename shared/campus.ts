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
