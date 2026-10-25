import type { DBFieldAttribute } from "better-auth/db"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { createdAt, oneOf, primaryId, updatedAt } from "./columns.ts"
import { organizations } from "./organizations.ts"

// Better Auth tables, outside RLS

// One tenant staff role
export const MEMBER_ROLES = ["reporter", "editor", "admin"] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

const at = (name: string) => timestamp(name, { withTimezone: true })

export const users = pgTable(
  "users",
  {
    id: primaryId(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    // E.164, required on new accounts
    phoneNumber: text("phone_number"),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    // No default: 18+ box required
    ageDeclaredAt: at("age_declared_at").notNull(),
    ageConsentVersion: text("age_consent_version").notNull(),
    // Platform flag, set by CLI
    superadmin: boolean("superadmin").notNull().default(false),
  },
  (t) => [
    // One account per number
    unique("users_phone_number_key").on(t.phoneNumber),
    check(
      "users_phone_number_check",
      sql`${t.phoneNumber} ~ '^\\+628[0-9]{8,11}$'`,
    ),
  ],
)

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })

export const sessions = pgTable(
  "sessions",
  {
    id: primaryId(),
    expiresAt: at("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: userId(),
    activeOrganizationId: uuid("active_organization_id"),
    // TOTP re-check, freshAge
    stepUpAt: at("step_up_at"),
    // Idle timeout, written per minute
    lastSeenAt: at("last_seen_at"),
    stepUpFailures: smallint("step_up_failures").notNull().default(0),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
)

export const accounts = pgTable(
  "accounts",
  {
    id: primaryId(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: userId(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: at("access_token_expires_at"),
    refreshTokenExpiresAt: at("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
)

export const verifications = pgTable(
  "verifications",
  {
    id: primaryId(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: at("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
)

export const twoFactors = pgTable(
  "two_factors",
  {
    id: primaryId(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: userId(),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count")
      .notNull()
      .default(0),
    lockedUntil: at("locked_until"),
    // TOTP step, single use
    lastTotpStep: integer("last_totp_step"),
  },
  (t) => [
    // Enroll races, one secret
    unique("two_factors_user_id_key").on(t.userId),
    index("two_factors_secret_idx").on(t.secret),
  ],
)

export const passkeys = pgTable(
  "passkeys",
  {
    id: primaryId(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: userId(),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: at("created_at").defaultNow(),
    aaguid: text("aaguid"),
  },
  (t) => [
    index("passkeys_user_id_idx").on(t.userId),
    index("passkeys_credential_id_idx").on(t.credentialID),
  ],
)

const organizationId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" })

export const members = pgTable(
  "members",
  {
    id: primaryId(),
    organizationId: organizationId(),
    userId: userId(),
    role: text("role").$type<MemberRole>().notNull().default("reporter"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("members_organization_id_user_id_key").on(
      t.organizationId,
      t.userId,
    ),
    index("members_user_id_idx").on(t.userId),
    check("members_role_check", oneOf(t.role, MEMBER_ROLES)),
  ],
)

export const INVITATION_STATUSES = ["pending", "accepted", "canceled"] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

export const invitations = pgTable(
  "invitations",
  {
    id: primaryId(),
    organizationId: organizationId(),
    email: text("email").notNull(),
    role: text("role").$type<MemberRole>(),
    status: text("status")
      .$type<InvitationStatus>()
      .notNull()
      .default("pending"),
    expiresAt: at("expires_at").notNull(),
    createdAt: createdAt(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("invitations_organization_id_idx").on(t.organizationId),
    index("invitations_email_idx").on(t.email),
    check("invitations_role_check", oneOf(t.role, MEMBER_ROLES)),
    check("invitations_status_check", oneOf(t.status, INVITATION_STATUSES)),
    // One open invite per address
    uniqueIndex("invitations_pending_email_key")
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending'`),
  ],
)

/** drizzleAdapter schema, usePlural true. */
export const authSchema = {
  users,
  sessions,
  accounts,
  verifications,
  twoFactors,
  passkeys,
  organizations,
  members,
  invitations,
}

// Auth config field contract
export const userAdditionalFields = {
  ageDeclaredAt: { type: "date", required: true, input: false },
  ageConsentVersion: { type: "string", required: true, input: false },
  phoneNumber: { type: "string", required: false, input: false },
  phoneVerified: { type: "boolean", required: false, input: false },
} satisfies Record<string, DBFieldAttribute>

export const organizationAdditionalFields = {
  host: { type: "string", required: true, input: false },
  campusCode: { type: "string", required: true, input: false },
  campusName: { type: "string", required: true, input: false },
} satisfies Record<string, DBFieldAttribute>
