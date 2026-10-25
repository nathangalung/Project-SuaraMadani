import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createDatabase, database } from "../../db/client.server.ts"
import { migrate } from "../../db/migrate.ts"
import { superuserPool, testUrl } from "../../db/testing.ts"
import { providerName } from "./provider.ts"
import { startWhatsApp, whatsappEnv } from "./runtime.ts"

const key = Buffer.alloc(32, 1).toString("base64")

describe("WhatsApp config", () => {
  test("provider names are a closed list", () => {
    expect(providerName("baileys")).toBe("baileys")
    expect(() => providerName("")).toThrow("WHATSAPP_PROVIDER")
    expect(() => providerName("twilio")).toThrow("WHATSAPP_PROVIDER")
  })

  test("baileys needs a creds key, meta its token", () => {
    expect(() =>
      whatsappEnv({ WHATSAPP_PROVIDER: "baileys", WHATSAPP_JOB_KEY: key }),
    ).toThrow("WHATSAPP_CREDS_KEY is not set")
    expect(() =>
      whatsappEnv({ WHATSAPP_PROVIDER: "meta", WHATSAPP_JOB_KEY: key }),
    ).toThrow("META_WA_TOKEN is not set")
    expect(
      whatsappEnv({
        WHATSAPP_PROVIDER: "baileys",
        WHATSAPP_JOB_KEY: key,
        WHATSAPP_CREDS_KEY: key,
      }).provider,
    ).toBe("baileys")
  })

  test("the dev inbox is refused in production", () => {
    expect(() =>
      whatsappEnv({
        NODE_ENV: "production",
        WHATSAPP_PROVIDER: "dev",
        WHATSAPP_JOB_KEY: key,
      }),
    ).toThrow("not allowed in production")
  })
})

describe("WhatsApp runtime", () => {
  const su = superuserPool()

  beforeAll(async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
    await su.query("DELETE FROM whatsapp_sender")
  })

  afterAll(async () => {
    await su.query("DELETE FROM whatsapp_sender")
    await su.query("DELETE FROM whatsapp_auth")
    await su.end()
  })

  const fast = { pollMs: 10, heartbeatMs: 10 }
  const sender = async () =>
    (
      await su.query<{
        provider: string
        status: string
        requested: string | null
        last_error: string | null
        last_seen_at: Date | null
      }>(
        "SELECT provider, status, requested, last_error, last_seen_at FROM whatsapp_sender",
      )
    ).rows[0]
  async function until(check: () => Promise<boolean>): Promise<void> {
    for (let tries = 0; tries < 200; tries++) {
      if (await check()) return
      await Bun.sleep(10)
    }
    throw new Error("condition never held")
  }

  test("Given the Meta provider, when it starts, then the sender reads connected with nothing to link", async () => {
    await su.query("DELETE FROM whatsapp_sender")
    const runtime = await startWhatsApp(
      database().db,
      { provider: "meta", jobKey: Buffer.from(key, "base64") },
      {
        META_WA_TOKEN: "token",
        META_WA_PHONE_NUMBER_ID: "123",
        META_WA_TEMPLATE: "kode_masuk",
      },
    )
    expect(runtime.provider.name).toBe("meta")
    expect(await sender()).toMatchObject({
      provider: "meta",
      status: "connected",
    })
    await runtime.stop()
    expect((await sender())?.status).toBe("stopped")
  })

  test("Given an unlinked Baileys sender, when an admin asks to unlink, then the poll takes it and the heartbeat ticks", async () => {
    await su.query("DELETE FROM whatsapp_sender")
    await su.query("DELETE FROM whatsapp_auth")
    const runtime = await startWhatsApp(
      database().db,
      {
        provider: "baileys",
        jobKey: Buffer.from(key, "base64"),
        credsKey: Buffer.alloc(32, 2),
      },
      {},
      fast,
    )
    try {
      expect(runtime.provider.name).toBe("baileys")
      expect(await sender()).toMatchObject({
        provider: "baileys",
        status: "unlinked",
      })
      await su.query(
        "UPDATE whatsapp_sender SET requested = 'unlink', last_error = 'stale', last_seen_at = NULL",
      )
      // Handled, not only taken
      await until(async () => (await sender())?.last_error === null)
      await until(async () => (await sender())?.last_seen_at != null)
      expect(await sender()).toMatchObject({
        status: "unlinked",
        requested: null,
      })
    } finally {
      await runtime.stop()
    }
  })

  test("Given the database blips, when polls and heartbeats fail, then the loop recovers", async () => {
    await su.query("DELETE FROM whatsapp_sender")
    const own = createDatabase(testUrl("TEST_DATABASE_URL"), "worker-whatsapp")
    const runtime = await startWhatsApp(
      own.db,
      {
        provider: "baileys",
        jobKey: Buffer.from(key, "base64"),
        credsKey: Buffer.alloc(32, 2),
      },
      {},
      fast,
    )
    const query = own.pool.query.bind(own.pool)
    let failures = 0
    own.pool.query = (() => {
      failures += 1
      return Promise.reject(new Error("down"))
    }) as typeof own.pool.query
    try {
      await until(async () => failures >= 4)
    } finally {
      own.pool.query = query
    }
    await su.query("UPDATE whatsapp_sender SET requested = 'unlink'")
    await until(async () => (await sender())?.requested === null)
    await runtime.stop()
    await own.pool.end()
  })

  test("a fixed provider's stop is deliberate", async () => {
    const status = async () =>
      (await su.query<{ status: string }>("SELECT status FROM whatsapp_sender"))
        .rows[0]?.status
    const runtime = await startWhatsApp(
      database().db,
      { provider: "dev", jobKey: Buffer.from(key, "base64") },
      { MAILPIT_URL: "http://127.0.0.1:9", EMAIL_FROM: "Uji <uji@contoh.id>" },
    )
    expect(await status()).toBe("connected")
    await runtime.stop()
    expect(await status()).toBe("stopped")
  })
})
