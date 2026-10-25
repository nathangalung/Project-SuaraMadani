// Bun only: in-process Better Auth
import { eq } from "drizzle-orm"
import { database } from "../db/client.server.ts"
import { users } from "../db/schema/auth.ts"
import { emailLog } from "../db/schema/notifications.ts"
import { createAuth, drainEmails } from "../server/auth.server.ts"
import { addressHash, hashKey } from "../server/email-log.ts"
import { AGE_CONSENT_VERSION } from "../shared/report-fields.ts"

export type Account = { email: string; phone: string; name: string }

/** Cookie header from Set-Cookie. */
export const jar = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => !c.endsWith("="))
    .join("; ")

/** Production auth, codes captured. */
export function accountClient(host: string) {
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

  /** Code sign-up or sign-in. */
  async function signIn(account: Account): Promise<Response> {
    // Per-address caps, own rows only
    const forgetCodes = () =>
      db
        .delete(emailLog)
        .where(eq(emailLog.addressHash, addressHash(account.email, hashKey())))
    await forgetCodes()
    const [known] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, account.email))
    const body = known
      ? { mode: "sign-in", identifier: account.email, channel: "email" }
      : {
          mode: "sign-up",
          name: account.name,
          email: account.email,
          phone: account.phone,
          channel: "email",
        }
    await post("/account/send-code", body)
    // Codes sent in the background
    await drainEmails()
    const code = /\b(\d{6})\b/.exec(
      sent.findLast((m) => m.to === account.email)?.text ?? "",
    )?.[1]
    if (!code) throw new Error("no sign-in code captured")
    const res = await post("/account/verify-code", {
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
    // Global sign-up quota untouched
    await forgetCodes()
    return res
  }

  return { db, post, signIn }
}
