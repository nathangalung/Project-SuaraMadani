import { desc, type SQL, sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import {
  TAKEDOWN_REASONS,
  type TakedownReason,
} from "../../shared/complaints.ts"
import {
  BRIEF_STATUSES,
  type BriefStatus,
  DEMAND_CATEGORIES,
  DEMAND_EVENT_ACTIONS,
  DEMAND_SCOPES,
  type DemandCategory,
  type DemandEventAction,
  type DemandScope,
  ITEM_EVENT_ACTIONS,
} from "../../shared/demands.ts"
import {
  DEMAND_STATES,
  type DemandState,
  FULFILMENT_STATUSES,
  type FulfilmentStatus,
  RESPONSE_STATUSES,
  type ResponseStatus,
} from "../../shared/status.ts"
import { users } from "./auth.ts"
import {
  createdAt,
  oneOf,
  primaryId,
  tenantPolicy,
  tsvector,
  updatedAt,
} from "./columns.ts"
import { issues } from "./issues.ts"
import { organizations } from "./organizations.ts"
import { regions } from "./regions.ts"

const at = (name: string) => timestamp(name, { withTimezone: true })
const orgRef = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id)

// Admin authored, PLAN §5.4
export const demands = pgTable(
  "demands",
  {
    id: primaryId(),
    orgId: orgRef(),
    year: smallint("year").notNull(),
    number: integer("number").notNull(),
    publicCode: text("public_code").notNull(),
    scope: text("scope").$type<DemandScope>().notNull(),
    provinceCode: text("province_code").references(() => regions.code),
    regencyCode: text("regency_code").references(() => regions.code),
    // Null only before 0024
    category: text("category").$type<DemandCategory>(),
    title: text("title").notNull(),
    // Text as written
    body: text("body").notNull(),
    summary: text("summary").notNull(),
    target: text("target").notNull(),
    raisedOn: date("raised_on").notNull(),
    state: text("state").$type<DemandState>().notNull().default("draft"),
    // Derived from items, never typed
    progress: text("progress")
      .$type<FulfilmentStatus>()
      .notNull()
      .default("not_fulfilled"),
    search: tsvector("search")
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`to_tsvector('indonesian', ${demands.title} || ' ' || ${demands.summary} || ' ' || ${demands.target})`,
      ),
    version: integer("version").notNull().default(1),
    publishedAt: at("published_at"),
    closedAt: at("closed_at"),
    // Complaint hid it, PLAN §5.10
    hiddenAt: at("hidden_at"),
    hiddenReason: text("hidden_reason").$type<TakedownReason>(),
    // Legacy, demand_ratings only
    maxPrefixRatings: integer("max_prefix_ratings"),
    // Top ranking prefix, kept
    maxPrefixRankings: integer("max_prefix_rankings"),
    lastActivityAt: at("last_activity_at").notNull().defaultNow(),
    // No FK: rows outlive users
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("demands_org_id_id_key").on(t.orgId, t.id),
    unique("demands_org_id_public_code_key").on(t.orgId, t.publicCode),
    unique("demands_number_key").on(t.orgId, t.year, t.number),
    index("demands_public_idx")
      .on(t.orgId, desc(t.publishedAt), desc(t.id))
      .where(sql`${t.state} <> 'draft'`),
    index("demands_activity_idx").on(
      t.orgId,
      desc(t.lastActivityAt),
      desc(t.id),
    ),
    index("demands_province_idx")
      .on(t.orgId, t.provinceCode)
      .where(sql`${t.provinceCode} IS NOT NULL`),
    index("demands_category_idx")
      .on(t.orgId, t.category)
      .where(sql`${t.category} IS NOT NULL`),
    check("demands_scope_check", oneOf(t.scope, DEMAND_SCOPES)),
    check(
      "demands_category_check",
      sql`${t.category} IS NULL OR ${oneOf(t.category, DEMAND_CATEGORIES)}`,
    ),
    check(
      "demands_region_check",
      sql`(${t.scope} = 'national' AND ${t.provinceCode} IS NULL AND ${t.regencyCode} IS NULL) OR (${t.scope} = 'regional' AND ${t.provinceCode} IS NOT NULL AND (${t.regencyCode} IS NULL OR starts_with(${t.regencyCode}, ${t.provinceCode} || '.')))`,
    ),
    check("demands_state_check", oneOf(t.state, DEMAND_STATES)),
    check("demands_progress_check", oneOf(t.progress, FULFILMENT_STATUSES)),
    check(
      "demands_published_check",
      sql`(${t.state} = 'draft' OR ${t.publishedAt} IS NOT NULL) AND ((${t.state} = 'closed') = (${t.closedAt} IS NOT NULL))`,
    ),
    check(
      "demands_hidden_check",
      sql`(${t.hiddenAt} IS NULL) = (${t.hiddenReason} IS NULL) AND (${t.hiddenReason} IS NULL OR ${oneOf(t.hiddenReason, TAKEDOWN_REASONS)}) AND (${t.hiddenAt} IS NULL OR ${t.state} = 'draft')`,
    ),
    check("demands_version_check", sql`${t.version} > 0`),
    tenantPolicy(),
  ],
)

