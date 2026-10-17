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

// bun db/superadmin.ts grant <email>
if (import.meta.main) {
  const [command, email] = process.argv.slice(2)
  if ((command !== "grant" && command !== "revoke") || !email) {
    console.error("usage: bun db/superadmin.ts grant|revoke <email>")
    process.exit(2)
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_MIGRATOR_URL })
  const found = await setSuperadmin(pool, email, command === "grant")
  await pool.end()
  if (!found) {
    console.error(
      JSON.stringify({ msg: "no account, sign in once first", command }),
    )
    process.exit(1)
  }
  console.log(JSON.stringify({ msg: "superadmin updated", command }))
}
