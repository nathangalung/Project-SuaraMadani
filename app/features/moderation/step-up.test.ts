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
import type { Auth } from "../../../server/auth.server.ts"
import { type SessionContext, sessionContext } from "../../context.ts"
import {
  confirmStepUp,
  FRESH_MS,
  recordStepUp,
  requireFresh,
  stepUpAction,
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
    const lines: Record<string, unknown>[] = []
    const log = (line: Record<string, unknown>) => lines.push(line)
    for (let i = 0; i < 4; i++) {
      expect(await recordStepUp(id, false, database.db, log)).toBe("retry")
    }
    expect(await recordStepUp(id, false, database.db, log)).toBe("signed_out")
    // OWASP A09: every miss logged
    expect(lines.map((line) => [line.event, line.failures])).toEqual([
      ["step_up_failed", 1],
      ["step_up_failed", 2],
      ["step_up_failed", 3],
      ["step_up_failed", 4],
      ["step_up_signed_out", 5],
    ])
    expect(lines[0]).toMatchObject({ msg: "security", session_id: id })
    const { rows } = await su.query("SELECT 1 FROM sessions WHERE id = $1", [
      id,
    ])
    expect(rows).toHaveLength(0)
  })

  test("the confirm form redirects only on a right code", async () => {
    const id = await session(FRESH_MS + 60_000)
    // ASVS V7.2.4: rotated on success
    const rotatedTo = await session(FRESH_MS + 60_000)
    let rotations = 0
    const submit = (code: string, right: boolean) =>
      confirmStepUp({
        request: new Request("http://itb.localhost/masuk/konfirmasi", {
          method: "POST",
          body: new URLSearchParams({ code }),
        }),
        sessionId: id,
        next: "/kelola/pengaturan",
        verify: async () => right,
        rotate: async () => {
          rotations++
          return {
            sessionId: rotatedTo,
            setCookie: ["sb.session_token=baru; Path=/; HttpOnly"],
          }
        },
        db: database.db,
      })
    expect(await submit("12a", true)).toEqual({ error: "format" })
    expect(await submit("123456", false)).toEqual({ error: "wrong" })
    expect(rotations).toBe(0)
    const done = await submit("654 321", true)
    if (!(done instanceof Response)) throw new Error("no redirect")
    expect(done.headers.get("Location")).toBe("/kelola/pengaturan")
    expect(done.headers.get("Set-Cookie")).toContain("sb.session_token=baru")
    expect(rotations).toBe(1)
    expect(await outcome(rotatedTo)).toBe("fresh")
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

describe("stepUpAction, Better Auth in-process", () => {
  const COOKIE = "sb.session_token=lama"

  /** Records what Better Auth received. */
  function fakeAuth(right: boolean, rotatedTo: string) {
    const calls: { verify: unknown[]; rotate: unknown[] } = {
      verify: [],
      rotate: [],
    }
    const auth = {
      api: {
        verifyTOTP: (input: { headers: Headers; body: unknown }) => {
          calls.verify.push({
            cookie: input.headers.get("cookie"),
            body: input.body,
          })
          return right
            ? Promise.resolve({ token: "t" })
            : Promise.reject(new Error("INVALID_CODE"))
        },
        rotateSession: (input: { headers: Headers }) => {
          calls.rotate.push(input.headers.get("cookie"))
          return Promise.resolve({
            response: { id: rotatedTo },
            headers: new Headers({
              "Set-Cookie": "sb.session_token=baru; Path=/; HttpOnly",
            }),
          })
        },
      },
    } as unknown as Auth
    return { auth, calls }
  }

  const confirm = (code: string, next = "/kelola/anggota") =>
    new Request(
      `http://itb.localhost/masuk/konfirmasi?ke=${encodeURIComponent(next)}`,
      {
        method: "POST",
        headers: { cookie: COOKIE },
        body: new URLSearchParams({ code }),
      },
    )

  async function failures(id: string): Promise<number | undefined> {
    const { rows } = await su.query<{ step_up_failures: number }>(
      "SELECT step_up_failures FROM sessions WHERE id = $1",
      [id],
    )
    return rows[0]?.step_up_failures
  }

  test("Given no session, when a code is posted, then sign in first", async () => {
    const context = new RouterContextProvider()
    context.set(sessionContext, null)
    const { auth, calls } = fakeAuth(true, "")
    let thrown: unknown
    try {
      await stepUpAction(confirm("123456"), context, auth)
    } catch (error) {
      thrown = error
    }
    if (!(thrown instanceof Response)) throw new Error("no redirect")
    expect(thrown.headers.get("Location")).toBe("/masuk")
    expect(calls.verify).toEqual([])
  })

  test("Given a right code, when posted, then the session rotates, is fresh, and returns to the page", async () => {
    const id = await session(FRESH_MS + 60_000)
    const rotatedTo = await session(FRESH_MS + 60_000)
    const { auth, calls } = fakeAuth(true, rotatedTo)
    const result = await stepUpAction(confirm("654 321"), contextFor(id), auth)
    if (!(result instanceof Response)) throw new Error("no redirect")
    expect(result.status).toBe(303)
    expect(result.headers.get("Location")).toBe("/kelola/anggota")
    expect(result.headers.get("Set-Cookie")).toContain("sb.session_token=baru")
    expect(calls).toEqual({
      verify: [{ cookie: COOKIE, body: { code: "654321" } }],
      rotate: [COOKIE],
    })
    expect(await outcome(rotatedTo)).toBe("fresh")
  })

  test("Given a return path off the admin pages, when confirmed, then it lands on /kelola", async () => {
    const id = await session(FRESH_MS + 60_000)
    const rotatedTo = await session(FRESH_MS + 60_000)
    const { auth } = fakeAuth(true, rotatedTo)
    const result = await stepUpAction(
      confirm("654321", "//evil.example"),
      contextFor(id),
      auth,
    )
    if (!(result instanceof Response)) throw new Error("no redirect")
    expect(result.headers.get("Location")).toBe("/kelola")
  })

  test("Given a wrong code, when posted, then asked again and the miss is counted", async () => {
    const id = await session(FRESH_MS + 60_000)
    const { auth, calls } = fakeAuth(false, "")
    expect(await stepUpAction(confirm("111111"), contextFor(id), auth)).toEqual(
      { error: "wrong" },
    )
    expect(calls.rotate).toEqual([])
    expect(await failures(id)).toBe(1)
    expect(await outcome(id)).toBe("/masuk/konfirmasi?ke=%2Fkelola%2Fanggota")
  })
})
