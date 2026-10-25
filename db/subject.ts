import type { Pool, PoolClient } from "pg"

// UU PDP access, erasure, DPO

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

export type SubjectData = {
  account: Tables
  // Campus slug, then table
  campuses: Record<string, Tables>
}

type Lookup = { ok: false; reason: "no_account" }

// Credentials never leave the database
const ACCOUNT_SQL: Record<string, string> = {
  users: `SELECT id, name, email, email_verified, phone_number, phone_verified,
    image, created_at, updated_at, age_declared_at, age_consent_version,
    two_factor_enabled FROM users WHERE id = $1`,
  sessions: `SELECT created_at, updated_at, expires_at, ip_address, user_agent
    FROM sessions WHERE user_id = $1 ORDER BY created_at`,
  accounts: `SELECT provider_id, created_at, updated_at FROM accounts
    WHERE user_id = $1 ORDER BY created_at`,
  passkeys: `SELECT name, device_type, backed_up, created_at FROM passkeys
    WHERE user_id = $1 ORDER BY created_at`,
  members: `SELECT o.slug AS campus, m.role, m.created_at FROM members m
    JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = $1`,
  invitations: `SELECT o.slug AS campus, i.role, i.status, i.created_at,
    i.expires_at FROM invitations i
    JOIN organizations o ON o.id = i.organization_id
    WHERE lower(i.email) = lower($1)`,
}
// Invitations match the address
const BY_EMAIL = new Set(["invitations"])

// Children of the subject's reports
const REPORT_CHILDREN = ["report_contacts", "evidence"] as const

async function findUser(
  client: PoolClient,
  identifier: string,
): Promise<{ id: string; email: string; superadmin: boolean } | null> {
  const { rows } = await client.query<{
    id: string
    email: string
    superadmin: boolean
  }>(
    `SELECT id, email, superadmin FROM users
     WHERE lower(email) = lower($1) OR phone_number = $1 FOR UPDATE`,
    [identifier.trim()],
  )
  return rows[0] ?? null
}

