import { sql } from "drizzle-orm"
import {
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core"
import { bytea, createdAt, oneOf, primaryId, tenantPolicy } from "./columns.ts"

/** Maps to --theme-* variables. */
export type ThemeToken =
  | "surface"
  | "surfaceRaised"
  | "ink"
  | "inkMuted"
  | "inkSoft"
  | "inkHover"
  | "accent"
  | "accentHover"
  | "accentSoft"
  | "onAccent"
  | "brand"
  | "brandHover"
  | "brandSoft"
  | "pop"
  | "popStrong"
  | "chip"
  | "mint"
  | "mintSoft"
  | "line"
  | "lineSubtle"
  | "danger"
  | "dangerSoft"
  | "dangerInk"
  | "success"
  | "successSoft"
  | "successInk"
  | "highlight"
  | "focus"
  | "headerBg"
  | "heroBg"
  | "bandBg"
  | "pageBg"
  | "homeListBg"
  | "footerBg"
  | "detailBg"
  | "fontBody"
  | "fontHeading"
  | "fontUi"

// Tenant-owned ornament set
export type BrandAssets = "km-itb"

export type OrgTheme = Partial<Record<ThemeToken, string>> & {
  brandAssets?: BrandAssets
}

// Footer facts, admin entered
export type OrgSettings = {
  intakePaused?: boolean
  alliance?: string
  legalNumber?: string
  statusUrl?: string
  // About page credit line
  credit?: string
  // Named officers, /tentang
  officers?: string[]
}

export const COUNTER_KINDS = ["issue", "demand", "report"] as const
export type CounterKind = (typeof COUNTER_KINDS)[number]

// Better Auth organization, no RLS
export const organizations = pgTable(
  "organizations",
  {
    id: primaryId(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: createdAt(),
    host: text("host").notNull().unique(),
    campusCode: text("campus_code").notNull().unique(),
    campusName: text("campus_name").notNull(),
    contactEmail: text("contact_email"),
    theme: jsonb("theme").$type<OrgTheme>().notNull().default({}),
    settings: jsonb("settings").$type<OrgSettings>().notNull().default({}),
    // WebP from sharp, served /logo
    logoBytes: bytea("logo_bytes"),
    logoHash: text("logo_hash"),
  },
  (t) => [
    check(
      "organizations_logo_check",
      sql`(${t.logoBytes} IS NULL) = (${t.logoHash} IS NULL)`,
    ),
    // Same rule as shared/report-id.ts
    check(
      "organizations_campus_code_check",
      sql`${t.campusCode} ~ '^[A-Z][A-Z0-9]{1,9}$'`,
    ),
  ],
)

// Gapless per org, month, kind
export const orgCounters = pgTable(
  "org_counters",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    year: smallint("year").notNull(),
    // 0: yearly (tuntutan, old issues)
    month: smallint("month").notNull().default(0),
    kind: text("kind").$type<CounterKind>().notNull(),
    next: integer("next").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.year, t.month, t.kind] }),
    check("org_counters_kind_check", oneOf(t.kind, COUNTER_KINDS)),
    check("org_counters_next_check", sql`${t.next} > 0`),
    tenantPolicy(),
  ],
)
