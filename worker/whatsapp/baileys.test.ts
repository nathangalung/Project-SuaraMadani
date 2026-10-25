import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test"
import { EventEmitter } from "node:events"
import { database } from "../../db/client.server.ts"
import { migrate } from "../../db/migrate.ts"
import { superuserPool, testUrl } from "../../db/testing.ts"
import {
  baileysFactory,
  type ConnectionUpdate,
  createBaileysSender,
  credsSaver,
  type SocketFactory,
  type SocketHandle,
  sendCodeText,
  sentCache,
} from "./baileys.ts"
import { takeRequest, updateSender } from "./sender-row.ts"

const su = superuserPool()
const signal = new AbortController().signal

type FakeSocket = SocketHandle & {
  emit: (update: ConnectionUpdate) => Promise<void>
  sent: { jid: string; text: string }[]
  loggedOut: boolean
}

let sockets: FakeSocket[] = []
let session = false
let cleared = 0
let onWhatsApp = true
let hang = false
let logoutFails = false

const factory: SocketFactory = {
  hasSession: async () => session,
  clear: async () => {
    session = false
    cleared += 1
  },
  open: async (onUpdate) => {
    const socket: FakeSocket = {
      sent: [],
      loggedOut: false,
      emit: (update) => onUpdate(update),
      requestPairingCode: async (digits) => `KODE${digits.slice(-4)}`,
      exists: () =>
        hang ? new Promise<boolean>(() => {}) : Promise.resolve(onWhatsApp),
      sendText: async (jid, text) => {
        socket.sent.push({ jid, text })
      },
      logout: async () => {
        if (logoutFails) throw new Error("Connection Closed")
        socket.loggedOut = true
      },
      end: () => {},
    }
    sockets.push(socket)
    return socket
  },
}

const scheduled: number[] = []
function sender() {
  return createBaileysSender({
    db: database().db,
    factory,
    schedule: (ms, run) => {
      scheduled.push(ms)
      run()
      return () => {}
    },
  })
}

// Real timers: fire later
function deferred() {
  const pending: { run: () => void; cancelled: boolean }[] = []
  const s = createBaileysSender({
    db: database().db,
    factory,
    schedule: (_ms, run) => {
      const timer = { run, cancelled: false }
      pending.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })
  const fire = async () => {
    for (const timer of pending.splice(0)) if (!timer.cancelled) timer.run()
    await Bun.sleep(5)
  }
  return { s, fire }
}

async function row() {
  const { rows } = await su.query<{
    status: string
    qr: string | null
    pairing_code: string | null
    linked_phone: string | null
    last_error: string | null
    last_connected_at: Date | null
  }>(
    "SELECT status, qr, pairing_code, linked_phone, last_error, last_connected_at FROM whatsapp_sender WHERE id = 1",
  )
  return rows[0]
}

const last = () => {
  const socket = sockets.at(-1)
  if (!socket) throw new Error("no socket")
  return socket
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await su.query("DELETE FROM whatsapp_sender")
  sockets = []
  session = false
  cleared = 0
  onWhatsApp = true
  hang = false
  logoutFails = false
  scheduled.length = 0
})

afterAll(async () => {
  await su.query("DELETE FROM whatsapp_sender")
  await su.end()
})

describe("sentCache", () => {
  test("serves retries for five minutes, bounded", () => {
    let now = 0
    const cache = sentCache({ max: 2, ttlMs: 300_000, now: () => now })
    cache.put("a", { conversation: "A" })
    cache.put("b", { conversation: "B" })
    cache.put("c", { conversation: "C" })
    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("c")).toEqual({ conversation: "C" })
    now = 300_001
    expect(cache.get("c")).toBeUndefined()
  })
})

