import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { createHmac } from "node:crypto"
import { database } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import { superuserPool, testUrl } from "../db/testing.ts"
import { WHATSAPP_FRESH_MS, WHATSAPP_LIMITS } from "../shared/whatsapp.ts"
import { openSealed } from "./seal.ts"
import { createWhatsAppGateway } from "./whatsapp.server.ts"

const su = superuserPool()
const hashKey = Buffer.alloc(32, 5)
const jobKey = Buffer.alloc(32, 6)
const NOW = new Date("2026-10-16T03:00:00Z")
const phone = "+6281234500077"

const gateway = createWhatsAppGateway({
  db: database().db,
  hashKey: () => hashKey,
  jobKey: () => jobKey,
  caps: true,
  now: () => NOW,
})

async function setSender(status: string, seenMsAgo: number | null) {
  await su.query("DELETE FROM whatsapp_sender")
  await su.query(
    `INSERT INTO whatsapp_sender (id, provider, status, last_seen_at)
     VALUES (1, 'baileys', $1, $2)`,
    [status, seenMsAgo === null ? null : new Date(NOW.getTime() - seenMsAgo)],
  )
}

async function jobs() {
  const { rows } = await su.query<{ data: { logId: string; sealed: string } }>(
    "SELECT data FROM pgboss.job WHERE name = 'whatsapp-send' ORDER BY created_on",
  )
  return rows.map((row) => row.data)
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await su.query("DELETE FROM whatsapp_log")
  await su.query("DELETE FROM pgboss.job WHERE name = 'whatsapp-send'")
})

afterAll(async () => {
  await su.query("DELETE FROM whatsapp_log")
  await su.query("DELETE FROM whatsapp_sender")
  await su.query("DELETE FROM pgboss.job WHERE name = 'whatsapp-send'")
  await su.end()
})

