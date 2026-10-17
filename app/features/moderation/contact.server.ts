import { eq } from "drizzle-orm"
import { auditLog } from "../../../db/schema/audit.ts"
import { type MemberRole, users } from "../../../db/schema/auth.ts"
import { reportContacts, reports } from "../../../db/schema/reports.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import type { CONTACT_METHODS } from "../../../shared/report-fields.ts"

export type ReporterContact = {
  // Account name, admins only
  name: string
  phone: string
  method: (typeof CONTACT_METHODS)[number]
}

/** staff_only policy, audit per view. */
export function revealContact(
  orgId: string,
  role: MemberRole,
  input: { reportId: string; actorId: string },
): Promise<ReporterContact | null> {
  return withTenant(
    orgId,
    async (tx) => {
      const [contact] = await tx
        .select({
          name: users.name,
          phone: reportContacts.phone,
          method: reportContacts.method,
        })
        .from(reportContacts)
        .innerJoin(reports, eq(reports.id, reportContacts.reportId))
        .innerJoin(users, eq(users.id, reports.userId))
        .where(eq(reportContacts.reportId, input.reportId))
      if (!contact) return null
      await tx.insert(auditLog).values({
        orgId,
        actorId: input.actorId,
        action: "report.view_contact",
        entityType: "report",
        entityId: input.reportId,
        changedColumns: [],
      })
      return {
        name: contact.name,
        phone: contact.phone,
        method: contact.method as ReporterContact["method"],
      }
    },
    { role },
  )
}
