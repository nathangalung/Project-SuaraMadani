import { sql } from "drizzle-orm"
import { dashboardSnapshots } from "../../../db/schema/dashboard.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import { QUEUE_SLOW_AT } from "../../../shared/dashboard.ts"

/** Snapshot queue, 15 min old. */
export async function queueSlow(orgId: string): Promise<boolean> {
  const [row] = await withTenant(orgId, (tx) =>
    tx
      .select({
        queue: sql<
          number | null
        >`(${dashboardSnapshots.data} -> 'reports' ->> 'queue')::int`,
      })
      .from(dashboardSnapshots),
  )
  return (row?.queue ?? 0) >= QUEUE_SLOW_AT
}
