import { createHmac, timingSafeEqual } from "node:crypto"

// Better Auth defaults, window 1
const PERIOD_MS = 30_000
const DIGITS = 6

/** RFC 4226, key as UTF-8. */
function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac("sha1", secret).update(message).digest()
  const offset = (mac.at(-1) ?? 0) & 0xf
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS
  return String(value).padStart(DIGITS, "0")
}

/** Step the code belongs to. */
export function matchedStep(
  secret: string,
  code: string,
  now: number,
): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const current = Math.floor(now / PERIOD_MS)
  for (const step of [current + 1, current, current - 1]) {
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) {
      return step
    }
  }
  return null
}