describe("WhatsApp gateway", () => {
  test("an unlinked or silent sender refuses before any row", async () => {
    for (const [status, seen] of [
      ["unlinked", 1000],
      ["connected", 10 * 60_000],
      ["logged_out", 1000],
    ] as const) {
      await setSender(status, seen)
      expect(await gateway.ready()).toBe(false)
      expect(await gateway.sendCode(phone, "123456")).toEqual({
        ok: false,
        reason: "unavailable",
      })
    }
    const { rows } = await su.query("SELECT 1 FROM whatsapp_log")
    expect(rows.length).toBe(0)
    expect(await jobs()).toEqual([])
  })

  test("a ready sender gets a sealed job and a hashed log row", async () => {
    await setSender("connected", 1000)
    expect(await gateway.ready()).toBe(true)
    const result = await gateway.sendCode(phone, "123456")
    if (!result.ok) throw new Error(result.reason)
    const { rows } = await su.query<{ phone_hash: string; status: string }>(
      "SELECT phone_hash, status FROM whatsapp_log WHERE id = $1",
      [result.logId],
    )
    expect(rows[0]).toEqual({
      phone_hash: createHmac("sha256", hashKey).update(phone).digest("hex"),
      status: "reserved",
    })
    const [job] = await jobs()
    expect(job?.logId).toBe(result.logId)
    const raw = JSON.stringify(job)
    expect(raw).not.toContain("123456")
    expect(raw).not.toContain("81234500077")
    expect(openSealed(job?.sealed ?? "", jobKey, "job")).toEqual({
      to: phone,
      code: "123456",
      expiresAt: NOW.getTime() + 300_000,
    })
    expect(await gateway.status(result.logId)).toBe("reserved")
    expect(await gateway.status(crypto.randomUUID())).toBeNull()
  })

  test("one number waits 60 s and gets 8 codes a day", async () => {
    await setSender("connected", 1000)
    expect((await gateway.sendCode(phone, "111111")).ok).toBe(true)
    expect(await gateway.sendCode(phone, "222222")).toEqual({
      ok: false,
      reason: "spacing",
    })
    const hash = createHmac("sha256", hashKey).update(phone).digest("hex")
    await su.query(
      `UPDATE whatsapp_log SET created_at = $2 WHERE phone_hash = $1`,
      [hash, new Date(NOW.getTime() - 2 * 60_000)],
    )
    await su.query(
      `INSERT INTO whatsapp_log (phone_hash, status, created_at)
       SELECT $1, 'sent', $2 FROM generate_series(1, $3::int)`,
      [hash, new Date(NOW.getTime() - 3_600_000), WHATSAPP_LIMITS.perDay - 1],
    )
    expect(await gateway.sendCode(phone, "333333")).toEqual({
      ok: false,
      reason: "daily",
    })
  })

  test("failed sends to one number still count", async () => {
    await setSender("connected", 1000)
    const hash = createHmac("sha256", hashKey).update(phone).digest("hex")
    // Worker verdict, then time passes
    const fail = (minutes: number) =>
      su.query(
        `UPDATE whatsapp_log SET status = 'failed', error = 'not_on_whatsapp',
           created_at = created_at - make_interval(mins => $2)
         WHERE phone_hash = $1`,
        [hash, minutes],
      )
    expect((await gateway.sendCode(phone, "111111")).ok).toBe(true)
    await fail(0)
    expect(await gateway.sendCode(phone, "222222")).toEqual({
      ok: false,
      reason: "spacing",
    })
    for (let i = 1; i < WHATSAPP_LIMITS.perDay; i++) {
      await fail(2)
      expect((await gateway.sendCode(phone, String(i))).ok).toBe(true)
    }
    await fail(2)
    expect(await gateway.sendCode(phone, "999999")).toEqual({
      ok: false,
      reason: "daily",
    })
  })

  test("a client's failed Daftar codes still count", async () => {
    await setSender("connected", 1000)
    const signUp = { purpose: "sign-up", client: "203.0.113.9" } as const
    for (let i = 0; i < WHATSAPP_LIMITS.signUpPerClientDay; i++) {
      const to = `+628123450${String(300 + i)}`
      expect((await gateway.sendCode(to, "1", signUp)).ok).toBe(true)
      await su.query(
        "UPDATE whatsapp_log SET status = 'failed', error = 'not_on_whatsapp'",
      )
    }
    expect(await gateway.sendCode("+6281234500400", "1", signUp)).toEqual({
      ok: false,
      reason: "busy",
    })
  })

  test("the whole sender has an hourly cap; sends never tried do not count", async () => {
    await setSender("connected", 1000)
    await su.query(
      `INSERT INTO whatsapp_log (phone_hash, status, error, created_at)
       SELECT 'other' || g, 'failed', 'unavailable', $1 FROM generate_series(1, $2::int) g`,
      [new Date(NOW.getTime() - 60_000), WHATSAPP_LIMITS.perHour],
    )
    expect((await gateway.sendCode(phone, "111111")).ok).toBe(true)
    await su.query("DELETE FROM whatsapp_log WHERE error = 'unavailable'")
    await su.query(
      `INSERT INTO whatsapp_log (phone_hash, status, error, created_at)
       SELECT 'other' || g, 'failed', 'not_on_whatsapp', $1 FROM generate_series(1, $2::int) g`,
      [new Date(NOW.getTime() - 60_000), WHATSAPP_LIMITS.perHour],
    )
    expect(await gateway.sendCode("+6281234500078", "222222")).toEqual({
      ok: false,
      reason: "busy",
    })
  })

  test("a code still unsent after the fresh window reads as failed", async () => {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO whatsapp_log (phone_hash, status, created_at)
       VALUES ('lama', 'reserved', $1), ('baru', 'reserved', $2) RETURNING id`,
      [
        new Date(NOW.getTime() - WHATSAPP_FRESH_MS - 1),
        new Date(NOW.getTime() - 10_000),
      ],
    )
    expect(await gateway.status(rows[0]?.id ?? "")).toBe("failed")
    expect(await gateway.status(rows[1]?.id ?? "")).toBe("reserved")
  })

  test("Daftar codes cannot use up the sign-in budget", async () => {
    await setSender("connected", 1000)
    const signUp = { purpose: "sign-up", client: "203.0.113.9" } as const
    await su.query(
      `INSERT INTO whatsapp_log (phone_hash, status, purpose, created_at)
       SELECT 'baru' || g, 'sent', 'sign_up', $1 FROM generate_series(1, $2::int) g`,
      [new Date(NOW.getTime() - 60_000), WHATSAPP_LIMITS.signUpPerHour],
    )
    expect(await gateway.sendCode("+6281234500079", "1", signUp)).toEqual({
      ok: false,
      reason: "busy",
    })
    expect((await gateway.sendCode(phone, "2")).ok).toBe(true)
    const { rows } = await su.query<{ purpose: string }>(
      "SELECT purpose FROM whatsapp_log WHERE phone_hash NOT LIKE 'baru%'",
    )
    expect(rows).toEqual([{ purpose: "sign_in" }])
  })

  test("one address gets few Daftar codes a day", async () => {
    await setSender("connected", 1000)
    const signUp = { purpose: "sign-up", client: "203.0.113.9" } as const
    for (let i = 0; i < WHATSAPP_LIMITS.signUpPerClientDay; i++) {
      const to = `+628123450${String(100 + i)}`
      expect((await gateway.sendCode(to, "1", signUp)).ok).toBe(true)
    }
    expect(await gateway.sendCode("+6281234500200", "1", signUp)).toEqual({
      ok: false,
      reason: "busy",
    })
    const other = { purpose: "sign-up", client: "198.51.100.7" } as const
    expect((await gateway.sendCode("+6281234500201", "1", other)).ok).toBe(true)
  })
})