describe("Baileys sender", () => {
  test("no session: unlinked, sends refused", async () => {
    const s = sender()
    await s.start()
    expect((await row())?.status).toBe("unlinked")
    expect(sockets.length).toBe(0)
    expect(
      await s.provider.send({ to: "+6281234567890", code: "1" }, signal),
    ).toBe("unavailable")
  })

  test("QR link, then connected and sending plain text", async () => {
    const s = sender()
    await s.start()
    await s.handle({ requested: "link_qr", pairingPhone: null })
    expect(cleared).toBe(1)
    await last().emit({ qr: "2@abc" })
    expect(await row()).toMatchObject({ status: "linking", qr: "2@abc" })
    await last().emit({
      connection: "open",
      me: "6281299990001:7@s.whatsapp.net",
    })
    const linked = await row()
    expect(linked).toMatchObject({
      status: "connected",
      qr: null,
      linked_phone: "+62 812•••••001",
      last_error: null,
    })
    expect(linked?.last_connected_at).toBeInstanceOf(Date)
    expect(
      await s.provider.send({ to: "+6281234567890", code: "123456" }, signal),
    ).toBe("sent")
    expect(last().sent[0]?.jid).toBe("6281234567890@s.whatsapp.net")
    expect(last().sent[0]?.text).toContain("123456")
    onWhatsApp = false
    expect(
      await s.provider.send({ to: "+6281234567891", code: "1" }, signal),
    ).toBe("not_on_whatsapp")
  })

  test("pairing code for the given number", async () => {
    const s = sender()
    await s.start()
    await s.handle({ requested: "link_code", pairingPhone: "+6281299990002" })
    await last().emit({ qr: "2@abc" })
    expect(await row()).toMatchObject({
      status: "linking",
      qr: null,
      pairing_code: "KODE0002",
    })
    // One code per link request
    await last().emit({ qr: "2@def" })
    expect((await row())?.pairing_code).toBe("KODE0002")
  })

  test("restart after pairing reconnects at once", async () => {
    session = true
    const s = sender()
    await s.start()
    expect(sockets.length).toBe(1)
    await last().emit({ connection: "close", statusCode: 515 })
    expect(sockets.length).toBe(2)
  })

  test("repeated restarts back off and drop readiness", async () => {
    session = true
    const s = sender()
    await s.start()
    await last().emit({
      connection: "open",
      me: "6281299990001@s.whatsapp.net",
    })
    await last().emit({ connection: "close", statusCode: 515 })
    expect(sockets.length).toBe(2)
    expect(scheduled).toEqual([])
    expect((await row())?.status).toBe("disconnected")
    await last().emit({ connection: "close", statusCode: 515 })
    expect(scheduled).toEqual([5_000])
    await last().emit({
      connection: "open",
      me: "6281299990001@s.whatsapp.net",
    })
    await last().emit({ connection: "close", statusCode: 515 })
    expect(scheduled).toEqual([5_000])
  })

  test("a ban outlives restarts until relinked", async () => {
    session = true
    const s = sender()
    await s.start()
    await last().emit({
      connection: "open",
      me: "6281299990001@s.whatsapp.net",
    })
    await last().emit({ connection: "close", statusCode: 401 })
    // Lever: a deliberate stop
    await s.stop()
    expect(await row()).toMatchObject({
      status: "stopped",
      last_error: "logged_out",
    })
    // Deploy or lever off
    const next = sender()
    await next.start()
    expect((await row())?.status).toBe("logged_out")
    await next.stop()
    expect((await row())?.status).toBe("stopped")
    await sender().start()
    expect((await row())?.status).toBe("logged_out")
    await sender().handle({ requested: "unlink", pairingPhone: null })
    await sender().start()
    expect((await row())?.status).toBe("unlinked")
  })

  test("logged out from the phone: session cleared, admin told", async () => {
    session = true
    const s = sender()
    await s.start()
    await last().emit({
      connection: "open",
      me: "6281299990001@s.whatsapp.net",
    })
    await last().emit({ connection: "close", statusCode: 401 })
    expect(await row()).toMatchObject({
      status: "logged_out",
      last_error: "logged_out",
    })
    expect(cleared).toBe(1)
    expect(
      await s.provider.send({ to: "+6281234567890", code: "1" }, signal),
    ).toBe("unavailable")
  })

  test("a dropped link retries with growing delays", async () => {
    session = true
    const s = sender()
    await s.start()
    await last().emit({ connection: "close", statusCode: 428 })
    await Bun.sleep(5)
    await last().emit({ connection: "close", statusCode: 428 })
    expect(await row()).toMatchObject({
      status: "disconnected",
      last_error: "disconnected:428",
    })
    expect(sockets.length).toBe(3)
    expect(scheduled).toEqual([5_000, 10_000])
  })

  test("unlink logs out and forgets the session", async () => {
    session = true
    const s = sender()
    await s.start()
    await last().emit({
      connection: "open",
      me: "6281299990001@s.whatsapp.net",
    })
    const socket = last()
    await s.handle({ requested: "unlink", pairingPhone: null })
    expect(socket.loggedOut).toBe(true)
    expect(cleared).toBe(1)
    expect(await row()).toMatchObject({
      status: "unlinked",
      linked_phone: null,
    })
  })

  test("Given the socket already closed, when an admin unlinks, then the session is still forgotten", async () => {
    session = true
    const s = sender()
    await s.start()
    await last().emit({
      connection: "open",
      me: "6281299990001@s.whatsapp.net",
    })
    logoutFails = true
    await s.handle({ requested: "unlink", pairingPhone: null })
    expect(last().loggedOut).toBe(false)
    expect(cleared).toBe(1)
    expect(await row()).toMatchObject({
      status: "unlinked",
      linked_phone: null,
    })
  })

  test("a replaced socket's late close changes nothing", async () => {
    session = true
    const s = sender()
    await s.start()
    const old = last()
    await s.handle({ requested: "link_qr", pairingPhone: null })
    await old.emit({ connection: "close", statusCode: 401 })
    expect(cleared).toBe(1)
    expect((await row())?.status).toBe("linking")
  })

  test("a retry pending at unlink never reconnects", async () => {
    session = true
    const { s, fire } = deferred()
    await s.start()
    await last().emit({
      connection: "open",
      me: "6281299990001@s.whatsapp.net",
    })
    await last().emit({ connection: "close", statusCode: 428 })
    await s.handle({ requested: "unlink", pairingPhone: null })
    await fire()
    expect(sockets.length).toBe(1)
    expect((await row())?.status).toBe("unlinked")
  })

  test("a retry pending at a code link keeps the code's socket", async () => {
    session = true
    const { s, fire } = deferred()
    await s.start()
    await last().emit({ connection: "close", statusCode: 428 })
    await s.handle({ requested: "link_code", pairingPhone: "+6281299990002" })
    const linking = last()
    await linking.emit({ qr: "2@abc" })
    await fire()
    expect(last()).toBe(linking)
    expect((await row())?.pairing_code).toBe("KODE0002")
  })

  test("a link timeout is stored as a fault code", async () => {
    const s = sender()
    await s.start()
    await s.handle({ requested: "link_qr", pairingPhone: null })
    await last().emit({ connection: "close", statusCode: 408 })
    expect(await row()).toMatchObject({
      status: "unlinked",
      last_error: "link_timeout",
    })
  })

  test("start and stop never leave a stale connected row", async () => {
    await updateSender(database().db, "baileys", {
      status: "connected",
      lastSeenAt: new Date(),
    })
    session = true
    const s = sender()
    await s.start()
    expect((await row())?.status).toBe("disconnected")
    await last().emit({
      connection: "open",
      me: "6281299990001@s.whatsapp.net",
    })
    expect((await row())?.status).toBe("connected")
    await s.stop()
    expect((await row())?.status).toBe("stopped")
  })

  test("a stop while reconnecting is still deliberate", async () => {
    session = true
    const s = sender()
    await s.start()
    await last().emit({ connection: "close", statusCode: 428 })
    expect((await row())?.status).toBe("disconnected")
    await s.stop()
    expect((await row())?.status).toBe("stopped")
  })

  test("a stop never relabels an unlinked sender", async () => {
    const s = sender()
    await s.start()
    await s.stop()
    expect((await row())?.status).toBe("unlinked")
  })

  test("a hung send gives up on abort", async () => {
    session = true
    const s = sender()
    await s.start()
    await last().emit({
      connection: "open",
      me: "6281299990001@s.whatsapp.net",
    })
    hang = true
    const controller = new AbortController()
    const sending = s.provider.send(
      { to: "+6281234567890", code: "1" },
      controller.signal,
    )
    controller.abort(new Error("timeout"))
    expect(sending).rejects.toThrow("timeout")
  })

  test("admin requests are claimed once", async () => {
    await updateSender(database().db, "baileys", {
      status: "unlinked",
      requested: "link_code",
      pairingPhone: "+6281299990003",
    })
    expect(await takeRequest(database().db)).toEqual({
      requested: "link_code",
      pairingPhone: "+6281299990003",
    })
    expect(await takeRequest(database().db)).toBeNull()
  })
})

