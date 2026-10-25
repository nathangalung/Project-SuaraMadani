import { Pool } from "pg"

/** Existing account only, by email. */
export async function setSuperadmin(
  pool: Pool,
  email: string,
  on: boolean,
): Promise<boolean> {
  const result = await pool.query(
    "UPDATE users SET superadmin = $2, updated_at = now() WHERE lower(email) = lower($1)",
    [email.trim(), on],
  )
  return result.rowCount === 1
}

/** CLI exit code. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const [command, email] = argv
  if ((command !== "grant" && command !== "revoke") || !email) {
    console.error("usage: bun db/superadmin.ts grant|revoke <email>")
    return 2
  }
  const pool = new Pool({ connectionString: env.DATABASE_MIGRATOR_URL })
  const found = await setSuperadmin(pool, email, command === "grant").finally(
    () => pool.end(),
  )
  if (!found) {
    console.error(
      JSON.stringify({ msg: "no account, sign in once first", command }),
    )
    return 1
  }
  console.log(JSON.stringify({ msg: "superadmin updated", command }))
  return 0
}

// bun db/superadmin.ts grant <email>
if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
