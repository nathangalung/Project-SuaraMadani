import type { MinimalMessage, WAMessage } from "baileys"
import type { Db } from "../../db/client.server.ts"
import { errorRecord, writeLog } from "../../server/log.ts"
import { whatsappCodeText } from "../../server/whatsapp-text.ts"
import { maskPhone } from "../../shared/phone.ts"
import { OTP_TTL_SECONDS } from "../../shared/whatsapp.ts"
import { authState, sealedStore } from "./auth-state.ts"
import type { WhatsAppProvider } from "./provider.ts"
import { senderFault, type TakenRequest, updateSender } from "./sender-row.ts"

// Baileys DisconnectReason values
const LOGGED_OUT = 401
const RESTART_REQUIRED = 515
const TIMED_OUT = 408
const RETRY_MS = { first: 5_000, max: 60_000 } as const

export type ConnectionUpdate = {
  connection?: "open" | "close" | "connecting"
  qr?: string
  statusCode?: number
  // Own JID once open
  me?: string
}

// Fault codes, panel shows text
const SENDER_FAULTS = {
  loggedOut: "logged_out",
  linkTimeout: "link_timeout",
  disconnected: (code: number | undefined) => `disconnected:${code ?? "?"}`,
} as const

/** Rejects once the job aborts. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason)
    signal.addEventListener("abort", stop, { once: true })
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", stop)
    })
  })
}

// proto.IMessage, kept loose
type SentMessage = Record<string, unknown>

/** Recent sends, for retry receipts. */
export function sentCache({
  max = 256,
  ttlMs = OTP_TTL_SECONDS * 1000,
  now = Date.now,
}: {
  max?: number
  ttlMs?: number
  now?: () => number
} = {}) {
  // Memory only, never logged
  const entries = new Map<string, { message: SentMessage; at: number }>()
  return {
    put(id: string, message: SentMessage) {
      entries.delete(id)
      entries.set(id, { message, at: now() })
      for (const oldest of entries.keys()) {
        if (entries.size <= max) break
        entries.delete(oldest)
      }
    },
    get(id: string): SentMessage | undefined {
      const entry = entries.get(id)
      if (!entry) return undefined
      if (now() - entry.at <= ttlMs) return entry.message
      entries.delete(id)
      return undefined
    },
  }
}

// Valid WhatsApp timer, 24 h
const DISAPPEAR_SECONDS = 86_400

// Calls one code needs
export type CodeSocket = {
  sendMessage(
    jid: string,
    content: { text: string },
    options: { ephemeralExpiration: number },
  ): Promise<WAMessage | undefined>
  chatModify(
    mod: { delete: true; lastMessages: MinimalMessage[] },
    jid: string,
  ): Promise<void>
}

/** Disappearing, then off the handset. */
export async function sendCodeText(
  sock: CodeSocket,
  keep: (id: string, message: SentMessage) => void,
  jid: string,
  text: string,
): Promise<void> {
  const info = await sock.sendMessage(
    jid,
    { text },
    { ephemeralExpiration: DISAPPEAR_SECONDS },
  )
  if (!info) return
  if (info.key.id && info.message) {
    keep(info.key.id, info.message as SentMessage)
  }
  // Handset keeps no codes
  await sock
    .chatModify(
      {
        delete: true,
        lastMessages: [
          { key: info.key, messageTimestamp: info.messageTimestamp },
        ],
      },
      jid,
    )
    .catch((cause: unknown) =>
      writeLog({
        msg: "whatsapp chat delete failed",
        error: cause instanceof Error ? cause.name : "unknown",
      }),
    )
}

export type SocketHandle = {
  requestPairingCode: (digits: string) => Promise<string>
  exists: (digits: string) => Promise<boolean>
  sendText: (jid: string, text: string) => Promise<void>
  logout: () => Promise<void>
  end: () => void
}

export type SocketFactory = {
  hasSession: () => Promise<boolean>
  clear: () => Promise<void>
  open: (
    onUpdate: (update: ConnectionUpdate) => Promise<void>,
  ) => Promise<SocketHandle>
}

