import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import { insertUser, superuserPool, testUrl } from "../../../db/testing.ts"
import { qrPath, readSender, requestSender } from "./admin.server.ts"

const su = superuserPool()
const NOW = new Date("2026-10-16T03:00:00Z")
let actor = ""

async function row() {
  const { rows } = await su.query<{
    requested: string | null
    pairing_phone: string | null
    requested_by: string | null
  }>(
    "SELECT requested, pairing_phone, requested_by FROM whatsapp_sender WHERE id = 1",
  )
  return rows[0]
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await su.query("DELETE FROM users WHERE email = 'operator.wa@contoh.test'")
  actor = await insertUser(su, "operator.wa@contoh.test")
})

beforeEach(async () => {
  await su.query("DELETE FROM whatsapp_sender")
})

afterAll(async () => {
  await su.query("DELETE FROM whatsapp_sender")
  await su.query("DELETE FROM users WHERE id = $1", [actor])
  await su.end()
})

describe("sender view", () => {
  test("no worker yet: not running, nothing to show", async () => {
    expect(await readSender(NOW)).toEqual({
      provider: null,
      status: "unlinked",
      running: false,
      ready: false,
      linkedPhone: null,
      lastConnectedAt: null,
      lastError: null,
      qr: null,
      pairingCode: null,
      pending: false,
    })
  })

  test("linking shows a QR as path data, never the raw text", async () => {
    await su.query(
      `INSERT INTO whatsapp_sender (id, provider, status, qr, last_seen_at)
       VALUES (1, 'baileys', 'linking', '2@rahasia,abc', $1)`,
      [new Date(NOW.getTime() - 5_000)],
    )
    const view = await readSender(NOW)
    expect(view.running).toBe(true)
    expect(view.qr?.size).toBeGreaterThan(20)
    expect(view.qr?.path).toMatch(/^M\d/)
    expect(JSON.stringify(view)).not.toContain("rahasia")
  })
})

describe("link requests", () => {
  test("QR, pairing code and unlink are recorded for the worker", async () => {
    expect(
      await requestSender({
        intent: "link_code",
        phone: "0812 9999 0003",
        actorId: actor,
      }),
    ).toEqual({ ok: true })
    expect(await row()).toEqual({
      requested: "link_code",
      pairing_phone: "+6281299990003",
      requested_by: actor,
    })
    await requestSender({ intent: "unlink", actorId: actor })
    expect(await row()).toMatchObject({
      requested: "unlink",
      pairing_phone: null,
    })
    expect((await readSender(NOW)).pending).toBe(true)
  })

  test("a pairing code needs an Indonesian mobile number", async () => {
    expect(
      await requestSender({
        intent: "link_code",
        phone: "0221234567",
        actorId: actor,
      }),
    ).toEqual({ ok: false, error: "phone" })
    expect(await row()).toBeUndefined()
  })
})

describe("qrPath", () => {
  test("one path for every dark module", () => {
    const qr = qrPath("2@abc")
    expect(qr.size).toBe(23)
    expect(qr.path.match(/M/g)?.length).toBeGreaterThan(50)
    expect(qrPath("2@abc")).toEqual(qr)
  })
})
