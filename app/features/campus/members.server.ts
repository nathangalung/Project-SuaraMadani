import { and, asc, eq, inArray, lte, sql } from "drizzle-orm"
import { database } from "../../../db/client.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import {
  invitations,
  type MemberRole,
  members,
  sessions,
  users,
} from "../../../db/schema/auth.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { createEmailSender, type EmailSender } from "../../../server/email.ts"
import {
  addressHash,
  hashKey,
  reserveInvitation,
  sendLogged,
} from "../../../server/email-log.ts"
import { brandColor } from "../../../server/emails/layout.ts"
import { renderInvitationMail } from "../../../server/emails/render.ts"
import { errorRecord, writeError } from "../../../server/log.ts"
import { originFor } from "../../../server/origin.server.ts"
import {
  invitationExpiry,
  parseEmail,
  type RemovalRefusal,
  removalRefusal,
} from "../../../shared/campus.ts"
import { isUndeliverable } from "../../../shared/notifications.ts"

export type TeamDeps = {
  email: EmailSender
  now: () => Date
  origin: (host: string) => string
  hashKey: () => Buffer
}

export function teamDeps(): TeamDeps {
  return {
    email: createEmailSender(),
    now: () => new Date(),
    origin: originFor,
    hashKey,
  }
}

export type CampusTenant = {
  id: string
  host: string
  name: string
  campusName: string
  theme: Readonly<Record<string, unknown>>
}

// Editor waits for Phase 2
const STAFF: readonly MemberRole[] = ["editor", "admin"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type StaffMember = {
  userId: string
  email: string
  role: MemberRole
  twoFactor: boolean
  joinedAt: Date
}

export type PendingInvitation = {
  id: string
  email: string
  expiresAt: Date
  expired: boolean
}

/** Admins first, then email. */
export async function listTeam(
  orgId: string,
  now: Date,
): Promise<{ members: StaffMember[]; invitations: PendingInvitation[] }> {
  const { db } = database()
  const staff = await db
    .select({
      userId: members.userId,
      email: users.email,
      role: members.role,
      twoFactor: users.twoFactorEnabled,
      joinedAt: members.createdAt,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(eq(members.organizationId, orgId), inArray(members.role, [...STAFF])),
    )
    .orderBy(
      sql`CASE ${members.role} WHEN 'admin' THEN 0 ELSE 1 END`,
      asc(users.email),
    )
  const open = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, orgId),
        eq(invitations.status, "pending"),
      ),
    )
    .orderBy(asc(invitations.createdAt))
  return {
    members: staff,
    invitations: open.map((row) => ({
      ...row,
      expired: row.expiresAt.getTime() <= now.getTime(),
    })),
  }
}

type Refusal<R extends string> = { ok: false; reason: R }

async function isAdmin(tx: Tx, orgId: string, userId: string) {
  const [row] = await tx
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, userId)))
  return row?.role === "admin"
}

function audit(
  tx: Tx,
  row: {
    orgId: string
    actorId: string
    action:
      | "member.invite"
      | "member.invite_resend"
      | "member.invite_cancel"
      | "member.join"
      | "member.remove"
    entityType: "invitation" | "user"
    entityId: string
    changedColumns: string[]
    reasonCode?: string
  },
) {
  return tx.insert(auditLog).values(row)
}

export type Invitation = {
  id: string
  email: string
  expiresAt: Date
}

/** After commit, never rolled back. */
export async function deliverInvitation(
  tenant: CampusTenant,
  invitation: Invitation,
  deps: TeamDeps,
): Promise<InvitationMail> {
  const origin = deps.origin(tenant.host)
  const mail = renderInvitationMail({
    site: {
      name: `Sadar Bersuara - ${tenant.name}`,
      origin,
      brand: brandColor(tenant.theme.brand),
    },
    operator: tenant.name,
    url: `${origin}/undangan/${invitation.id}`,
    expiresAt: invitation.expiresAt,
  })
  // Same rule as worker
  if (isUndeliverable(invitation.email)) return "failed"
  try {
    const { db } = database()
    const slot = await reserveInvitation(
      db,
      addressHash(invitation.email, deps.hashKey()),
      deps.now(),
    )
    if (!slot.ok) return "limited"
    await sendLogged(db, {
      kind: "invitation",
      message: { to: invitation.email, ...mail },
      email: deps.email,
      key: deps.hashKey,
      logId: slot.logId,
    })
    return "sent"
  } catch (error) {
    writeError({ msg: "invitation email failed", ...errorRecord(error) })
    return "failed"
  }
}

