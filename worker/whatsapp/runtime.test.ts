import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { database } from "../../db/client.server.ts"
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
    await su.end()
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
