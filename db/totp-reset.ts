import { Pool } from "pg"

type Reset = { ok: true } | { ok: false; reason: "no_account" | "not_enrolled" }

/** Runbook identity check comes first. */
export async function resetTotp(pool: Pool, email: string): Promise<Reset> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const user = await client.query<{ id: string; enabled: boolean }>(
      "SELECT id, two_factor_enabled AS enabled FROM users WHERE lower(email) = lower($1) FOR UPDATE",
      [email.trim()],
    )
    const row = user.rows[0]
    const removed = row
      ? await client.query("DELETE FROM two_factors WHERE user_id = $1", [
          row.id,
        ])
      : null
    if (!row || (!row.enabled && removed?.rowCount === 0)) {
      await client.query("ROLLBACK")
      return { ok: false, reason: row ? "not_enrolled" : "no_account" }
    }
    // updated_at bump ends staff access
    await client.query(
      "UPDATE users SET two_factor_enabled = false, updated_at = now() WHERE id = $1",
      [row.id],
    )
    await client.query("DELETE FROM sessions WHERE user_id = $1", [row.id])
    const orgs = await client.query<{ id: string }>(
      "SELECT organization_id AS id FROM members WHERE user_id = $1",
      [row.id],
    )
    for (const org of orgs.rows) {
      // audit_log has FORCE RLS
      await client.query("SELECT set_config('app.org_id', $1, true)", [org.id])
      await client.query(
        `INSERT INTO audit_log (org_id, action, entity_type, entity_id, changed_columns)
         VALUES ($1, 'member.totp_reset', 'user', $2, '{two_factors,sessions}')`,
        [org.id, row.id],
      )
    }
    await client.query("COMMIT")
    return { ok: true }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

/** CLI exit code. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const [email] = argv
  if (!email) {
    console.error("usage: bun db/totp-reset.ts <email>")
    return 2
  }
  const pool = new Pool({ connectionString: env.DATABASE_MIGRATOR_URL })
  const result = await resetTotp(pool, email).finally(() => pool.end())
  console.log(JSON.stringify({ msg: "totp reset", ...result }))
  return result.ok ? 0 : 1
}

// bun db/totp-reset.ts <email>
if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
