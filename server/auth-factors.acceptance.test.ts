import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { PgBoss } from "pg-boss"
import { database } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import {
  actionData,
  CAPTCHA_PASS,
  type FullApp,
  fullApp,
  hostsChanged,
  jar,
  loaderWith,
  mailpitCode,
  routeContext,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
  totp,
} from "../e2e/app-harness.ts"
import { postForm } from "../e2e/staff-flows.ts"
import { normalizePhone } from "../shared/phone.ts"
import { createWhatsAppSendHandler } from "../worker/whatsapp-send.ts"
import { createAuth, drainEmails } from "./auth.server.ts"
import { parseAuthSecrets } from "./auth-secrets.ts"
import { hashKey } from "./email-log.ts"
import { createWhatsAppGateway } from "./whatsapp.server.ts"

const HOST = "accfac.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
const JOB_KEY = Buffer.alloc(32, 7)
let app: FullApp
let orgId = ""
let restore = () => {}
let seq = 0
const savedJobKey = process.env.WHATSAPP_JOB_KEY

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62812555${String(seq).padStart(5, "0")}`,
    name: "Warga Faktor",
  }
}

function auth(path: string, body: unknown, cookie = "") {
  return app.request(`${ORIGIN}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie,
      "x-captcha-response": CAPTCHA_PASS,
    },
    body: JSON.stringify(body),
  })
}

const get = (url: string, cookie: string) =>
  app.request(url, { headers: { cookie } })

const hasSession = (res: Response) =>
  res.headers.getSetCookie().some((one) => /session_token=[^;]/.test(one))

/** Heartbeat as the worker writes. */
async function senderConnected() {
  await su.query(
    `INSERT INTO whatsapp_sender (id, provider, status, last_seen_at)
     VALUES (1, 'baileys', 'connected', now())
     ON CONFLICT (id) DO UPDATE SET status = 'connected', last_seen_at = now(), requested = NULL`,
  )
}

/** Email code, then TOTP challenge. */
async function challenge(email: string): Promise<string> {
  const body = { mode: "sign-in", identifier: email, channel: "email" }
  expect((await auth("/account/send-code", body)).status).toBe(200)
  const code = await mailpitCode(email)
  const verified = await auth("/account/verify-code", { ...body, code })
  expect(verified.status).toBe(200)
  expect(await verified.json()).toMatchObject({ twoFactorRedirect: true })
  expect(hasSession(verified)).toBe(false)
  return jar(verified)
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  await su.query("DELETE FROM whatsapp_sender")
  await su.query("DELETE FROM whatsapp_log")
  orgId = await insertOrg(su, "accfac")
  // Real gateway, sealed jobs
  process.env.WHATSAPP_JOB_KEY = JOB_KEY.toString("base64")
  hostsChanged([HOST])
  restore = stubTurnstile()
  app = await fullApp()
})

afterAll(async () => {
  await su.query(
    "DELETE FROM pgboss.job WHERE name IN ('whatsapp-send', 'whatsapp-send-dlq')",
  )
  await su.query("DELETE FROM whatsapp_sender")
  await su.query("DELETE FROM whatsapp_log")
  await su.query("DELETE FROM email_log")
  if (savedJobKey === undefined) delete process.env.WHATSAPP_JOB_KEY
  else process.env.WHATSAPP_JOB_KEY = savedJobKey
  // Later files rebuild auth
  hostsChanged([HOST])
  restore()
  await resetData(su)
  await su.end()
})