// Limited: spacing, daily or quota
export type InvitationMail = "sent" | "failed" | "limited"

export type InviteResult =
  | { ok: true; invitationId: string; mail: InvitationMail }
  | Refusal<"forbidden" | "email" | "staff" | "pending">

export async function inviteMember(
  input: {
    tenant: CampusTenant
    actorId: string
    email: string
  },
  deps: TeamDeps = teamDeps(),
): Promise<InviteResult> {
  const email = parseEmail(input.email)
  if (!email) return { ok: false, reason: "email" }
  const orgId = input.tenant.id
  const now = deps.now()
  const created = await withTenant(
    orgId,
    async (tx): Promise<Invitation | "forbidden" | "staff" | "pending"> => {
      if (!(await isAdmin(tx, orgId, input.actorId))) return "forbidden"
      const [current] = await tx
        .select({ role: members.role })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(
          and(
            eq(members.organizationId, orgId),
            sql`lower(${users.email}) = ${email}`,
          ),
        )
      if (current && STAFF.includes(current.role)) return "staff"
      // Expired invites stop blocking
      await tx
        .update(invitations)
        .set({ status: "canceled" })
        .where(
          and(
            eq(invitations.organizationId, orgId),
            sql`lower(${invitations.email}) = ${email}`,
            eq(invitations.status, "pending"),
            lte(invitations.expiresAt, now),
          ),
        )
      const [row] = await tx
        .insert(invitations)
        .values({
          organizationId: orgId,
          email,
          role: "admin",
          status: "pending",
          expiresAt: invitationExpiry(now),
          inviterId: input.actorId,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: invitations.id, expiresAt: invitations.expiresAt })
      if (!row) return "pending"
      await audit(tx, {
        orgId,
        actorId: input.actorId,
        action: "member.invite",
        entityType: "invitation",
        entityId: row.id,
        changedColumns: ["invitations"],
        reasonCode: "admin",
      })
      return { id: row.id, email, expiresAt: row.expiresAt }
    },
    { role: "admin" },
  )
  if (typeof created === "string") return { ok: false, reason: created }
  const mail = await deliverInvitation(input.tenant, created, deps)
  return { ok: true, invitationId: created.id, mail }
}

type InvitationAction = {
  tenant: CampusTenant
  actorId: string
  invitationId: string
}

export async function resendInvitation(
  input: InvitationAction,
  deps: TeamDeps = teamDeps(),
): Promise<{ ok: true; mail: InvitationMail } | Refusal<"not_found">> {
  if (!UUID.test(input.invitationId)) return { ok: false, reason: "not_found" }
  const orgId = input.tenant.id
  const found = await withTenant(
    orgId,
    async (tx): Promise<Invitation | null> => {
      if (!(await isAdmin(tx, orgId, input.actorId))) return null
      const [row] = await tx
        .update(invitations)
        .set({ expiresAt: invitationExpiry(deps.now()) })
        .where(
          and(
            eq(invitations.id, input.invitationId),
            eq(invitations.organizationId, orgId),
            eq(invitations.status, "pending"),
          ),
        )
        .returning({
          id: invitations.id,
          email: invitations.email,
          expiresAt: invitations.expiresAt,
        })
      if (!row) return null
      await audit(tx, {
        orgId,
        actorId: input.actorId,
        action: "member.invite_resend",
        entityType: "invitation",
        entityId: row.id,
        changedColumns: ["expires_at"],
      })
      return row
    },
    { role: "admin" },
  )
  if (!found) return { ok: false, reason: "not_found" }
  return { ok: true, mail: await deliverInvitation(input.tenant, found, deps) }
}

export async function cancelInvitation(
  input: InvitationAction,
): Promise<{ ok: true } | Refusal<"not_found">> {
  if (!UUID.test(input.invitationId)) return { ok: false, reason: "not_found" }
  const orgId = input.tenant.id
  const done = await withTenant(
    orgId,
    async (tx) => {
      if (!(await isAdmin(tx, orgId, input.actorId))) return false
      const [row] = await tx
        .update(invitations)
        .set({ status: "canceled" })
        .where(
          and(
            eq(invitations.id, input.invitationId),
            eq(invitations.organizationId, orgId),
            eq(invitations.status, "pending"),
          ),
        )
        .returning({ id: invitations.id })
      if (!row) return false
      await audit(tx, {
        orgId,
        actorId: input.actorId,
        action: "member.invite_cancel",
        entityType: "invitation",
        entityId: row.id,
        changedColumns: ["status"],
      })
      return true
    },
    { role: "admin" },
  )
  return done ? { ok: true } : { ok: false, reason: "not_found" }
}

