import { and, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm"
import { auditLog } from "../../../db/schema/audit.ts"
import { type MemberRole, members } from "../../../db/schema/auth.ts"
import { issues } from "../../../db/schema/issues.ts"
import { contentComplaints } from "../../../db/schema/moderation.ts"
import { reports } from "../../../db/schema/reports.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  type AuditAction,
  type AuditEntity,
  addDays,
  isIsoDate,
} from "../../../shared/moderation.ts"
import { oneOf } from "./form-values.ts"

export const AUDIT_PAGE_SIZE = 50

export type AuditQuery = {
  action: AuditAction | null
  entity: AuditEntity | null
  from: string | null
  to: string | null
  before: { key: string; id: string } | null
}

export type AuditRow = {
  id: string
  key: string
  createdAt: Date
  action: string
  entityType: string
  entityCode: string | null
  // Staff accounts and invitations
  entityShort: string | null
  actorRole: MemberRole | null
  actorShort: string | null
  changedColumns: string[]
  reasonCode: string | null
}

const UTC_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function encodeAuditCursor(row: { key: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.key, row.id])).toString("base64url")
}

function decodeCursor(value: string): AuditQuery["before"] {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    )
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      UTC_KEY.test(parsed[0]) &&
      UUID.test(parsed[1])
    ) {
      return { key: parsed[0], id: parsed[1] }
    }
  } catch {
    // Malformed cursor, first page
  }
  return null
}

const day = (value: string | null) =>
  value !== null && isIsoDate(value) ? value : null

/** Unknown values are dropped. */
export const NO_AUDIT_FILTER: AuditQuery = {
  action: null,
  entity: null,
  from: null,
  to: null,
  before: null,
}

export function parseAuditQuery(params: URLSearchParams): AuditQuery {
  return {
    action: oneOf(AUDIT_ACTIONS, params.get("tindakan") ?? ""),
    entity: oneOf(AUDIT_ENTITIES, params.get("data") ?? ""),
    from: day(params.get("dari")),
    to: day(params.get("sampai")),
    before: decodeCursor(params.get("sebelum") ?? ""),
  }
}

// Jakarta midnight of a day
const wibStart = (iso: string) => sql`${`${iso}T00:00:00+07:00`}::timestamptz`

/** Newest first, keyset paged. */
export function listAudit(
  orgId: string,
  role: MemberRole,
  query: AuditQuery,
  size = AUDIT_PAGE_SIZE,
): Promise<{ rows: AuditRow[]; next: string | null }> {
  const where: (SQL | undefined)[] = [
    query.action ? eq(auditLog.action, query.action) : undefined,
    query.entity ? eq(auditLog.entityType, query.entity) : undefined,
    query.from ? gte(auditLog.createdAt, wibStart(query.from)) : undefined,
    query.to
      ? lt(auditLog.createdAt, wibStart(addDays(query.to, 1)))
      : undefined,
    query.before
      ? sql`(${auditLog.createdAt}, ${auditLog.id}) < (${query.before.key}::timestamptz, ${query.before.id}::uuid)`
      : undefined,
  ]
  return withTenant(
    orgId,
    async (tx) => {
      const found = await tx
        .select({
          id: auditLog.id,
          key: sql<string>`to_char(${auditLog.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          createdAt: auditLog.createdAt,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityCode: sql<
            string | null
          >`COALESCE(${reports.publicCode}, ${issues.publicCode}, ${contentComplaints.publicCode})`,
          entityShort: sql<string | null>`left(${auditLog.entityId}::text, 8)`,
          actorRole: members.role,
          actorShort: sql<string | null>`left(${auditLog.actorId}::text, 8)`,
          changedColumns: auditLog.changedColumns,
          reasonCode: auditLog.reasonCode,
        })
        .from(auditLog)
        .leftJoin(
          reports,
          and(
            eq(auditLog.entityType, "report"),
            eq(reports.id, auditLog.entityId),
          ),
        )
        .leftJoin(
          issues,
          and(
            eq(auditLog.entityType, "issue"),
            eq(issues.id, auditLog.entityId),
          ),
        )
        .leftJoin(
          contentComplaints,
          and(
            eq(auditLog.entityType, "complaint"),
            eq(contentComplaints.id, auditLog.entityId),
          ),
        )
        // Role here, never the email
        .leftJoin(
          members,
          and(
            eq(members.organizationId, auditLog.orgId),
            eq(members.userId, auditLog.actorId),
          ),
        )
        .where(and(...where))
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(size + 1)
      const more = found.length > size
      const rows = more ? found.slice(0, size) : found
      const last = rows.at(-1)
      return { rows, next: more && last ? encodeAuditCursor(last) : null }
    },
    { role },
  )
}