const demandRef = (
  name: string,
  t: { orgId: AnyPgColumn; demandId: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [t.orgId, t.demandId],
    foreignColumns: [demands.orgId, demands.id],
  }).onDelete("cascade")

// Sub-tuntutan, two status axes
export const demandItems = pgTable(
  "demand_items",
  {
    id: primaryId(),
    orgId: orgRef(),
    demandId: uuid("demand_id").notNull(),
    position: smallint("position").notNull(),
    body: text("body").notNull(),
    responseStatus: text("response_status")
      .$type<ResponseStatus>()
      .notNull()
      .default("not_responded"),
    fulfilmentStatus: text("fulfilment_status")
      .$type<FulfilmentStatus>()
      .notNull()
      .default("not_fulfilled"),
    // Policy brief summary, public
    briefSummary: text("brief_summary"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("demand_items_org_id_id_key").on(t.orgId, t.id),
    index("demand_items_demand_idx").on(t.orgId, t.demandId, t.position),
    demandRef("demand_items_demand_fk", t),
    check(
      "demand_items_response_check",
      oneOf(t.responseStatus, RESPONSE_STATUSES),
    ),
    check(
      "demand_items_fulfilment_check",
      oneOf(t.fulfilmentStatus, FULFILMENT_STATUSES),
    ),
    // A rejection is a response
    check(
      "demand_items_rejected_check",
      sql`${t.fulfilmentStatus} <> 'rejected' OR ${t.responseStatus} = 'responded'`,
    ),
    check("demand_items_position_check", sql`${t.position} >= 0`),
    check("demand_items_version_check", sql`${t.version} > 0`),
    tenantPolicy(),
  ],
)

const itemRef = (
  name: string,
  t: { orgId: AnyPgColumn; itemId: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [t.orgId, t.itemId],
    foreignColumns: [demandItems.orgId, demandItems.id],
  }).onDelete("cascade")

// Dated, sourced, public timeline
export const demandUpdates = pgTable(
  "demand_updates",
  {
    id: primaryId(),
    orgId: orgRef(),
    demandId: uuid("demand_id").notNull(),
    itemId: uuid("item_id"),
    action: text("action").$type<DemandEventAction>().notNull(),
    // Item state after the event
    responseStatus: text("response_status").$type<ResponseStatus>(),
    fulfilmentStatus: text("fulfilment_status").$type<FulfilmentStatus>(),
    occurredOn: date("occurred_on").notNull(),
    // What changed, public
    note: text("note"),
    sourceText: text("source_text"),
    sourceUrl: text("source_url"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("demand_updates_demand_idx").on(
      t.orgId,
      t.demandId,
      t.occurredOn,
      t.createdAt,
    ),
    index("demand_updates_item_idx")
      .on(t.orgId, t.itemId)
      .where(sql`${t.itemId} IS NOT NULL`),
    demandRef("demand_updates_demand_fk", t),
    itemRef("demand_updates_item_fk", t),
    check("demand_updates_action_check", oneOf(t.action, DEMAND_EVENT_ACTIONS)),
    check(
      "demand_updates_item_check",
      sql`(${oneOf(t.action, ITEM_EVENT_ACTIONS)}) = (${t.itemId} IS NOT NULL)`,
    ),
    check(
      "demand_updates_status_check",
      sql`(${t.action} = 'status') = (${t.responseStatus} IS NOT NULL AND ${t.fulfilmentStatus} IS NOT NULL) AND (${t.responseStatus} IS NULL OR ${oneOf(t.responseStatus, RESPONSE_STATUSES)}) AND (${t.fulfilmentStatus} IS NULL OR ${oneOf(t.fulfilmentStatus, FULFILMENT_STATUSES)})`,
    ),
    // Every change has a source
    check(
      "demand_updates_source_check",
      sql`(${t.action} NOT IN ('status', 'note') OR (${t.note} IS NOT NULL AND ${t.sourceText} IS NOT NULL)) AND (${t.sourceUrl} IS NULL OR ${t.sourceUrl} ~ '^https?://')`,
    ),
    check(
      "demand_updates_close_check",
      sql`${t.action} <> 'close' OR ${t.note} IS NOT NULL`,
    ),
    tenantPolicy(),
  ],
)

// Optional context, published issues
export const demandIssues = pgTable(
  "demand_issues",
  {
    orgId: orgRef(),
    demandId: uuid("demand_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.demandId, t.issueId] }),
    index("demand_issues_issue_idx").on(t.orgId, t.issueId),
    demandRef("demand_issues_demand_fk", t),
    foreignKey({
      name: "demand_issues_issue_fk",
      columns: [t.orgId, t.issueId],
      foreignColumns: [issues.orgId, issues.id],
    }).onDelete("cascade"),
    tenantPolicy(),
  ],
)

export const demandFollows = pgTable(
  "demand_follows",
  {
    orgId: orgRef(),
    demandId: uuid("demand_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.demandId, t.userId] }),
    index("demand_follows_user_idx").on(t.userId),
    demandRef("demand_follows_demand_fk", t),
    tenantPolicy(),
  ],
)

// Legacy rating, no code writes
export const demandRatings = pgTable(
  "demand_ratings",
  {
    orgId: orgRef(),
    demandId: uuid("demand_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: smallint("score").notNull(),
    // Opt-in, anonymous by default
    showName: boolean("show_name").notNull().default(false),
    // Admin hid an abusive name
    nameHiddenAt: at("name_hidden_at"),
    // Hashed prefix, cleared later
    clientHash: text("client_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.demandId, t.userId] }),
    index("demand_ratings_user_idx").on(t.userId),
    index("demand_ratings_client_idx")
      .on(t.orgId, t.demandId, t.clientHash)
      .where(sql`${t.clientHash} IS NOT NULL`),
    demandRef("demand_ratings_demand_fk", t),
    check("demand_ratings_score_check", sql`${t.score} BETWEEN 1 AND 5`),
    tenantPolicy(),
  ],
)

// Own top list, anonymous
export const demandRankings = pgTable(
  "demand_rankings",
  {
    orgId: orgRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    demandId: uuid("demand_id").notNull(),
    // 1 is most important
    position: smallint("position").notNull(),
    // Hashed prefix, cleared later
    clientHash: text("client_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId, t.demandId] }),
    unique("demand_rankings_position_key").on(t.orgId, t.userId, t.position),
    index("demand_rankings_demand_idx").on(t.orgId, t.demandId),
    index("demand_rankings_user_idx").on(t.userId),
    index("demand_rankings_client_idx")
      .on(t.orgId, t.demandId, t.clientHash)
      .where(sql`${t.clientHash} IS NOT NULL`),
    demandRef("demand_rankings_demand_fk", t),
    check("demand_rankings_position_check", sql`${t.position} BETWEEN 1 AND 5`),
    tenantPolicy(),
  ],
)

// Staff PDF, ClamAV before serving
export const policyBriefs = pgTable(
  "policy_briefs",
  {
    id: primaryId(),
    orgId: orgRef(),
    itemId: uuid("item_id").notNull(),
    status: text("status").$type<BriefStatus>().notNull().default("pending"),
    sha256: text("sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    scannedAt: at("scanned_at"),
    // Admin confirms after the scan
    publishedAt: at("published_at"),
  },
  (t) => [
    unique("policy_briefs_org_id_id_key").on(t.orgId, t.id),
    index("policy_briefs_item_idx").on(t.orgId, t.itemId, desc(t.createdAt)),
    index("policy_briefs_status_idx").on(t.status, t.createdAt),
    itemRef("policy_briefs_item_fk", t),
    check("policy_briefs_status_check", oneOf(t.status, BRIEF_STATUSES)),
    check(
      "policy_briefs_scanned_check",
      sql`(${t.status} = 'pending') = (${t.scannedAt} IS NULL)`,
    ),
    check(
      "policy_briefs_published_check",
      sql`${t.publishedAt} IS NULL OR ${t.status} = 'clean'`,
    ),
    check("policy_briefs_sha_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("policy_briefs_size_check", sql`${t.byteSize} > 0`),
    tenantPolicy(),
  ],
)
