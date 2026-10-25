import {
  parseEnvelope,
  type SecretConfig,
  symmetricDecrypt,
  symmetricEncrypt,
} from "better-auth/crypto"
import { Pool } from "pg"
import { type AuthSecret, parseAuthSecrets } from "../server/auth-secrets.ts"

/** Better Auth keyring, newest first. */
export function secretConfig(secrets: readonly AuthSecret[]): SecretConfig {
  const [current] = secrets
  if (!current) throw new Error("BETTER_AUTH_SECRETS is empty")
  return {
    keys: new Map(secrets.map((s) => [s.version, s.value])),
    currentVersion: current.version,
  }
}

type Sealed = string | null

/** New envelope, same, or unreadable. */
async function reseal(value: string, key: SecretConfig): Promise<Sealed> {
  const envelope = parseEnvelope(value)
  // Plain or hashed: nothing sealed
  if (!envelope || envelope.version === key.currentVersion) return value
  if (!key.keys.has(envelope.version)) return null
  const data = await symmetricDecrypt({ key, data: value })
  return symmetricEncrypt({ key, data })
}

/** ASVS V11.2.2: re-encrypt before retiring. */
export async function resealTwoFactors(
  pool: Pool,
  secrets: readonly AuthSecret[],
): Promise<{ resealed: number; stale: number }> {
  const key = secretConfig(secrets)
  const client = await pool.connect()
  let resealed = 0
  let stale = 0
  try {
    await client.query("BEGIN")
    const { rows } = await client.query<{
      id: string
      secret: string
      backup_codes: string
    }>("SELECT id, secret, backup_codes FROM two_factors FOR UPDATE")
    for (const row of rows) {
      const secret = await reseal(row.secret, key)
      const codes = await reseal(row.backup_codes, key)
      if (secret === null || codes === null) {
        stale++
        continue
      }
      if (secret === row.secret && codes === row.backup_codes) continue
      await client.query(
        "UPDATE two_factors SET secret = $2, backup_codes = $3 WHERE id = $1",
        [row.id, secret, codes],
      )
      resealed++
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
  return { resealed, stale }
}

/** CLI exit code. */
export async function main(
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const secrets = parseAuthSecrets(env.BETTER_AUTH_SECRETS)
  const pool = new Pool({ connectionString: env.DATABASE_MIGRATOR_URL })
  const result = await resealTwoFactors(pool, secrets).finally(() => pool.end())
  console.log(JSON.stringify({ msg: "two_factors resealed", ...result }))
  // Unreadable rows block retirement
  return result.stale > 0 ? 1 : 0
}

// Run before dropping a version
if (import.meta.main) process.exitCode = await main()
