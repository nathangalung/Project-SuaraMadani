import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { database } from "../../db/client.server.ts"
import { migrate } from "../../db/migrate.ts"
import { superuserPool, testUrl } from "../../db/testing.ts"
import { type AuthCodec, authState, sealedStore } from "./auth-state.ts"

const su = superuserPool()
const key = Buffer.alloc(32, 9)

// Stand-in for Baileys BufferJSON
const codec: AuthCodec = {
  replacer: (_key, value) => value,
  reviver: (_key, value) => value,
  initCreds: () => ({ registered: false, noiseKey: "rahasia-kunci" }),
  appStateKey: (value) => ({ wrapped: value }),
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await su.query("DELETE FROM whatsapp_auth")
})

afterAll(async () => {
  await su.query("DELETE FROM whatsapp_auth")
  await su.end()
})

describe("sealed auth state", () => {
  test("new creds until saved, then read back", async () => {
    const store = sealedStore(database().db, key)
    const first = await authState(store, codec)
    expect(first.state.creds).toEqual({
      registered: false,
      noiseKey: "rahasia-kunci",
    })
    ;(first.state.creds as { registered: boolean }).registered = true
    await first.saveCreds()
    const again = await authState(store, codec)
    expect(again.state.creds).toMatchObject({ registered: true })
  })

  test("keys set, get and delete; app state keys rebuilt", async () => {
    const { state } = await authState(sealedStore(database().db, key), codec)
    await state.keys.set({
      session: { "62812@s.whatsapp.net": { a: 1 } },
      "app-state-sync-key": { k1: { b: 2 } },
    })
    expect(
      await state.keys.get("session", ["62812@s.whatsapp.net", "x"]),
    ).toEqual({ "62812@s.whatsapp.net": { a: 1 } })
    expect(await state.keys.get("app-state-sync-key", ["k1"])).toEqual({
      k1: { wrapped: { b: 2 } },
    })
    await state.keys.set({ session: { "62812@s.whatsapp.net": null } })
    expect(await state.keys.get("session", ["62812@s.whatsapp.net"])).toEqual(
      {},
    )
  })

  test("contact row keys never hold the number", async () => {
    const { state } = await authState(sealedStore(database().db, key), codec)
    await state.keys.set({ session: { "6281234567890.0": { a: 1 } } })
    const { rows } = await su.query<{ key: string }>(
      "SELECT key FROM whatsapp_auth",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toStartWith("session-")
    expect(rows[0]?.key).not.toContain("81234567890")
    expect(await state.keys.get("session", ["6281234567890.0"])).toEqual({
      "6281234567890.0": { a: 1 },
    })
    const other = sealedStore(database().db, Buffer.alloc(32, 1))
    expect(other.keyOf("session", "6281234567890.0")).not.toBe(rows[0]?.key)
  })

  test("rows are sealed; another key reads nothing", async () => {
    const { saveCreds } = await authState(
      sealedStore(database().db, key),
      codec,
    )
    await saveCreds()
    const { rows } = await su.query<{ value: Buffer }>(
      "SELECT value FROM whatsapp_auth WHERE key = 'creds'",
    )
    expect(rows[0]?.value.toString("latin1")).not.toContain("rahasia-kunci")
    const other = sealedStore(database().db, Buffer.alloc(32, 1))
    expect(await other.read("creds")).toBeNull()
  })

  test("clear removes every row", async () => {
    const store = sealedStore(database().db, key)
    const { state, saveCreds } = await authState(store, codec)
    await saveCreds()
    await state.keys.set({ session: { a: { c: 3 } } })
    await store.clear()
    const { rows } = await su.query("SELECT 1 FROM whatsapp_auth")
    expect(rows.length).toBe(0)
  })
})
