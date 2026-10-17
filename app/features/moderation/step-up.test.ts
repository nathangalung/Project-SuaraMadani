import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { RouterContextProvider } from "react-router"
import { createDatabase } from "../../../db/client.server.ts"
import { migrate } from "../../../db/migrate.ts"
import {
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { type SessionContext, sessionContext } from "../../context.ts"
import {
  confirmStepUp,
  FRESH_MS,
  recordStepUp,
  requireFresh,
  stepUpNext,
} from "./step-up.server.ts"

const su = superuserPool()
const database = createDatabase(testUrl("TEST_DATABASE_URL"), "web")
let user = ""

async function session(createdAgoMs: number): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO sessions (token, user_id, expires_at, created_at)
     VALUES ($1, $2, now() + interval '1 day', now() - make_interval(secs => $3))
     RETURNING id`,
    [crypto.randomUUID(), user, createdAgoMs / 1000],
  )
  return rows[0]?.id ?? ""
}

function contextFor(id: string) {
  const context = new RouterContextProvider()
  const value: SessionContext = {
    user: {
      id: user,
      email: "admin.naik@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: true,
      updatedAt: new Date(0),
    },
    session: { id, createdAt: new Date(), expiresAt: new Date() },
  }
  context.set(sessionContext, value)
  return context
}

async function outcome(id: string): Promise<string> {
  try {
    await requireFresh(
      contextFor(id),
      new Request("http://itb.localhost/kelola/anggota?x=1"),
      database.db,
    )
    return "fresh"
  } catch (error) {
    if (error instanceof Response) return error.headers.get("Location") ?? ""
    throw error
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  user = await insertUser(su, "admin.naik@contoh.id")
})

afterAll(async () => {
  await resetData(su)
  await database.pool.end()
  await su.end()
})

describe("TOTP step-up, freshAge 300 s", () => {
  test("a session just signed in with TOTP is fresh", async () => {
    expect(await outcome(await session(60_000))).toBe("fresh")
  })

  test("an older session is sent to confirm, then back", async () => {
    const id = await session(FRESH_MS + 60_000)
    expect(await outcome(id)).toBe("/masuk/konfirmasi?ke=%2Fkelola%2Fanggota")
    expect(await recordStepUp(id, true, database.db)).toBe("ok")
    expect(await outcome(id)).toBe("fresh")
  })

  test("five wrong codes sign the session out", async () => {
    const id = await session(FRESH_MS + 60_000)
    for (let i = 0; i < 4; i++) {
      expect(await recordStepUp(id, false, database.db)).toBe("retry")
    }
    expect(await recordStepUp(id, false, database.db)).toBe("signed_out")
    const { rows } = await su.query("SELECT 1 FROM sessions WHERE id = $1", [
      id,
    ])
    expect(rows).toHaveLength(0)
  })

  test("the confirm form redirects only on a right code", async () => {
    const id = await session(FRESH_MS + 60_000)
    const submit = (code: string, right: boolean) =>
      confirmStepUp({
        request: new Request("http://itb.localhost/masuk/konfirmasi", {
          method: "POST",
          body: new URLSearchParams({ code }),
        }),
        sessionId: id,
        next: "/kelola/pengaturan",
        verify: async () => right,
        db: database.db,
      })
    expect(await submit("12a", true)).toEqual({ error: "format" })
    expect(await submit("123456", false)).toEqual({ error: "wrong" })
    const done = await submit("654 321", true)
    expect(done instanceof Response && done.headers.get("Location")).toBe(
      "/kelola/pengaturan",
    )
    expect(await outcome(id)).toBe("fresh")
  })

  test("only admin pages are valid return paths", () => {
    expect(stepUpNext("/kelola/anggota")).toBe("/kelola/anggota")
    expect(stepUpNext("/kelola/pengaturan")).toBe("/kelola/pengaturan")
    expect(stepUpNext("/admin")).toBe("/admin")
    expect(stepUpNext("/admin/whatsapp")).toBe("/admin/whatsapp")
    expect(stepUpNext("/admin/lain")).toBeNull()
    expect(stepUpNext("//evil.example")).toBeNull()
    expect(stepUpNext("/kelola/antrean")).toBeNull()
    expect(stepUpNext(null)).toBeNull()
  })
})
