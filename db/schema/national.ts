import {
  integer,
  pgMaterializedView,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

// Migration 0020 owns the SQL
export const nationalAggregates = pgMaterializedView("national_aggregates", {
  dimension: text("dimension").$type<NationalDimension>().notNull(),
  key: text("key").notNull(),
  // Campus and total rows only
  received: integer("received"),
  issues: integer("issues"),
  issueReports: integer("issue_reports"),
  // Campus, total, demand rows
  demands: integer("demands"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
}).existing()

export type NationalDimension =
  | "campus"
  | "category"
  | "province"
  | "status"
  | "total"
  // Tuntutan counts, exact
  | "demand"
