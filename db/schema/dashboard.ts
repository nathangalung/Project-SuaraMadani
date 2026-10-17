import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core"
import type { DashboardSnapshot } from "../../shared/dashboard.ts"
import { tenantPolicy } from "./columns.ts"
import { organizations } from "./organizations.ts"

// One row per org
export const dashboardSnapshots = pgTable(
  "dashboard_snapshots",
  {
    orgId: uuid("org_id")
      .primaryKey()
      .references(() => organizations.id),
    data: jsonb("data").$type<DashboardSnapshot>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  () => [tenantPolicy()],
)
