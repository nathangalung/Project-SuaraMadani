import { createHmac, timingSafeEqual } from "node:crypto"

// Item 16: 30 days
export const LINK_TTL_MS = 30 * 86_400_000

export type LinkPurpose =
  | "lacak"
  | "berhenti"
  | "berhenti-tuntutan"
  // Reporter survey, per claim
  | "survei"

export type Keyring = { current: number; keys: ReadonlyMap<number, Buffer> }

export type LinkClaim = {
  purpose: LinkPurpose
  orgId: string
  subjectId: string
  userId: string
  expiresAt: Date
}

const MAX_TOKEN_LENGTH = 512
const MIN_KEY_BYTES = 32
const ID = /^[0-9a-f-]{36}$/

/** Same format as BETTER_AUTH_SECRETS. */
export function parseKeyring(value: string | undefined): Keyring {
  if (!value?.trim()) throw new Error("LACAK_LINK_KEYS is not set")
  const keys = new Map<number, Buffer>()
  let current: number | undefined
  for (const entry of value.split(",")) {
    const colon = entry.indexOf(":")
    const version = Number(entry.slice(0, colon).trim())
    if (colon < 0 || !Number.isInteger(version) || version < 0) {
      throw new Error("LACAK_LINK_KEYS entry needs <version>:<base64>")
    }
    if (keys.has(version)) throw new Error(`Duplicate key version ${version}`)
    const key = Buffer.from(entry.slice(colon + 1).trim(), "base64")
    if (key.length < MIN_KEY_BYTES) {
      throw new Error(`LACAK_LINK_KEYS version ${version} needs 32 bytes`)
    }
    keys.set(version, key)
    current ??= version
  }
  if (current === undefined) throw new Error("LACAK_LINK_KEYS is not set")
  return { current, keys }
}

let envKeyring: Keyring | undefined

/** Lazy, fails closed when unset. */
export function linkKeyring(): Keyring {
  envKeyring ??= parseKeyring(process.env.LACAK_LINK_KEYS)
  return envKeyring
}

export function linkExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + LINK_TTL_MS)
}

function mac(key: Buffer, version: number, body: string): Buffer {
  return createHmac("sha256", key).update(`${version}.${body}`).digest()
}

export function signLink(keyring: Keyring, claim: LinkClaim): string {
  const key = keyring.keys.get(keyring.current)
  if (!key) throw new Error("current link key missing")
  const seconds = Math.floor(claim.expiresAt.getTime() / 1000)
  const body = Buffer.from(
    [claim.purpose, claim.orgId, claim.subjectId, claim.userId, seconds].join(
      "|",
    ),
  ).toString("base64url")
  const sig = mac(key, keyring.current, body).toString("base64url")
  return `${keyring.current}.${body}.${sig}`
}

/** Null for any bad token. */
export function verifyLink(
  keyring: Keyring,
  token: string,
  expected: { purpose: LinkPurpose; orgId: string; now: Date },
): { subjectId: string; userId: string } | null {
  if (token.length > MAX_TOKEN_LENGTH) return null
  const [versionText, body, sig, extra] = token.split(".")
  if (!versionText || !body || !sig || extra !== undefined) return null
  const version = Number(versionText)
  const key = keyring.keys.get(version)
  if (!key) return null
  const given = Buffer.from(sig, "base64url")
  const wanted = mac(key, version, body)
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return null
  }
  const [purpose, orgId, subjectId, userId, seconds, rest] = Buffer.from(
    body,
    "base64url",
  )
    .toString()
    .split("|")
  if (rest !== undefined || !subjectId || !userId) return null
  if (purpose !== expected.purpose || orgId !== expected.orgId) return null
  if (!ID.test(subjectId) || !ID.test(userId)) return null
  if (Number(seconds) * 1000 <= expected.now.getTime()) return null
  return { subjectId, userId }
}
