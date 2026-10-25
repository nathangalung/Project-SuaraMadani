import { and, eq, sql } from "drizzle-orm"
import { database } from "../../../db/client.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { members } from "../../../db/schema/auth.ts"
import {
  type OrgSettings,
  type OrgTheme,
  organizations,
} from "../../../db/schema/organizations.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { globalIntakePause } from "../../../server/intake.server.ts"
import type { IdentityInput } from "../../../shared/campus.ts"

type Actor = { tenant: { id: string }; actorId: string }
type Result<R extends string = "forbidden"> =
  | { ok: true }
  | { ok: false; reason: R }

const STATUS_URL_MAX = 200
const LOGO_FILE = /^([0-9a-f]{16})\.webp$/

async function isAdmin(tx: Tx, orgId: string, userId: string) {
  const [row] = await tx
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, userId)))
  return row?.role === "admin"
}

type Change = {
  ok: true
  action:
    | "settings.theme"
    | "settings.logo"
    | "settings.intake_pause"
    | "settings.identity"
  columns: string[]
  reason?: string
}

/** Admin check, audit, one transaction. */
function asAdmin<R extends string = never>(
  input: Actor,
  change: (tx: Tx) => Promise<Change | { ok: false; reason: R }>,
): Promise<Result<R | "forbidden">> {
  const orgId = input.tenant.id
  return withTenant(
    orgId,
    async (tx): Promise<Result<R | "forbidden">> => {
      if (!(await isAdmin(tx, orgId, input.actorId))) {
        return { ok: false, reason: "forbidden" }
      }
      const done = await change(tx)
      if (!done.ok) return done
      await tx.insert(auditLog).values({
        orgId,
        actorId: input.actorId,
        action: done.action,
        entityType: "organization",
        entityId: orgId,
        changedColumns: done.columns,
        reasonCode: done.reason,
      })
      return { ok: true }
    },
    { role: "admin" },
  )
}

export type CampusSettings = {
  theme: OrgTheme
  intakePaused: boolean
  // INTAKE_PAUSED overrides campus
  globalPause: boolean
  statusUrl: string | null
  logoFile: string | null
  identity: IdentityInput
}

/** Fresh row, not cached tenant. */
export async function readSettings(orgId: string): Promise<CampusSettings> {
  const [row] = await database()
    .db.select({
      theme: organizations.theme,
      settings: organizations.settings,
      logoHash: organizations.logoHash,
      name: organizations.name,
      campusName: organizations.campusName,
      contactEmail: organizations.contactEmail,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
  if (!row) throw new Error("organization not found")
  return {
    theme: row.theme,
    intakePaused: row.settings.intakePaused === true,
    globalPause: globalIntakePause(),
    statusUrl: row.settings.statusUrl ?? null,
    logoFile: row.logoHash ? `${row.logoHash}.webp` : null,
    identity: {
      name: row.name,
      campusName: row.campusName,
      contactEmail: row.contactEmail,
      alliance: row.settings.alliance ?? null,
      legalNumber: row.settings.legalNumber ?? null,
      credit: row.settings.credit ?? null,
      officers: row.settings.officers ?? [],
    },
  }
}

/** Https only, like footer link. */
function parseStatusUrl(value: string): string | null | "invalid" {
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (trimmed.length > STATUS_URL_MAX) return "invalid"
  try {
    const url = new URL(trimmed)
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "invalid"
  } catch {
    return "invalid"
  }
}

export function setIntakePause(
  input: Actor & { paused: boolean; statusUrl: string },
): Promise<Result<"status_url" | "forbidden">> {
  const statusUrl = parseStatusUrl(input.statusUrl)
  if (statusUrl === "invalid") {
    return Promise.resolve({ ok: false, reason: "status_url" })
  }
  return asAdmin<"status_url">(input, async (tx) => {
    const [before] = await tx
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, input.tenant.id))
      .for("update")
    const previous: OrgSettings = before?.settings ?? {}
    // Merge, never replace facts
    const patch = sql`jsonb_build_object('intakePaused', ${input.paused}::boolean)`
    await tx
      .update(organizations)
      .set({
        settings:
          statusUrl === null
            ? sql`(${organizations.settings} - 'statusUrl') || ${patch}`
            : sql`${organizations.settings} || ${patch} || jsonb_build_object('statusUrl', ${statusUrl}::text)`,
      })
      .where(eq(organizations.id, input.tenant.id))
    const columns = ["intakePaused"]
    if ((previous.statusUrl ?? null) !== statusUrl) columns.push("statusUrl")
    return {
      ok: true,
      action: "settings.intake_pause",
      columns,
      reason: input.paused ? "paused" : "resumed",
    }
  })
}

/** Current logo only, by hash. */
export async function readLogo(
  orgId: string,
  file: string,
): Promise<Buffer | null> {
  const hash = LOGO_FILE.exec(file)?.[1]
  if (!hash) return null
  const [row] = await database()
    .db.select({ bytes: organizations.logoBytes })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.logoHash, hash)))
  return row?.bytes ?? null
}