describe("WhatsApp sender and codes", () => {
  test("[AC-AUTH-13] Given a TOTP-verified superadmin, when they ask on /admin/whatsapp to link a number by pairing code, then a bad number is refused and the request is stored for the WhatsApp worker, while a campus admin cannot ask", async () => {
    const admin = await staffSession(HOST, orgId, person("admin"))
    const refused = await postForm(
      app,
      `${ORIGIN}/admin/whatsapp`,
      admin.cookie,
      {
        intent: "link_code",
        phone: "0812-3456-7899",
      },
    )
    expect(refused.status).toBe(403)
    const owner = await staffSession(HOST, orgId, person("super"))
    await su.query("UPDATE users SET superadmin = true WHERE id = $1", [
      owner.userId,
    ])
    const ask = (phone: string) =>
      postForm(app, `${ORIGIN}/admin/whatsapp.data`, owner.cookie, {
        intent: "link_code",
        phone,
      })
    type Answer = { error: string | null }
    expect(await actionData<Answer>(await ask("bukan nomor"))).toEqual({
      error: "phone",
    })
    expect((await su.query("SELECT 1 FROM whatsapp_sender")).rowCount).toBe(0)
    expect(await actionData<Answer>(await ask("0812-3456-7899"))).toEqual({
      error: null,
    })
    const { rows } = await su.query(
      "SELECT requested, requested_by, pairing_phone, status FROM whatsapp_sender",
    )
    expect(rows).toEqual([
      {
        requested: "link_code",
        requested_by: owner.userId,
        pairing_phone: "+6281234567899",
        status: "unlinked",
      },
    ])
    const page = await loaderWith<{
      view: { pending: boolean; ready: boolean }
    }>(await get(`${ORIGIN}/admin/whatsapp.data`, owner.cookie), "view")
    expect(page.view).toMatchObject({ pending: true, ready: false })
  })

  test("[AC-AUTH-14] Given a connected sender and an account whose number is not yet proven, when a sign-in code is asked by WhatsApp, then it travels sealed in a whatsapp-send job, the worker hands it to the sender, the code signs in and proves the number, and a failing job ends in whatsapp-send-dlq", async () => {
    await senderConnected()
    const account = person("wa")
    const { userId } = await signedIn(HOST, account)
    const body = {
      mode: "sign-in",
      identifier: account.email,
      channel: "whatsapp",
    }
    const asked = await auth("/account/send-code", body)
    expect(asked.status).toBe(200)
    const { statusId } = (await asked.json()) as { statusId: string }
    const job = async (logId: string) => {
      const { rows } = await su.query<{
        id: string
        data: { logId: string; sealed: string }
      }>(
        "SELECT id, data FROM pgboss.job WHERE name = 'whatsapp-send' AND data->>'logId' = $1",
        [logId],
      )
      if (rows.length !== 1) throw new Error(`${rows.length} jobs`)
      return rows[0] as { id: string; data: { logId: string; sealed: string } }
    }
    const queuedJob = await job(statusId)
    const delivered: { to: string; code: string }[] = []
    const handler = (send: () => Promise<"sent">) =>
      createWhatsAppSendHandler({
        db: database().db,
        jobKey: () => JOB_KEY,
        provider: {
          name: "dev",
          send: async (message) => {
            delivered.push(message)
            return send()
          },
        },
        now: () => new Date(),
        wait: async () => {},
      })
    const signal = new AbortController().signal
    expect(await handler(async () => "sent")(queuedJob.data, signal)).toBe(
      "sent",
    )
    // As the worker completes it
    await su.query("UPDATE pgboss.job SET state = 'completed' WHERE id = $1", [
      queuedJob.id,
    ])
    const [message] = delivered
    if (!message) throw new Error("nothing handed to the sender")
    expect(message.to).toBe(normalizePhone(account.phone) ?? "")
    expect(message.code).toMatch(/^\d{6}$/)
    const stored = JSON.stringify(queuedJob.data)
    expect(stored).not.toContain(message.code)
    expect(stored).not.toContain(account.phone.slice(3))
    const status = await auth("/account/code-status", { id: statusId })
    expect(await status.json()).toEqual({ status: "sent" })
    const verified = await auth("/account/verify-code", {
      ...body,
      code: message.code,
    })
    expect(verified.status).toBe(200)
    expect(hasSession(verified)).toBe(true)
    const proven = await su.query<{ phone_verified: boolean }>(
      "SELECT phone_verified FROM users WHERE id = $1",
      [userId],
    )
    expect(proven.rows[0]?.phone_verified).toBe(true)
    // Provider down: retries, then DLQ
    const again = await auth("/account/send-code", body)
    expect(again.status).toBe(200)
    const failing = (await again.json()) as { statusId: string }
    const boss = new PgBoss({
      connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
      max: 2,
      supervise: false,
      schedule: false,
      migrate: false,
      createSchema: false,
    })
    boss.on("error", () => {})
    await boss.start()
    try {
      const failingJob = await job(failing.statusId)
      const down = handler(async () => {
        throw new Error("socket closed")
      })
      for (let attempt = 0; attempt < 3; attempt++) {
        await su.query(
          "UPDATE pgboss.job SET start_after = now() WHERE id = $1",
          [failingJob.id],
        )
        const [fetched] = await boss.fetch<{ logId: string; sealed: string }>(
          "whatsapp-send",
        )
        expect(fetched?.id).toBe(failingJob.id)
        await expect(down(failingJob.data, signal)).rejects.toThrow(
          "socket closed",
        )
        await boss.fail("whatsapp-send", failingJob.id, { reason: "socket" })
      }
      const dead = await su.query(
        "SELECT 1 FROM pgboss.job WHERE name = 'whatsapp-send-dlq' AND data->>'logId' = $1",
        [failing.statusId],
      )
      expect(dead.rowCount).toBe(1)
    } finally {
      await boss.stop({ graceful: false })
    }
    const log = await su.query(
      "SELECT status, error FROM whatsapp_log WHERE id = $1",
      [failing.statusId],
    )
    expect(log.rows).toEqual([{ status: "failed", error: "provider" }])
    const failed = await auth("/account/code-status", { id: failing.statusId })
    expect(await failed.json()).toEqual({ status: "failed" })
  })
})

