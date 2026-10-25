import { Pool } from "pg"
import {
  type CampusField,
  type CampusInput,
  invitationExpiry,
  parseCampusForm,
  parseEmail,
} from "../shared/campus.ts"

type Created =
  | { ok: true; host: string }
  | { ok: false; reason: "taken" }
  | { ok: false; reason: "invalid"; fields: CampusField[] }

/** First campus row, no accounts. */
export async function createFirstCampus(
  pool: Pool,
  input: CampusInput,
  apexHost: string,
): Promise<Created> {
  const parsed = parseCampusForm(input)
  if (!parsed.ok) return { ok: false, reason: "invalid", fields: parsed.errors }
  const value = parsed.value
  const host = `${value.slug}.${apexHost}`
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, host, campus_code, campus_name, contact_email)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [
      value.name,
      value.slug,
      host,
      value.campusCode,
      value.campusName,
      value.contactEmail,
    ],
  )
  return result.rowCount === 1
    ? { ok: true, host }
    : { ok: false, reason: "taken" }
}

type Invited =
  | { ok: true }
  | {
      ok: false
      reason: "invalid" | "no_campus" | "not_superadmin" | "invited"
    }

/** Pending admin invite, superadmin inviter. */
export async function inviteFirstAdmin(
  pool: Pool,
  input: { slug: string; adminEmail: string; superadminEmail: string },
  now = new Date(),
): Promise<Invited> {
  const email = parseEmail(input.adminEmail)
  if (!email) return { ok: false, reason: "invalid" }
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const org = await client.query<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = $1",
      [input.slug.trim().toLowerCase()],
    )
    const orgId = org.rows[0]?.id
    if (!orgId) return await rollback(client, "no_campus")
    // audit_log has FORCE RLS
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId])
    const root = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = lower($1) AND superadmin",
      [input.superadminEmail.trim()],
    )
    const actorId = root.rows[0]?.id
    if (!actorId) return await rollback(client, "not_superadmin")
    const taken = await client.query(
      `SELECT 1 FROM members WHERE organization_id = $1 AND role = 'admin'
       UNION ALL
       SELECT 1 FROM invitations WHERE organization_id = $1 AND status = 'pending'`,
      [orgId],
    )
    if ((taken.rowCount ?? 0) > 0) return await rollback(client, "invited")
    const invite = await client.query<{ id: string }>(
      `INSERT INTO invitations (organization_id, email, role, status, expires_at, inviter_id)
       VALUES ($1, $2, 'admin', 'pending', $3, $4) RETURNING id`,
      [orgId, email, invitationExpiry(now), actorId],
    )
    await client.query(
      `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, changed_columns, reason_code)
       VALUES ($1, $2, 'member.invite', 'invitation', $3, '{invitations}', 'admin')`,
      [orgId, actorId, invite.rows[0]?.id],
    )
    await client.query("COMMIT")
    return { ok: true }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

async function rollback(
  client: { query: (sql: string) => Promise<unknown> },
  reason: Exclude<Extract<Invited, { ok: false }>["reason"], "invalid">,
): Promise<Invited> {
  await client.query("ROLLBACK")
  return { ok: false, reason }
}

const USAGE = `usage:
  bun db/first-campus.ts create <slug> <campus-code> <name> <campus-name> <admin-email> [contact-email]
  bun db/first-campus.ts invite <slug> <admin-email> <superadmin-email>`

async function run(
  pool: Pool,
  command: string | undefined,
  args: string[],
  apexHost: string | undefined,
): Promise<Created | Invited | null> {
  if (command === "create" && args.length >= 5) {
    const [
      slug = "",
      campusCode = "",
      name = "",
      campusName = "",
      adminEmail = "",
    ] = args
    if (!apexHost) throw new Error("APEX_HOST is not set")
    const input = { slug, campusCode, name, campusName, adminEmail }
    return createFirstCampus(
      pool,
      { ...input, contactEmail: args[5] ?? null },
      apexHost,
    )
  }
  if (command === "invite" && args.length === 3) {
    const [slug = "", adminEmail = "", superadminEmail = ""] = args
    return inviteFirstAdmin(pool, { slug, adminEmail, superadminEmail })
  }
  return null
}

/** CLI exit code. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const [command, ...args] = argv
  const pool = new Pool({ connectionString: env.DATABASE_MIGRATOR_URL })
  const result = await run(pool, command, args, env.APEX_HOST).finally(() =>
    pool.end(),
  )
  if (!result) {
    console.error(USAGE)
    return 2
  }
  console.log(JSON.stringify({ msg: "first campus", command, ...result }))
  return result.ok ? 0 : 1
}

// Production bootstrap, see infra/README.md
if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