type Link =
  | { method: "qr" }
  | { method: "code"; digits: string; asked: boolean }

/** "62812...:7@s.whatsapp.net" to masked. */
function maskedJid(jid: string | undefined): string | null {
  const digits = jid?.split(/[:@]/)[0]
  return digits ? maskPhone(`+${digits}`) : null
}

/** Link lifecycle plus sending. */
export function createBaileysSender(deps: {
  db: Db
  factory: SocketFactory
  // Returns a cancel function
  schedule: (ms: number, run: () => void) => () => void
}) {
  let socket: SocketHandle | null = null
  let connected = false
  let link: Link | null = null
  let retryMs: number = RETRY_MS.first
  let cancelRetry = () => {}
  // 515 seen since open
  let restarted = false
  // Banned number, until relinked
  let loggedOut = false
  const set = (patch: Parameters<typeof updateSender>[2]) =>
    updateSender(deps.db, "baileys", patch)

  // Stale sockets' events ignored
  let generation = 0
  const drop = () => {
    generation += 1
    cancelRetry()
    socket?.end()
    socket = null
    connected = false
  }

  async function onUpdate(update: ConnectionUpdate): Promise<void> {
    if (update.qr && link?.method === "qr") {
      await set({ status: "linking", qr: update.qr, pairingCode: null })
    }
    if (update.qr && link?.method === "code" && !link.asked && socket) {
      link.asked = true
      const code = await socket.requestPairingCode(link.digits)
      await set({ status: "linking", qr: null, pairingCode: code })
    }
    if (update.connection === "open") {
      connected = true
      restarted = false
      loggedOut = false
      link = null
      retryMs = RETRY_MS.first
      await set({
        status: "connected",
        qr: null,
        pairingCode: null,
        pairingPhone: null,
        linkedPhone: maskedJid(update.me),
        lastConnectedAt: new Date(),
        lastSeenAt: new Date(),
        lastError: null,
      })
    }
    if (update.connection === "close") await onClose(update.statusCode)
  }

  async function onClose(code: number | undefined): Promise<void> {
    const linking = link !== null
    drop()
    // Once at once, then backoff
    if (code === RESTART_REQUIRED && !restarted) {
      restarted = true
      if (!linking) await set({ status: "disconnected" })
      return connect()
    }
    if (code === LOGGED_OUT || (linking && code === TIMED_OUT)) {
      link = null
      loggedOut = code === LOGGED_OUT
      await deps.factory.clear()
      await set({
        status: code === LOGGED_OUT ? "logged_out" : "unlinked",
        qr: null,
        pairingCode: null,
        linkedPhone: null,
        lastError:
          code === LOGGED_OUT
            ? SENDER_FAULTS.loggedOut
            : SENDER_FAULTS.linkTimeout,
      })
      return
    }
    await set({
      status: "disconnected",
      lastError: SENDER_FAULTS.disconnected(code),
    })
    const wait = retryMs
    retryMs = Math.min(retryMs * 2, RETRY_MS.max)
    // Unlink or relink cancels this
    const mine = generation
    cancelRetry = deps.schedule(wait, () => {
      if (mine === generation) void connect()
    })
  }

  async function connect(): Promise<void> {
    drop()
    const mine = generation
    socket = await deps.factory.open(async (update) => {
      if (mine === generation) await onUpdate(update)
    })
  }

  return {
    async start() {
      if (await deps.factory.hasSession()) {
        // Not ready until open
        await set({ status: "disconnected", lastError: null })
        return connect()
      }
      // Ban outlives restarts
      loggedOut = (await senderFault(deps.db)) === SENDER_FAULTS.loggedOut
      await set({
        status: loggedOut ? "logged_out" : "unlinked",
        qr: null,
        pairingCode: null,
      })
    },
    async handle(request: TakenRequest) {
      writeLog({ msg: "whatsapp request", request: request.requested })
      restarted = false
      loggedOut = false
      if (request.requested === "unlink") {
        await socket?.logout().catch(() => undefined)
        drop()
        link = null
        retryMs = RETRY_MS.first
        await deps.factory.clear()
        await set({
          status: "unlinked",
          qr: null,
          pairingCode: null,
          linkedPhone: null,
          lastError: null,
        })
        return
      }
      drop()
      retryMs = RETRY_MS.first
      await deps.factory.clear()
      const digits = request.pairingPhone?.replace(/^\+/, "") ?? ""
      link =
        request.requested === "link_code" && digits
          ? { method: "code", digits, asked: false }
          : { method: "qr" }
      await set({
        status: "linking",
        qr: null,
        pairingCode: null,
        lastError: null,
      })
      await connect()
    },
    async stop() {
      const linking = link !== null
      drop()
      // Deploy or lever, deliberate
      if (!linking && (loggedOut || (await deps.factory.hasSession()))) {
        await set({ status: "stopped" })
      }
    },
    provider: <WhatsAppProvider>{
      name: "baileys",
      async send({ to, code }, signal) {
        const current = socket
        if (!current || !connected) return "unavailable"
        const digits = to.replace(/^\+/, "")
        if (!(await abortable(current.exists(digits), signal))) {
          return "not_on_whatsapp"
        }
        await abortable(
          current.sendText(`${digits}@s.whatsapp.net`, whatsappCodeText(code)),
          signal,
        )
        return "sent"
      },
    },
  }
}