describe("account number", () => {
  test("[AC-AUTH-15] Given an account without a number, when it adds one on /masuk, then a malformed, proven or pending number is refused, a free one is stored unproven once, and a session older than 300 seconds is ended instead", async () => {
    const owner = await signedIn(HOST, person("tanpanomor"))
    const holder = person("pemegang")
    const proven = await signedIn(HOST, holder)
    await su.query("UPDATE users SET phone_verified = true WHERE id = $1", [
      proven.userId,
    ])
    const pending = person("tertunda")
    await signedIn(HOST, pending)
    // Number released to its prover
    await su.query(
      "UPDATE users SET phone_number = NULL, phone_verified = false WHERE id = $1",
      [owner.userId],
    )
    const page = async () =>
      loaderWith<{ needsPhone: boolean }>(
        await get(`${ORIGIN}/masuk.data`, owner.cookie),
        "needsPhone",
      )
    expect((await page()).needsPhone).toBe(true)
    const add = async (phone: string) =>
      actionData(
        await postForm(app, `${ORIGIN}/masuk.data`, owner.cookie, {
          intent: "add_phone",
          phone,
        }),
      )
    expect(await add("12345")).toEqual({ error: "format" })
    expect(await add(holder.phone)).toEqual({ error: "taken" })
    expect(await add(pending.phone)).toEqual({ error: "pending" })
    expect(await add("0812-5550-9999")).toEqual({ saved: true })
    const stored = await su.query(
      "SELECT phone_number, phone_verified FROM users WHERE id = $1",
      [owner.userId],
    )
    expect(stored.rows).toEqual([
      { phone_number: "+6281255509999", phone_verified: false },
    ])
    expect(await add("0812-5550-9998")).toEqual({ error: "exists" })
    expect((await page()).needsPhone).toBe(false)
    const stale = await signedIn(HOST, person("basi"))
    await su.query(
      "UPDATE users SET phone_number = NULL, phone_verified = false WHERE id = $1",
      [stale.userId],
    )
    await su.query(
      "UPDATE sessions SET created_at = now() - interval '10 minutes', step_up_at = NULL WHERE user_id = $1",
      [stale.userId],
    )
    const ended = await postForm(app, `${ORIGIN}/masuk`, stale.cookie, {
      intent: "add_phone",
      phone: "0812-5550-9997",
    })
    expect(ended.status).toBe(303)
    expect(ended.headers.get("location")).toBe("/masuk")
    const left = await su.query(
      "SELECT phone_number FROM users WHERE id = $1",
      [stale.userId],
    )
    expect(left.rows).toEqual([{ phone_number: null }])
    const sessions = await su.query(
      "SELECT 1 FROM sessions WHERE user_id = $1",
      [stale.userId],
    )
    expect(sessions.rowCount).toBe(0)
  })
})

describe("code caps, production configuration", () => {
  test("[AC-AUTH-16] Given the production auth configuration and an account with a proven email and number, when codes are asked again and again, then each address or number gets one code per 60 seconds and 8 per 24 hours, refused with 429 OTP_LIMIT", async () => {
    const account = person("batas")
    const { userId } = await signedIn(HOST, account)
    await su.query("UPDATE users SET phone_verified = true WHERE id = $1", [
      userId,
    ])
    await senderConnected()
    await su.query("DELETE FROM email_log")
    await su.query("DELETE FROM whatsapp_log")
    const db = database().db
    const mailed: string[] = []
    // Same handler as /api/auth/*
    const production = createAuth({
      db,
      hosts: [HOST],
      dev: false,
      email: { send: async (message) => void mailed.push(message.to) },
      hashKey,
      verifyCaptcha: async () => ({ ok: true }),
      whatsapp: createWhatsAppGateway({
        db,
        hashKey,
        jobKey: () => JOB_KEY,
        caps: true,
      }),
      secrets: parseAuthSecrets(process.env.BETTER_AUTH_SECRETS),
    })
    const ask = async (channel: "email" | "whatsapp") => {
      const res = await production.handler(
        new Request(`${ORIGIN}/api/auth/account/send-code`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: ORIGIN,
            "x-client-ip": "10.40.0.1",
            "x-captcha-response": CAPTCHA_PASS,
          },
          body: JSON.stringify({
            mode: "sign-in",
            identifier: account.email,
            channel,
          }),
        }),
      )
      return {
        status: res.status,
        code: ((await res.json()) as { code?: string }).code,
      }
    }
    const refused = { status: 429, code: "OTP_LIMIT" }
    for (const [channel, table] of [
      ["email", "email_log"],
      ["whatsapp", "whatsapp_log"],
    ] as const) {
      expect(await ask(channel)).toMatchObject({ status: 200 })
      expect(await ask(channel)).toEqual(refused)
      await su.query(
        `UPDATE ${table} SET created_at = created_at - interval '61 seconds'`,
      )
      expect(await ask(channel)).toMatchObject({ status: 200 })
      // Eight in the last day
      await su.query(
        `UPDATE ${table} SET created_at = created_at - interval '2 minutes'`,
      )
      const columns =
        table === "email_log" ? "kind, address_hash" : "phone_hash"
      await su.query(
        `INSERT INTO ${table} (${columns}, purpose, status, client_hash, created_at)
         SELECT ${columns}, purpose, 'sent', client_hash, now() - interval '3 hours'
         FROM (SELECT * FROM ${table} LIMIT 1) one, generate_series(1, 6)`,
      )
      expect(await ask(channel)).toEqual(refused)
      await su.query(
        `UPDATE ${table} SET created_at = now() - interval '25 hours'
         WHERE id = (SELECT id FROM ${table} ORDER BY created_at LIMIT 1)`,
      )
      expect(await ask(channel)).toMatchObject({ status: 200 })
    }
    await drainEmails()
    expect(mailed).toEqual([account.email, account.email, account.email])
  })
})

