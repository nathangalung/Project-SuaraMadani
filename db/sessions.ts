import { Pool } from "pg"

/** Sessions ended, null without account. */
export async function revokeUserSessions(
  pool: Pool,
  email: string,
): Promise<number | null> {
  const user = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = lower($1)",
    [email.trim()],
  )
  const id = user.rows[0]?.id
  if (!id) return null
  const result = await pool.query("DELETE FROM sessions WHERE user_id = $1", [
    id,
  ])
  return result.rowCount ?? 0
}

/** Incident lever: everyone re-authenticates. */
export async function revokeAllSessions(pool: Pool): Promise<number> {
  const result = await pool.query("DELETE FROM sessions")
  return result.rowCount ?? 0
}

/** CLI exit code. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const [command, target] = argv
  if (command !== "revoke" || !target) {
    console.error("usage: bun db/sessions.ts revoke <email>|--all")
    return 2
  }
  const all = target === "--all"
  const pool = new Pool({ connectionString: env.DATABASE_MIGRATOR_URL })
  const ended = await (all
    ? revokeAllSessions(pool)
    : revokeUserSessions(pool, target)
  ).finally(() => pool.end())
  if (ended === null) {
    console.error(JSON.stringify({ msg: "no account", command }))
    return 1
  }
  console.log(JSON.stringify({ msg: "sessions revoked", all, ended }))
  return 0
}

// bun db/sessions.ts revoke <email>|--all
if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
