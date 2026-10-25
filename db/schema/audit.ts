import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core"
import { createdAt, primaryId, tenantPolicy } from "./columns.ts"
import { organizations } from "./organizations.ts"

/** HMAC-SHA-256 hex, never the text. */
export type ValueHashes = Record<string, { old?: string; new?: string }>

// Append-only: trigger rejects UPDATE, DELETE
export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    // No FK: rows outlive users
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    changedColumns: text("changed_columns")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    valueHashes: jsonb("value_hashes").$type<ValueHashes>(),
    reasonCode: text("reason_code"),
    // withTenant sets app.request_id
    requestId: text("request_id").default(
      sql`nullif(current_setting('app.request_id', true), '')`,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_log_entity_idx").on(t.orgId, t.entityType, t.entityId),
    tenantPolicy(),
  ],
)