describe("staff second factor and session lifetimes", () => {
  let staff: Staff
  let email = ""

  beforeAll(async () => {
    const account = person("staf")
    email = account.email
    staff = await staffSession(HOST, orgId, account)
  })

  test("[AC-AUTH-17] Given an admin with TOTP and backup codes, when they sign in with a TOTP code or a backup code, then each code works once and a reused one gets 401 with no session", async () => {
    // Enrolment spent this step
    await su.query(
      "UPDATE two_factors SET last_totp_step = NULL WHERE user_id = $1",
      [staff.userId],
    )
    const code = totp(staff.secret, Date.now())
    const first = await auth(
      "/two-factor/verify-totp",
      { code },
      await challenge(email),
    )
    expect(first.status).toBe(200)
    expect(hasSession(first)).toBe(true)
    expect((await get(`${ORIGIN}/kelola`, jar(first))).status).toBe(200)
    const replay = await auth(
      "/two-factor/verify-totp",
      { code },
      await challenge(email),
    )
    expect(replay.status).toBe(401)
    expect(hasSession(replay)).toBe(false)
    const backup = staff.backupCodes[0] ?? ""
    const rescued = await auth(
      "/two-factor/verify-backup-code",
      { code: backup },
      await challenge(email),
    )
    expect(rescued.status).toBe(200)
    expect(hasSession(rescued)).toBe(true)
    expect((await get(`${ORIGIN}/kelola`, jar(rescued))).status).toBe(200)
    const reused = await auth(
      "/two-factor/verify-backup-code",
      { code: backup },
      await challenge(email),
    )
    expect(reused.status).toBe(401)
    expect(hasSession(reused)).toBe(false)
  })

  test("[AC-AUTH-18] Given sessions of a citizen and of an admin, when the citizen's sign-in is older than 30 days or the admin has made no request for 30 minutes, then that session ends, while a 29-day sign-in, a citizen idle for 6 days and an admin idle for 29 minutes stay signed in", async () => {
    const account = person("lama")
    const citizen = await signedIn(HOST, account)
    const age = (interval: string, seen: string) =>
      su.query(
        `UPDATE sessions SET created_at = now() - $2::interval,
           last_seen_at = now() - $3::interval, expires_at = now() + interval '1 day'
         WHERE user_id = $1`,
        [citizen.userId, interval, seen],
      )
    const shows = async () =>
      (await (await get(`${ORIGIN}/lacak`, citizen.cookie)).text()).includes(
        account.email,
      )
    await age("29 days", "6 days")
    expect(await shows()).toBe(true)
    await age("30 days 1 minute", "0 minutes")
    expect(await shows()).toBe(false)
    const left = await su.query("SELECT 1 FROM sessions WHERE user_id = $1", [
      citizen.userId,
    ])
    expect(left.rowCount).toBe(0)
    const admin = await staffSession(HOST, orgId, person("diam"))
    const idle = (minutes: number) =>
      su.query(
        "UPDATE sessions SET last_seen_at = now() - make_interval(mins => $2) WHERE user_id = $1",
        [admin.userId, minutes],
      )
    await idle(29)
    expect((await get(`${ORIGIN}/kelola`, admin.cookie)).status).toBe(200)
    const current = (await routeContext(HOST, admin.cookie)).session
    if (!current) throw new Error("no admin session")
    await idle(31)
    expect((await get(`${ORIGIN}/kelola`, admin.cookie)).status).toBe(403)
    const gone = await su.query("SELECT 1 FROM sessions WHERE id = $1", [
      current.session.id,
    ])
    expect(gone.rowCount).toBe(0)
  })
})