/** Tenant tables keyed by user_id. */
async function tenantTables(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'user_id'
       AND EXISTS (SELECT 1 FROM information_schema.columns o
         WHERE o.table_schema = 'public' AND o.table_name = c.table_name
           AND o.column_name = 'org_id')
     ORDER BY c.table_name`,
  )
  return rows.map((row) => row.table_name)
}

async function organizations(
  client: PoolClient,
): Promise<{ id: string; slug: string }[]> {
  const { rows } = await client.query<{ id: string; slug: string }>(
    "SELECT id, slug FROM organizations ORDER BY slug",
  )
  return rows
}

/** FORCE RLS binds the owner. */
async function asTenant(client: PoolClient, orgId: string): Promise<void> {
  // DPO reads contacts as admin
  await client.query(
    "SELECT set_config('app.org_id', $1, true), set_config('app.member_role', 'admin', true)",
    [orgId],
  )
}

async function rowsOf(
  client: PoolClient,
  table: string,
  where: string,
  values: unknown[],
): Promise<Row[]> {
  const { rows } = await client.query<{ row: Row }>(
    `SELECT row_to_json(t) AS row FROM ${client.escapeIdentifier(table)} t WHERE ${where}`,
    values,
  )
  return rows.map((row) => row.row)
}

async function campusData(
  client: PoolClient,
  userId: string,
): Promise<Record<string, Tables>> {
  const tables = await tenantTables(client)
  const campuses: Record<string, Tables> = {}
  for (const org of await organizations(client)) {
    await asTenant(client, org.id)
    const found: Tables = {}
    for (const table of tables) {
      const rows = await rowsOf(client, table, "t.user_id = $1", [userId])
      if (rows.length > 0) found[table] = rows
    }
    const reportIds = (found.reports ?? []).map((row) => row.id)
    for (const table of reportIds.length > 0 ? REPORT_CHILDREN : []) {
      const rows = await rowsOf(client, table, "t.report_id = ANY($1)", [
        reportIds,
      ])
      if (rows.length > 0) found[table] = rows
    }
    if (Object.keys(found).length > 0) campuses[org.slug] = found
  }
  return campuses
}

async function inTransaction<T>(
  pool: Pool,
  begin: string,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query(begin)
    const result = await run(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

/** One snapshot, read only. */
export function exportSubject(
  pool: Pool,
  identifier: string,
): Promise<{ ok: true; data: SubjectData } | Lookup> {
  return inTransaction(
    pool,
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    async (client) => {
      // Read only: no row lock
      const { rows } = await client.query<{ id: string; email: string }>(
        "SELECT id, email FROM users WHERE lower(email) = lower($1) OR phone_number = $1",
        [identifier.trim()],
      )
      const user = rows[0]
      if (!user) return { ok: false, reason: "no_account" } as const
      const account: Tables = {}
      for (const [name, query] of Object.entries(ACCOUNT_SQL)) {
        const value = BY_EMAIL.has(name) ? user.email : user.id
        account[name] = (await client.query<Row>(query, [value])).rows
      }
      return {
        ok: true,
        data: { account, campuses: await campusData(client, user.id) },
      } as const
    },
  )
}

export type DeleteResult =
  | { ok: true; userId: string; campuses: string[] }
  | Lookup
  | { ok: false; reason: "has_reports" | "staff"; campuses: string[] }
  | { ok: false; reason: "superadmin" }

/** Global row after campus checks. */
export function deleteSubject(
  pool: Pool,
  identifier: string,
): Promise<DeleteResult> {
  return inTransaction(pool, "BEGIN", async (client) => {
    const user = await findUser(client, identifier)
    if (!user) return { ok: false, reason: "no_account" } as const
    if (user.superadmin) return { ok: false, reason: "superadmin" } as const
    // Reporter rows go too
    const staff = await client.query<{ slug: string }>(
      `SELECT o.slug FROM members m JOIN organizations o
       ON o.id = m.organization_id
       WHERE m.user_id = $1 AND m.role <> 'reporter' ORDER BY o.slug`,
      [user.id],
    )
    if (staff.rows.length > 0) {
      return {
        ok: false,
        reason: "staff",
        campuses: staff.rows.map((row) => row.slug),
      } as const
    }
    const tables = await tenantTables(client)
    const joined = await client.query<{ id: string }>(
      "SELECT organization_id AS id FROM members WHERE user_id = $1",
      [user.id],
    )
    const member = new Set(joined.rows.map((row) => row.id))
    const touched: { id: string; slug: string }[] = []
    const withReports: string[] = []
    for (const org of await organizations(client)) {
      await asTenant(client, org.id)
      let any = member.has(org.id)
      for (const table of tables) {
        const { rows } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${client.escapeIdentifier(table)} WHERE user_id = $1`,
          [user.id],
        )
        const n = rows[0]?.n ?? 0
        if (n > 0 && table === "reports") withReports.push(org.slug)
        any ||= n > 0
      }
      if (any) touched.push(org)
    }
    // closeAccount runs first per campus
    if (withReports.length > 0) {
      return {
        ok: false,
        reason: "has_reports",
        campuses: withReports,
      } as const
    }
    for (const org of touched) {
      await asTenant(client, org.id)
      await client.query(
        `INSERT INTO audit_log (org_id, action, entity_type, entity_id, changed_columns)
         VALUES ($1, 'account.delete', 'user', $2, '{users}')`,
        [org.id, user.id],
      )
    }
    // Cascades and SET NULL follow
    await client.query("DELETE FROM users WHERE id = $1", [user.id])
    return {
      ok: true,
      userId: user.id,
      campuses: touched.map((org) => org.slug),
    } as const
  })
}

const USAGE =
  "usage: bun db/subject.ts export <email|phone> | delete <email|phone> --confirm"

/** CLI exit code. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const [command, identifier, flag] = argv
  if ((command !== "export" && command !== "delete") || !identifier) {
    console.error(USAGE)
    return 2
  }
  if (command === "delete" && flag !== "--confirm") {
    console.error("delete needs --confirm after the runbook checks")
    return 2
  }
  const { Pool: PgPool } = await import("pg")
  const pool = new PgPool({ connectionString: env.DATABASE_MIGRATOR_URL })
  try {
    if (command === "export") {
      const result = await exportSubject(pool, identifier)
      if (!result.ok) {
        console.error(JSON.stringify({ msg: "subject export", ...result }))
        return 1
      }
      console.log(JSON.stringify(result.data, null, 2))
      return 0
    }
    const result = await deleteSubject(pool, identifier)
    // Receipt for the DPO log
    console.log(JSON.stringify({ msg: "subject delete", ...result }))
    return result.ok ? 0 : 1
  } finally {
    await pool.end()
  }
}

// bun db/subject.ts export|delete <email|phone> [--confirm]
if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
