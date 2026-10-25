import { and, count, eq } from "drizzle-orm"
import { auditLog } from "../../../db/schema/audit.ts"
import { type MemberRole, users } from "../../../db/schema/auth.ts"
import { reportContacts, reports } from "../../../db/schema/reports.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import { STAFF_ROLES } from "../../../server/auth.server.ts"
import { isReleasedEmail } from "../../../shared/phone.ts"
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

export type ReporterAccount = {
  name: string
  // Null for phone-only accounts
  email: string | null
  phone: string | null
  phoneVerified: boolean
  joinedAt: Date
  // Reports at this campus
  reports: number
}

/** Account behind a report, audited. */
export function revealAccount(
  orgId: string,
  role: MemberRole,
  input: { reportId: string; actorId: string },
): Promise<ReporterAccount | null> {
  // users has no staff policy
  if (!STAFF_ROLES.includes(role)) return Promise.resolve(null)
  return withTenant(
    orgId,
    async (tx) => {
      const [account] = await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phone: users.phoneNumber,
          phoneVerified: users.phoneVerified,
          joinedAt: users.createdAt,
        })
        .from(reports)
        .innerJoin(users, eq(users.id, reports.userId))
        .where(eq(reports.id, input.reportId))
      if (!account) return null
      const [total] = await tx
        .select({ n: count() })
        .from(reports)
        .where(and(eq(reports.orgId, orgId), eq(reports.userId, account.id)))
      await tx.insert(auditLog).values({
        orgId,
        actorId: input.actorId,
        action: "report.view_account",
        entityType: "report",
        entityId: input.reportId,
        changedColumns: [],
      })
      return {
        name: account.name,
        email: isReleasedEmail(account.email) ? null : account.email,
        phone: account.phone,
        phoneVerified: account.phoneVerified,
        joinedAt: account.joinedAt,
        reports: total?.n ?? 0,
      }
    },
    { role },
  )
}
