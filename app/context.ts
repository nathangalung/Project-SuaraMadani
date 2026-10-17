import { createContext } from "react-router"
import { accountLabel } from "../shared/phone.ts"

// Mirrors Tenant, checked on set
export type TenantContext = {
  id: string
  slug: string
  host: string
  name: string
  campusCode: string
  campusName: string
  contactEmail?: string | null
  theme: Record<string, string | undefined>
  settings: {
    intakePaused?: boolean
    alliance?: string
    legalNumber?: string
    statusUrl?: string
    credit?: string
    officers?: string[]
  }
  // Uploaded logo file name
  logoHash?: string | null
}

export type SessionContext = {
  user: {
    id: string
    email: string
    // Typed at Daftar, maybe unproven
    emailVerified: boolean
    name: string
    // E.164, older accounts lack one
    phoneNumber?: string | null
    // Proven by a WhatsApp code
    phoneVerified: boolean
    twoFactorEnabled: boolean
    updatedAt: Date
  }
  session: { id: string; createdAt: Date; expiresAt: Date }
}

export const tenantContext = createContext<TenantContext>()
export const sessionContext = createContext<SessionContext | null>(null)
// Apex host, no tenant set
export const nationalContext = createContext<boolean>(false)

/** Header and "Masuk sebagai" text. */
export function signedInLabel(session: SessionContext | null | undefined) {
  return session ? accountLabel(session.user) : null
}
