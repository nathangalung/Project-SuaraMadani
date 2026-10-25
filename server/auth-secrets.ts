// Better Auth hashes the string
const MIN_KEY_BYTES = 32
const NAME = "BETTER_AUTH_SECRETS"

export type AuthSecret = { version: number; value: string }

/** Upstream only warns, we refuse. */
export function parseAuthSecrets(value: string | undefined): AuthSecret[] {
  if (!value?.trim()) throw new Error(`${NAME} is not set`)
  const seen = new Set<number>()
  return value.split(",").map((entry) => {
    const colon = entry.indexOf(":")
    const version = Number(entry.slice(0, colon).trim())
    if (colon < 0 || !Number.isInteger(version) || version < 0) {
      throw new Error(`${NAME} entry needs <version>:<base64>`)
    }
    if (seen.has(version))
      throw new Error(`Duplicate ${NAME} version ${version}`)
    seen.add(version)
    const secret = entry.slice(colon + 1).trim()
    // Retired versions still decrypt
    if (Buffer.from(secret, "base64").length < MIN_KEY_BYTES) {
      throw new Error(`${NAME} version ${version} needs 32 bytes`)
    }
    return { version, value: secret }
  })
}
