import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// AES-256-GCM, purpose as AAD
const NONCE_BYTES = 12
const TAG_BYTES = 16

export type SealPurpose = "job" | "creds"

/** Base64 env key, 32 bytes. */
export function parseSealKey(value: string | undefined, name: string): Buffer {
  if (!value?.trim()) throw new Error(`${name} is not set`)
  const key = Buffer.from(value.trim(), "base64")
  if (key.length !== 32) throw new Error(`${name} needs 32 bytes`)
  return key
}

export function sealBytes(
  plain: Buffer,
  key: Buffer,
  purpose: SealPurpose,
): Buffer {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(Buffer.from(purpose))
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([nonce, body, cipher.getAuthTag()])
}

export function openBytes(
  sealed: Buffer,
  key: Buffer,
  purpose: SealPurpose,
): Buffer {
  const nonce = sealed.subarray(0, NONCE_BYTES)
  const tag = sealed.subarray(sealed.length - TAG_BYTES)
  const body = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES)
  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAAD(Buffer.from(purpose))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}

/** JSON in, base64url out. */
export function seal(
  value: unknown,
  key: Buffer,
  purpose: SealPurpose,
): string {
  const plain = Buffer.from(JSON.stringify(value))
  return sealBytes(plain, key, purpose).toString("base64url")
}

export function openSealed(
  sealed: string,
  key: Buffer,
  purpose: SealPurpose,
): unknown {
  const plain = openBytes(Buffer.from(sealed, "base64url"), key, purpose)
  return JSON.parse(plain.toString("utf8"))
}