describe("code messages on the sender handset", () => {
  function fakeSock(deleteFails = false) {
    const calls: { kind: string; args: unknown[] }[] = []
    return {
      calls,
      sock: {
        async sendMessage(
          jid: string,
          content: { text: string },
          options: unknown,
        ) {
          calls.push({ kind: "send", args: [jid, content, options] })
          return {
            key: { id: "m1", remoteJid: jid, fromMe: true },
            message: { conversation: content.text },
            messageTimestamp: 1_792_000_000,
          }
        },
        async chatModify(mod: unknown, jid: string) {
          calls.push({ kind: "modify", args: [mod, jid] })
          if (deleteFails) throw new Error("app state not synced")
        },
      },
    }
  }

  test("sent disappearing, then the chat is deleted", async () => {
    const { sock, calls } = fakeSock()
    const kept: string[] = []
    await sendCodeText(
      sock,
      (id) => kept.push(id),
      "62812@s.whatsapp.net",
      "Kode 123456",
    )
    expect(calls[0]?.args[2]).toEqual({ ephemeralExpiration: 86_400 })
    expect(calls[1]).toEqual({
      kind: "modify",
      args: [
        {
          delete: true,
          lastMessages: [
            {
              key: {
                id: "m1",
                remoteJid: "62812@s.whatsapp.net",
                fromMe: true,
              },
              messageTimestamp: 1_792_000_000,
            },
          ],
        },
        "62812@s.whatsapp.net",
      ],
    })
    // Retry receipts still served
    expect(kept).toEqual(["m1"])
  })

  test("a failed delete never fails the send", async () => {
    const { sock } = fakeSock(true)
    await expect(
      sendCodeText(sock, () => {}, "62812@s.whatsapp.net", "Kode 123456"),
    ).resolves.toBeUndefined()
  })
})

