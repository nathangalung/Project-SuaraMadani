import { and, eq, sql } from "drizzle-orm"
import { auditLog } from "../../../db/schema/audit.ts"
import { reports } from "../../../db/schema/reports.ts"
import { withTenant } from "../../../db/tenant.server.ts"

export type WithdrawResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: "not_found" }

/** UU PDP Pasal 9, owner. */
export function withdrawForwardConsent(
  tenant: { id: string },
  input: { code: string; userId: string },
): Promise<WithdrawResult> {
  return withTenant(tenant.id, async (tx): Promise<WithdrawResult> => {
    const own = and(
      eq(reports.publicCode, input.code),
      eq(reports.userId, input.userId),
    )
    const [found] = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(own)
      .for("update")
    if (!found) return { ok: false, reason: "not_found" }
    const [changed] = await tx
      .update(reports)
      .set({
        consents: sql`array_remove(${reports.consents}, 'forward_to_agency')`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(reports.id, found.id),
          sql`${reports.consents} @> ARRAY['forward_to_agency']::text[]`,
        ),
      )
      .returning({ id: reports.id })
    if (!changed) return { ok: true, changed: false }
    // Raw code, labels.ts is frontend
    await tx.insert(auditLog).values({
      orgId: tenant.id,
      actorId: input.userId,
      action: "report.consent_withdraw",
      entityType: "report",
      entityId: found.id,
      changedColumns: ["consents"],
    })
    return { ok: true, changed: true }
  })
}
