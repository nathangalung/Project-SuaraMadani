import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { database } from "../../../db/client.server.ts"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { listSessions, revokeSessions } from "./sessions.server.ts"

const su = superuserPool()
let orgId = ""
let userId = ""
let otherUser = ""

async function sessionFor(
  owner: string,
  ageSeconds: number,
  userAgent = "Firefox",
): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO sessions (token, user_id, expires_at, created_at, ip_address, user_agent)
     VALUES ($1, $2, now() + interval '1 day', now() - make_interval(secs => $3), '203.0.113.9', $4)
     RETURNING id`,
    [crypto.randomUUID(), owner, ageSeconds, userAgent],
  )
  return rows[0]?.id ?? ""
}

async function ids(owner: string): Promise<string[]> {
  const { rows } = await su.query<{ id: string }>(
    "SELECT id FROM sessions WHERE user_id = $1 ORDER BY id",
    [owner],
  )
  return rows.map((row) => row.id)
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await resetData(su)
  orgId = await insertOrg(su, "sesi")
  userId = await insertUser(su, "sesi@contoh.id")
  otherUser = await insertUser(su, "lain@contoh.id")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("active sessions", () => {
  test("lists own sessions, current marked, no IP", async () => {
    // ASVS V7.5.2: view sessions
    const current = await sessionFor(userId, 10, "Chrome")
    const old = await sessionFor(userId, 3600)
    await sessionFor(otherUser, 10)
    const list = await listSessions(userId, current, database().db)
    expect(list.map((s) => [s.id, s.current, s.userAgent])).toEqual([
      [current, true, "Chrome"],
      [old, false, "Firefox"],
    ])
    expect(JSON.stringify(list)).not.toContain("203.0.113.9")
  })

  test("ends others or chosen ones after a fresh sign-in", async () => {
    // ASVS V7.4.3 and V7.5.2
    const current = await sessionFor(userId, 10)
    const a = await sessionFor(userId, 3600)
    const b = await sessionFor(userId, 7200)
    const foreign = await sessionFor(otherUser, 10)
    const db = database().db
    const input = { orgId, userId, currentSessionId: current }
    expect(await revokeSessions({ ...input, which: [a, foreign] }, db)).toEqual(
      { ok: true, ended: 1 },
    )
    expect(await ids(otherUser)).toEqual([foreign])
    expect(await revokeSessions({ ...input, which: "others" }, db)).toEqual({
      ok: true,
      ended: 1,
    })
    expect(await ids(userId)).toEqual([current])
    expect(b).not.toBe(current)
    const { rows } = await su.query(
      "SELECT action, entity_id FROM audit_log WHERE action = 'session.revoke'",
    )
    expect(rows).toEqual([
      { action: "session.revoke", entity_id: userId },
      { action: "session.revoke", entity_id: userId },
    ])
  })

  test("a stale session must re-authenticate first", async () => {
    const current = await sessionFor(userId, 600)
    const other = await sessionFor(userId, 3600)
    expect(
      await revokeSessions(
        { orgId, userId, currentSessionId: current, which: "others" },
        database().db,
      ),
    ).toEqual({ ok: false, reason: "stale" })
    expect((await ids(userId)).sort()).toEqual([current, other].sort())
  })
})
