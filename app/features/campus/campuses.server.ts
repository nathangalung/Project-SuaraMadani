import { and, asc, count, eq, or, sql } from "drizzle-orm"
import { data, type RouterContextProvider } from "react-router"
import { database } from "../../../db/client.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { invitations, members, users } from "../../../db/schema/auth.ts"
import { organizations } from "../../../db/schema/organizations.ts"
import { pgError, withTenant } from "../../../db/tenant.server.ts"
import { resetAuth } from "../../../server/auth.server.ts"
import { superadminContext } from "../../../server/request-context.server.ts"
import { type CampusInput, invitationExpiry } from "../../../shared/campus.ts"
import {
  type SessionContext,
  sessionContext,
  type TenantContext,
  tenantContext,
} from "../../context.ts"
import {
  type CampusTenant,
  deliverInvitation,
  type Invitation,
  type InvitationMail,
  type TeamDeps,
  teamDeps,
} from "./members.server.ts"

export type CampusRow = {
  id: string
  name: string
  campusName: string
  campusCode: string
  host: string
  createdAt: Date
  admins: number
  pendingInvitations: number
}

/** Superadmin overview, global tables. */
export async function listCampuses(): Promise<CampusRow[]> {
  const { db } = database()
  const admins = db
    .select({ orgId: members.organizationId, n: count().as("admins") })
    .from(members)
    .where(eq(members.role, "admin"))
    .groupBy(members.organizationId)
    .as("admins")
  const pending = db
    .select({ orgId: invitations.organizationId, n: count().as("pending") })
    .from(invitations)
    .where(eq(invitations.status, "pending"))
    .groupBy(invitations.organizationId)
    .as("pending")
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      campusName: organizations.campusName,
      campusCode: organizations.campusCode,
      host: organizations.host,
      createdAt: organizations.createdAt,
      admins: sql<number>`coalesce(${admins.n}, 0)::int`,
      pendingInvitations: sql<number>`coalesce(${pending.n}, 0)::int`,
    })
    .from(organizations)
    .leftJoin(admins, eq(admins.orgId, organizations.id))
    .leftJoin(pending, eq(pending.orgId, organizations.id))
    .orderBy(asc(organizations.campusName))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type TakenField = "slug" | "campusCode"

export type CreateCampusResult =
  | { ok: true; orgId: string; host: string; mail: InvitationMail }
  | { ok: false; reason: "forbidden" }
  | { ok: false; reason: "taken"; field: TakenField }

const CONSTRAINT_FIELD: Record<string, TakenField> = {
  organizations_slug_unique: "slug",
  organizations_host_unique: "slug",
  organizations_campus_code_unique: "campusCode",
}

type CreateDeps = TeamDeps & { resetAuth: () => void }