export type InvitationView = {
  email: string
  status: "pending" | "accepted" | "canceled"
  expiresAt: Date
}

/** This campus only, by Host. */
export async function readInvitation(
  orgId: string,
  invitationId: string,
): Promise<InvitationView | null> {
  if (!UUID.test(invitationId)) return null
  const [row] = await database()
    .db.select({
      email: invitations.email,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.id, invitationId),
        eq(invitations.organizationId, orgId),
      ),
    )
  return row ?? null
}

export type AcceptResult =
  | { ok: true; role: "admin" }
  | Refusal<"not_found" | "used" | "expired" | "email" | "unverified">

/** Signed-in invitee, same address. */
export function acceptInvitation(input: {
  tenant: { id: string }
  invitationId: string
  user: { id: string; email: string; emailVerified: boolean }
  now: Date
}): Promise<AcceptResult> {
  if (!UUID.test(input.invitationId)) {
    return Promise.resolve({ ok: false, reason: "not_found" })
  }
  const orgId = input.tenant.id
  return withTenant(
    orgId,
    async (tx): Promise<AcceptResult> => {
      const [row] = await tx
        .select({
          email: invitations.email,
          status: invitations.status,
          expiresAt: invitations.expiresAt,
        })
        .from(invitations)
        .where(
          and(
            eq(invitations.id, input.invitationId),
            eq(invitations.organizationId, orgId),
          ),
        )
        .for("update")
      if (!row || row.status === "canceled") {
        return { ok: false, reason: "not_found" }
      }
      if (row.status === "accepted") return { ok: false, reason: "used" }
      if (row.expiresAt.getTime() <= input.now.getTime()) {
        return { ok: false, reason: "expired" }
      }
      if (row.email.toLowerCase() !== input.user.email.trim().toLowerCase()) {
        return { ok: false, reason: "email" }
      }
      // Proven address only, no pre-hijack
      if (!input.user.emailVerified) return { ok: false, reason: "unverified" }
      const role = "admin"
      await tx
        .insert(members)
        .values({ organizationId: orgId, userId: input.user.id, role })
        .onConflictDoUpdate({
          target: [members.organizationId, members.userId],
          set: { role },
        })
      await tx
        .update(invitations)
        .set({ status: "accepted" })
        .where(eq(invitations.id, input.invitationId))
      await audit(tx, {
        orgId,
        actorId: input.user.id,
        action: "member.join",
        entityType: "user",
        entityId: input.user.id,
        changedColumns: ["role"],
        reasonCode: role,
      })
      return { ok: true, role }
    },
    { role: "reporter" },
  )
}

type MemberAction = {
  tenant: { id: string }
  actorId: string
  userId: string
}

export type TeamResult =
  | { ok: true }
  | Refusal<"forbidden" | "not_found" | RemovalRefusal>

/** Admin rows locked, fixed order. */
async function lockAdmins(tx: Tx, orgId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.role, "admin")))
    .orderBy(asc(members.userId))
    .for("update")
  return rows.map((row) => row.userId)
}

/** Removed admins stay reporters. */
export function removeMember(input: MemberAction): Promise<TeamResult> {
  if (!UUID.test(input.userId)) {
    return Promise.resolve({ ok: false, reason: "not_found" })
  }
  const orgId = input.tenant.id
  return withTenant(
    orgId,
    async (tx): Promise<TeamResult> => {
      const admins = await lockAdmins(tx, orgId)
      if (!admins.includes(input.actorId)) {
        return { ok: false, reason: "forbidden" }
      }
      const [target] = await tx
        .select({ role: members.role })
        .from(members)
        .where(
          and(
            eq(members.organizationId, orgId),
            eq(members.userId, input.userId),
          ),
        )
        .for("update")
      if (!target || !STAFF.includes(target.role)) {
        return { ok: false, reason: "not_found" }
      }
      const refusal = removalRefusal(admins, input.actorId, input.userId)
      if (refusal) return { ok: false, reason: refusal }
      await tx
        .update(members)
        .set({ role: "reporter" })
        .where(
          and(
            eq(members.organizationId, orgId),
            eq(members.userId, input.userId),
          ),
        )
      await tx.delete(sessions).where(eq(sessions.userId, input.userId))
      await audit(tx, {
        orgId,
        actorId: input.actorId,
        action: "member.remove",
        entityType: "user",
        entityId: input.userId,
        changedColumns: ["role", "sessions"],
        reasonCode: "reporter",
      })
      return { ok: true }
    },
    { role: "admin" },
  )
}
