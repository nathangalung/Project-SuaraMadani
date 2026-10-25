import type { Db } from "../../db/client.server.ts"
import { mailpitSender } from "../../server/email.ts"
import { errorRecord, writeLog } from "../../server/log.ts"
import { parseSealKey } from "../../server/seal.ts"
import { baileysFactory, createBaileysSender } from "./baileys.ts"
import { devProvider } from "./dev.ts"
import { metaProvider } from "./meta.ts"
import {
  type ProviderName,
  providerName,
  type WhatsAppProvider,
} from "./provider.ts"
import { heartbeat, takeRequest, updateSender } from "./sender-row.ts"

type Timing = { pollMs: number; heartbeatMs: number }
const TIMING: Timing = { pollMs: 2_000, heartbeatMs: 30_000 }

type Env = Partial<Record<string, string>>

function required(env: Env, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export type WhatsAppEnv = {
  provider: ProviderName
  jobKey: Buffer
  credsKey?: Buffer
}

/** Validated at boot, fails loudly. */
export function whatsappEnv(env: Env = process.env): WhatsAppEnv {
  const provider = providerName(env.WHATSAPP_PROVIDER)
  const jobKey = parseSealKey(env.WHATSAPP_JOB_KEY, "WHATSAPP_JOB_KEY")
  if (provider === "dev" && env.NODE_ENV === "production") {
    throw new Error("WHATSAPP_PROVIDER dev is not allowed in production")
  }
  if (provider === "meta") {
    required(env, "META_WA_TOKEN")
    required(env, "META_WA_PHONE_NUMBER_ID")
    required(env, "META_WA_TEMPLATE")
  }
  const credsKey =
    provider === "baileys"
      ? parseSealKey(env.WHATSAPP_CREDS_KEY, "WHATSAPP_CREDS_KEY")
      : undefined
  return { provider, jobKey, credsKey }
}

export type WhatsAppRuntime = {
  provider: WhatsAppProvider
  stop: () => Promise<void>
}

function staticProvider(
  config: WhatsAppEnv,
  env: Env,
): WhatsAppProvider | null {
  if (config.provider === "meta") {
    return metaProvider({
      token: required(env, "META_WA_TOKEN"),
      phoneNumberId: required(env, "META_WA_PHONE_NUMBER_ID"),
      template: required(env, "META_WA_TEMPLATE"),
      language: env.META_WA_LANGUAGE?.trim() || "id",
    })
  }
  if (config.provider === "dev") {
    return devProvider(
      mailpitSender({
        url: required(env, "MAILPIT_URL"),
        from: required(env, "EMAIL_FROM"),
      }),
    )
  }
  return null
}

/** Sender, /admin requests, heartbeat. */
export async function startWhatsApp(
  db: Db,
  config: WhatsAppEnv,
  env: Env = process.env,
  timing: Timing = TIMING,
): Promise<WhatsAppRuntime> {
  const timers: ReturnType<typeof setInterval>[] = []
  const fixed = staticProvider(config, env)
  const linked =
    fixed || !config.credsKey
      ? null
      : createBaileysSender({
          db,
          factory: baileysFactory(db, config.credsKey),
          schedule: (ms, run) => {
            const timer = setTimeout(run, ms)
            return () => clearTimeout(timer)
          },
        })
  if (fixed) {
    // Nothing to link
    await updateSender(db, config.provider, {
      status: "connected",
      lastConnectedAt: new Date(),
      lastSeenAt: new Date(),
      lastError: null,
    })
  }
  await linked?.start()
  await heartbeat(db)
  let polling = false
  timers.push(
    setInterval(async () => {
      if (polling) return
      polling = true
      try {
        const request = await takeRequest(db)
        if (request && linked) await linked.handle(request)
      } catch (error) {
        writeLog({ msg: "whatsapp request failed", ...errorRecord(error) })
      } finally {
        polling = false
      }
    }, timing.pollMs),
    setInterval(() => {
      heartbeat(db).catch((error: unknown) =>
        writeLog({ msg: "whatsapp heartbeat failed", ...errorRecord(error) }),
      )
    }, timing.heartbeatMs),
  )
  const provider = fixed ?? linked?.provider
  if (!provider) throw new Error("no WhatsApp provider")
  return {
    provider,
    async stop() {
      for (const timer of timers) clearInterval(timer)
      await linked?.stop()
      // Deliberate, never stale connected
      if (fixed) await updateSender(db, config.provider, { status: "stopped" })
    },
  }
}