/** One transaction, mail after commit. */
export async function createCampus(
  input: { actorId: string; value: CampusInput; apexHost: string },
  deps: CreateDeps = { ...teamDeps(), resetAuth },
): Promise<CreateCampusResult> {
  const { value } = input
  const host = `${value.slug}.${input.apexHost}`
  // Known before insert, for withTenant
  const orgId = Bun.randomUUIDv7()
  const now = deps.now()
  type Created = Invitation | "forbidden" | TakenField
  let created: Created
  try {
    created = await withTenant(orgId, async (tx): Promise<Created> => {
      const [actor] = await tx
        .select({ superadmin: users.superadmin })
        .from(users)
        .where(eq(users.id, input.actorId))
      if (actor?.superadmin !== true) return "forbidden"
      const [clash] = await tx
        .select({
          slug: organizations.slug,
          host: organizations.host,
        })
        .from(organizations)
        .where(
          or(
            eq(organizations.slug, value.slug),
            eq(organizations.host, host),
            eq(organizations.campusCode, value.campusCode),
          ),
        )
        .limit(1)
      if (clash) {
        return clash.slug === value.slug || clash.host === host
          ? "slug"
          : "campusCode"
      }
      await tx.insert(organizations).values({
        id: orgId,
        name: value.name,
        slug: value.slug,
        host,
        campusCode: value.campusCode,
        campusName: value.campusName,
        contactEmail: value.contactEmail,
        createdAt: now,
      })
      const [invite] = await tx
        .insert(invitations)
        .values({
          organizationId: orgId,
          email: value.adminEmail,
          role: "admin",
          status: "pending",
          expiresAt: invitationExpiry(now),
          inviterId: input.actorId,
          createdAt: now,
        })
        .returning({ id: invitations.id, expiresAt: invitations.expiresAt })
      if (!invite) throw new Error("invitation not inserted")
      await tx.insert(auditLog).values([
        {
          orgId,
          actorId: input.actorId,
          action: "campus.create",
          entityType: "organization",
          entityId: orgId,
          changedColumns: ["organizations"],
        },
        {
          orgId,
          actorId: input.actorId,
          action: "member.invite",
          entityType: "invitation",
          entityId: invite.id,
          changedColumns: ["invitations"],
          reasonCode: "admin",
        },
      ])
      return {
        id: invite.id,
        email: value.adminEmail,
        expiresAt: invite.expiresAt,
      }
    })
  } catch (error) {
    // Concurrent create, same name
    const field = CONSTRAINT_FIELD[pgError(error)?.constraint ?? ""]
    if (pgError(error)?.code === "23505" && field) {
      return { ok: false, reason: "taken", field }
    }
    throw error
  }
  if (created === "forbidden") return { ok: false, reason: "forbidden" }
  if (typeof created === "string") {
    return { ok: false, reason: "taken", field: created }
  }
  // Better Auth host list
  deps.resetAuth()
  const mail = await deliverInvitation(
    {
      id: orgId,
      host,
      name: value.name,
      campusName: value.campusName,
      theme: {},
    },
    created,
    deps,
  )
  return { ok: true, orgId, host, mail }
}

/** After the root /admin gate. */
export function requireSuperadmin(context: Readonly<RouterContextProvider>): {
  tenant: TenantContext
  session: SessionContext
} {
  const session = context.get(sessionContext)
  if (!session || !context.get(superadminContext)) {
    throw data(null, { status: 403 })
  }
  return { tenant: context.get(tenantContext), session }
}

/** Only while no admin exists. */
export async function resendFirstInvitation(
  input: { actorId: string; orgId: string },
  deps: TeamDeps = teamDeps(),
): Promise<
  | { ok: true; mail: InvitationMail }
  | { ok: false; reason: "forbidden" | "not_found" }
> {
  if (!UUID.test(input.orgId)) return { ok: false, reason: "not_found" }
  const now = deps.now()
  type Found = { invitation: Invitation; tenant: CampusTenant }
  const found = await withTenant(
    input.orgId,
    async (tx): Promise<Found | "forbidden" | "not_found"> => {
      const [actor] = await tx
        .select({ superadmin: users.superadmin })
        .from(users)
        .where(eq(users.id, input.actorId))
      if (actor?.superadmin !== true) return "forbidden"
      const [org] = await tx
        .select({
          host: organizations.host,
          name: organizations.name,
          campusName: organizations.campusName,
          theme: organizations.theme,
        })
        .from(organizations)
        .where(eq(organizations.id, input.orgId))
      const [admin] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.organizationId, input.orgId),
            eq(members.role, "admin"),
          ),
        )
        .limit(1)
      if (!org || admin) return "not_found"
      const [row] = await tx
        .update(invitations)
        .set({ expiresAt: invitationExpiry(now) })
        .where(
          and(
            eq(invitations.organizationId, input.orgId),
            eq(invitations.status, "pending"),
            eq(invitations.role, "admin"),
          ),
        )
        .returning({
          id: invitations.id,
          email: invitations.email,
          expiresAt: invitations.expiresAt,
        })
      if (!row) return "not_found"
      await tx.insert(auditLog).values({
        orgId: input.orgId,
        actorId: input.actorId,
        action: "member.invite_resend",
        entityType: "invitation",
        entityId: row.id,
        changedColumns: ["expires_at"],
      })
      return {
        invitation: row,
        tenant: { id: input.orgId, ...org },
      }
    },
  )
  if (typeof found === "string") return { ok: false, reason: found }
  const mail = await deliverInvitation(found.tenant, found.invitation, deps)
  return { ok: true, mail }
}