describe("creds save", () => {
  test("a failed save is logged, never an unhandled rejection", async () => {
    const logged = spyOn(console, "log").mockImplementation(() => {})
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      const save = credsSaver(() =>
        Promise.reject(new Error("timeout exceeded when trying to connect")),
      )
      save()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
      const lines = logged.mock.calls.map((call) => String(call[0]))
      expect(
        lines.some((line) => line.includes("whatsapp creds save failed")),
      ).toBe(true)
    } finally {
      process.off("unhandledRejection", onUnhandled)
      logged.mockRestore()
    }
  })
})

describe("Baileys socket adapter", () => {
  type Baileys = typeof import("baileys")
  type Config = Parameters<Baileys["makeWASocket"]>[0]
  const credsKey = Buffer.alloc(32, 9)
  const calls: { kind: string; args: unknown[] }[] = []
  let config: Config | undefined
  let ev = new EventEmitter()
  let registered = true

  // Real codec, fake socket only
  async function load(): Promise<Baileys> {
    const real = await import("baileys")
    const makeWASocket = (given: Config) => {
      config = given
      ev = new EventEmitter()
      return {
        ev,
        user: { id: "6281234567890:7@s.whatsapp.net" },
        requestPairingCode: async (digits: string) => {
          calls.push({ kind: "pair", args: [digits] })
          return "PAIR1234"
        },
        onWhatsApp: async (digits: string) =>
          registered ? [{ exists: true, jid: `${digits}@s.whatsapp.net` }] : [],
        sendMessage: async (
          jid: string,
          content: unknown,
          options: unknown,
        ) => {
          calls.push({ kind: "send", args: [jid, content, options] })
          return {
            key: { id: "M1", remoteJid: jid, fromMe: true },
            message: { conversation: "Kode" },
            messageTimestamp: 1,
          }
        },
        chatModify: async (mod: unknown, jid: string) => {
          calls.push({ kind: "modify", args: [mod, jid] })
        },
        logout: async () => {
          calls.push({ kind: "logout", args: [] })
        },
        end: () => {},
      }
    }
    // Only the socket is fake
    return {
      ...real,
      makeWASocket: makeWASocket as unknown as Baileys["makeWASocket"],
    }
  }

  const adapter = () => baileysFactory(database().db, credsKey, load)
  const update = (value: object) => ev.emit("connection.update", value)
  async function until(check: () => Promise<boolean>): Promise<void> {
    for (let tries = 0; tries < 100; tries++) {
      if (await check()) return
      await Bun.sleep(10)
    }
    throw new Error("condition never held")
  }
  const authRows = async () =>
    (await su.query<{ value: Buffer }>("SELECT value FROM whatsapp_auth")).rows
  function linked() {
    const s = createBaileysSender({
      db: database().db,
      factory: adapter(),
      schedule: () => () => {},
    })
    return s
  }

  beforeEach(async () => {
    await su.query("DELETE FROM whatsapp_auth")
    calls.length = 0
    config = undefined
    registered = true
  })

  afterAll(async () => {
    await su.query("DELETE FROM whatsapp_auth")
  })

  test("Given a QR link, when the phone pairs, then creds are sealed and survive a restart", async () => {
    const s = linked()
    await s.start()
    await s.handle({ requested: "link_qr", pairingPhone: null })
    update({ qr: "QR-1" })
    await until(async () => (await row())?.qr === "QR-1")
    const creds = config?.auth.creds
    if (!creds) throw new Error("socket not opened")
    creds.registered = true
    ev.emit("creds.update", {})
    await until(async () => (await authRows()).length > 0)
    const [stored] = await authRows()
    expect(stored?.value.toString("utf8")).not.toContain("registered")
    update({ connection: "open" })
    await until(async () => (await row())?.status === "connected")
    expect((await row())?.linked_phone).toBe("+62 812•••••890")
    // New process sees the session
    expect(await adapter().hasSession()).toBe(true)
    await s.stop()
    expect((await row())?.status).toBe("stopped")
  })

  test("Given an open socket, when a code is sent, then it disappears and retries can re-read it", async () => {
    const s = linked()
    await s.handle({ requested: "link_qr", pairingPhone: null })
    update({ connection: "open" })
    await until(async () => (await row())?.status === "connected")
    const to = "+6281234567890"
    expect(await s.provider.send({ to, code: "135790" }, signal)).toBe("sent")
    const [send, modify] = calls
    expect(send?.args[0]).toBe("6281234567890@s.whatsapp.net")
    expect(JSON.stringify(send?.args[1])).toContain("135790")
    expect(send?.args[2]).toEqual({ ephemeralExpiration: 86_400 })
    expect(modify?.kind).toBe("modify")
    // Baileys asks on retry receipts
    const getMessage = config?.getMessage
    if (!getMessage) throw new Error("no getMessage")
    expect(await getMessage({ id: "M1" })).toEqual({ conversation: "Kode" })
    expect(await getMessage({})).toBeUndefined()
    registered = false
    expect(await s.provider.send({ to, code: "1" }, signal)).toBe(
      "not_on_whatsapp",
    )
    await s.handle({ requested: "unlink", pairingPhone: null })
    expect(calls.at(-1)?.kind).toBe("logout")
    expect((await row())?.status).toBe("unlinked")
  })

  test("Given a pairing-code link, when WhatsApp is ready, then the panel shows the code", async () => {
    const s = linked()
    await s.handle({ requested: "link_code", pairingPhone: "+6281234567890" })
    update({ qr: "QR-2" })
    await until(async () => (await row())?.pairing_code === "PAIR1234")
    expect(calls).toEqual([{ kind: "pair", args: ["6281234567890"] }])
    await s.stop()
  })

  test("Given a linked phone, when WhatsApp logs it out, then the session is wiped", async () => {
    const s = linked()
    await s.handle({ requested: "link_qr", pairingPhone: null })
    const creds = config?.auth.creds
    if (!creds) throw new Error("socket not opened")
    creds.registered = true
    ev.emit("creds.update", {})
    await until(async () => (await authRows()).length > 0)
    update({
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    })
    await until(async () => (await row())?.status === "logged_out")
    expect(await authRows()).toEqual([])
    expect(await adapter().hasSession()).toBe(false)
  })

  test("Given a status write fails, when the socket reports, then it is logged, never unhandled", async () => {
    const logged = spyOn(console, "log").mockImplementation(() => {})
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      await adapter().open(() =>
        Promise.reject(new Error("timeout exceeded when trying to connect")),
      )
      update({ connection: "open" })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])
      const lines = logged.mock.calls.map((call) => String(call[0]))
      expect(
        lines.some((line) => line.includes("whatsapp update failed")),
      ).toBe(true)
    } finally {
      process.off("unhandledRejection", onUnhandled)
      logged.mockRestore()
    }
  })

  test("Given Baileys logs a number, when the socket runs, then nothing is written", async () => {
    await adapter().open(async () => {})
    const logger = config?.logger
    if (!logger) throw new Error("socket not opened")
    const writes = [
      spyOn(console, "log"),
      spyOn(console, "error"),
      spyOn(process.stdout, "write"),
      spyOn(process.stderr, "write"),
    ]
    try {
      const child = logger.child({ class: "socket" })
      for (const sink of [logger, child]) {
        expect(sink.level).toBe("silent")
        sink.trace({ jid: "6281234567890" }, "send")
        sink.debug("6281234567890")
        sink.info("6281234567890")
        sink.warn("6281234567890")
        sink.error("6281234567890")
      }
      for (const write of writes) expect(write).not.toHaveBeenCalled()
    } finally {
      for (const write of writes) write.mockRestore()
    }
  })

  test("Given app state keys, when Baileys reads one back, then it gets a proto message", async () => {
    const { proto } = await import("baileys")
    await linked().handle({ requested: "link_qr", pairingPhone: null })
    const keys = config?.auth.keys
    if (!keys) throw new Error("socket not opened")
    await keys.set({
      "app-state-sync-key": {
        K1: proto.Message.AppStateSyncKeyData.fromObject({
          keyData: new Uint8Array([1, 2, 3]),
        }),
      },
    })
    const found = await keys.get("app-state-sync-key", ["K1"])
    expect(found.K1).toBeInstanceOf(proto.Message.AppStateSyncKeyData)
    expect(Array.from(found.K1?.keyData ?? [])).toEqual([1, 2, 3])
  })
})
