// Bun: verified staff cookies
// bun --env-file=.env e2e/staff-session.ts <host>
import { createHmac } from "node:crypto"
import { eq } from "drizzle-orm"
import { Pool } from "pg"
import { database } from "../db/client.server.ts"
import { members, twoFactors, users } from "../db/schema/auth.ts"
import { organizations } from "../db/schema/organizations.ts"
import { setSuperadmin } from "../db/superadmin.ts"
import { accountClient, jar } from "./sign-in.ts"

// Reserved domain, never mailed
const STAFF = {
  email: "e2e-staf@contoh.test",
  phone: "+6281200000999",
  name: "Staf Uji",
}
const host = process.argv[2] ?? "itb.localhost"
const { db, post, signIn } = accountClient(host)

function totp(secret: string, at: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const char of secret.toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0")
  }
  const key = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)),
  )
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const mac = createHmac("sha1", key).update(counter).digest()
  const offset = (mac.at(-1) ?? 0) & 0xf
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  )
}

// Fresh account each run
await db.delete(users).where(eq(users.email, STAFF.email))
await db.delete(users).where(eq(users.phoneNumber, STAFF.phone))
const first = jar(await signIn(STAFF))
const enable = await post("/two-factor/enable", {}, first)
const { totpURI } = (await enable.json()) as { totpURI: string }
const secret = new URL(totpURI).searchParams.get("secret") ?? ""
await post("/two-factor/verify-totp", { code: totp(secret, Date.now()) }, first)
const [org] = await db
  .select({ id: organizations.id })
  .from(organizations)
  .where(eq(organizations.host, host))
const [user] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.email, STAFF.email))
if (!org || !user) throw new Error(`no campus at ${host}`)
await db
  .insert(members)
  .values({ organizationId: org.id, userId: user.id, role: "admin" })
// /admin pages, CLI path
const migrator = new Pool({
  connectionString: process.env.DATABASE_MIGRATOR_URL,
})
await setSuperadmin(migrator, STAFF.email, true)
await migrator.end()
// Session must postdate enrolment
await Bun.sleep(1100)
const again = jar(await signIn(STAFF))
// Enrolment spent this step
await db
  .update(twoFactors)
  .set({ lastTotpStep: null })
  .where(eq(twoFactors.userId, user.id))
const staff = await post(
  "/two-factor/verify-totp",
  { code: totp(secret, Date.now()) },
  again,
)
console.log(JSON.stringify({ cookie: jar(staff) }))
await database().pool.end()