/** creds.update handler, never rejects. */
export function credsSaver(save: () => Promise<void>): () => void {
  // Next creds.update writes again
  return () => {
    save().catch((cause: unknown) =>
      writeLog({ msg: "whatsapp creds save failed", ...errorRecord(cause) }),
    )
  }
}

// Silent: no text logged
const SILENT = {
  level: "silent",
  child: () => SILENT,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

/** Real socket, Baileys loaded here. */
export function baileysFactory(db: Db, credsKey: Buffer): SocketFactory {
  const store = sealedStore(db, credsKey)
  const sent = sentCache()
  return {
    async hasSession() {
      const json = await store.read("creds")
      return json !== null && JSON.parse(json).registered === true
    },
    clear: () => store.clear(),
    async open(onUpdate) {
      const baileys = await import("baileys")
      const { state, saveCreds } = await authState(store, {
        replacer: baileys.BufferJSON.replacer,
        reviver: baileys.BufferJSON.reviver,
        initCreds: baileys.initAuthCreds,
        appStateKey: (value) =>
          baileys.proto.Message.AppStateSyncKeyData.fromObject(
            value as Record<string, unknown>,
          ),
      })
      const sock = baileys.makeWASocket({
        auth: state as never,
        logger: SILENT as never,
        browser: baileys.Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        // Re-encrypts on retry receipts
        getMessage: async (key) =>
          key.id ? (sent.get(key.id) as never) : undefined,
      })
      sock.ev.on("creds.update", credsSaver(saveCreds))
      sock.ev.on("connection.update", (update) => {
        const error = update.lastDisconnect?.error as
          | { output?: { statusCode?: number } }
          | undefined
        void onUpdate({
          connection: update.connection,
          qr: update.qr,
          statusCode: error?.output?.statusCode,
          me: sock.user?.id,
        }).catch((cause: unknown) =>
          writeLog({ msg: "whatsapp update failed", ...errorRecord(cause) }),
        )
      })
      return {
        requestPairingCode: (digits) => sock.requestPairingCode(digits),
        async exists(digits) {
          const found = await sock.onWhatsApp(digits)
          return found?.some((entry) => entry.exists) === true
        },
        sendText: (jid, text) =>
          sendCodeText(
            {
              sendMessage: (to, content, options) =>
                sock.sendMessage(to, content, options),
              chatModify: (mod, to) => sock.chatModify(mod, to),
            },
            (id, message) => sent.put(id, message),
            jid,
            text,
          ),
        logout: () => sock.logout(),
        end: () => sock.end(undefined),
      }
    },
  }
}
