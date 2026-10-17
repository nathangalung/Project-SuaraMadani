// Bun: verified staff cookies
// bun --env-file=.env e2e/staff-session.ts <host>
import { createHmac } from "node:crypto"
import { eq } from "drizzle-orm"
import { Pool } from "pg"
import { database } from "../db/client.server.ts"
import { members, users } from "../db/schema/auth.ts"
import { emailLog } from "../db/schema/notifications.ts"
import { organizations } from "../db/schema/organizations.ts"
import { setSuperadmin } from "../db/superadmin.ts"
import { createAuth } from "../server/auth.server.ts"
import { addressHash, hashKey } from "../server/email-log.ts"
import { AGE_CONSENT_VERSION } from "../shared/report-fields.ts"

// Reserved domain, never mailed
const EMAIL = "e2e-staf@contoh.test"
const PHONE = "+6281200000999"
const host = process.argv[2] ?? "itb.localhost"
const origin = `https://${host}`
const sent: { to: string; text: string }[] = []
const { db } = database()
const auth = createAuth({
  db,
  hosts: [host],
  dev: false,
  email: { send: async (message) => void sent.push(message) },
  hashKey,
  verifyCaptcha: async () => ({ ok: true }),
  // Codes by email only
  whatsapp: {
    ready: async () => false,
    sendCode: async () => ({ ok: false, reason: "unavailable" }),
    status: async () => null,
  },
})

async function post(path: string, body: unknown, cookie = "") {
  const res = await auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify(body),
    }),
  )
  if (res.status !== 200) throw new Error(`${path} ${res.status}`)
  return res
}

const jar = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => !c.endsWith("="))
    .join("; ")

async function signIn(): Promise<Response> {
  // Per-address caps, own rows only
  await db
    .delete(emailLog)
    .where(eq(emailLog.addressHash, addressHash(EMAIL, hashKey())))
  const [known] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, EMAIL))
  const body = known
    ? { mode: "sign-in", identifier: EMAIL, channel: "email" }
    : {
        mode: "sign-up",
        name: "Staf Uji",
        email: EMAIL,
        phone: PHONE,
        channel: "email",
      }
  await post("/account/send-code", body)
  await Bun.sleep(50)
  const code = /\b(\d{6})\b/.exec(
    sent.findLast((m) => m.to === EMAIL)?.text ?? "",
  )?.[1]
  return post("/account/verify-code", {
    ...body,
    code,
    ...(known
      ? {}
      : {
          ageDeclaration: {
            age_18_plus: true,
            ageConsentVersion: AGE_CONSENT_VERSION,
          },
        }),
  })
}

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
await db.delete(users).where(eq(users.email, EMAIL))
await db.delete(users).where(eq(users.phoneNumber, PHONE))
const first = jar(await signIn())
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
  .where(eq(users.email, EMAIL))
if (!org || !user) throw new Error(`no campus at ${host}`)
await db
  .insert(members)
  .values({ organizationId: org.id, userId: user.id, role: "admin" })
// /admin pages, CLI path
const migrator = new Pool({
  connectionString: process.env.DATABASE_MIGRATOR_URL,
})
await setSuperadmin(migrator, EMAIL, true)
await migrator.end()
// Session must postdate enrolment
await Bun.sleep(1100)
const again = jar(await signIn())
const staff = await post(
  "/two-factor/verify-totp",
  { code: totp(secret, Date.now() + 30_000) },
  again,
)
console.log(JSON.stringify({ cookie: jar(staff) }))
await database().pool.end()
