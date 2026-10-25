import { afterAll, describe, expect, spyOn, test } from "bun:test"
import { APIError } from "better-auth/api"
import { RouterContextProvider } from "react-router"
import { insertOrg, insertUser, superuserPool } from "../../../db/testing.ts"
import type { Auth } from "../../../server/auth.server.ts"
import {
  type SessionContext,
  sessionContext,
  tenantContext,
} from "../../context.ts"
import {
  hasChallengeCookie,
  readBackupCode,
  readTotpCode,
  secretFromUri,
  staffHome,
  twoFactorAction,
  twoFactorLoader,
  twoFactorView,
} from "./two-factor.server.ts"

const now = new Date("2026-10-13T03:00:00Z")

function session(
  twoFactorEnabled: boolean,
  createdAt = now,
  updatedAt = now,
): SessionContext {
  return {
    user: {
      id: "u",
      email: "moderator@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled,
      updatedAt,
    },
    session: { id: "s", createdAt, expiresAt: now },
  }
}

describe("twoFactorView", () => {
  test("without a session or challenge, sign in first", () => {
    expect(
      twoFactorView({ session: null, role: null, hasChallenge: false, now }),
    ).toEqual({ mode: "sign_in" })
  })

  test("a pending challenge asks for the code", () => {
    expect(
      twoFactorView({ session: null, role: null, hasChallenge: true, now }),
    ).toEqual({ mode: "challenge" })
  })

  test("a reporter is not staff", () => {
    expect(
      twoFactorView({
        session: session(false),
        role: "reporter",
        hasChallenge: false,
        now,
      }),
    ).toEqual({ mode: "not_staff" })
  })

  test("staff without TOTP enroll", () => {
    expect(
      twoFactorView({
        session: session(false),
        role: "admin",
        hasChallenge: false,
        now,
      }),
    ).toEqual({ mode: "enroll", email: "moderator@contoh.id" })
  })

  test("staff with a TOTP session are done", () => {
    expect(
      twoFactorView({
        session: session(true),
        role: "admin",
        hasChallenge: false,
        now,
      }),
    ).toEqual({ mode: "done" })
  })

  test("a superadmin without a campus role enrols", () => {
    expect(
      twoFactorView({
        session: session(false),
        role: null,
        superadmin: true,
        hasChallenge: false,
        now,
      }),
    ).toEqual({ mode: "enroll", email: "moderator@contoh.id" })
    expect(
      twoFactorView({
        session: session(true),
        role: "reporter",
        superadmin: true,
        hasChallenge: false,
        now,
      }),
    ).toEqual({ mode: "done" })
  })

  test("staff land on /kelola, a superadmin only on /admin", () => {
    expect(staffHome("admin")).toBe("/kelola")
    expect(staffHome("admin")).toBe("/kelola")
    expect(staffHome(null)).toBe("/admin")
    expect(staffHome("reporter")).toBe("/admin")
  })

  test("a session older than the enrollment must sign in again", () => {
    const before = new Date(now.getTime() - 60_000)
    expect(
      twoFactorView({
        session: session(true, before, now),
        role: "admin",
        hasChallenge: false,
        now,
      }),
    ).toEqual({ mode: "stale" })
  })
})

describe("hasChallengeCookie", () => {
  test.each([
    ["sb.two_factor=abc", true],
    ["a=1; __Secure-sb.two_factor=abc", true],
    ["a=1; __Host-sb.two_factor=abc", true],
    ["sb.session_token=abc", false],
    ["", false],
  ])("%p is %p", (cookie, expected) => {
    expect(hasChallengeCookie(cookie)).toBe(expected)
  })
})

describe("readTotpCode", () => {
  test("accepts six digits with spaces", () => {
    expect(readTotpCode(" 123 456 ")).toBe("123456")
  })

  test.each(["12345", "abcdef", "1234567", ""])("rejects %p", (value) => {
    expect(readTotpCode(value)).toBeNull()
  })
})

describe("readBackupCode", () => {
  test("keeps case and the dash of a generated code", () => {
    expect(readBackupCode(" xwFYI-Hb7up ")).toBe("xwFYI-Hb7up")
  })

  test("adds the dash when it was left out", () => {
    expect(readBackupCode("xwFYIHb7up")).toBe("xwFYI-Hb7up")
  })

  test("reads the 20-character codes", () => {
    // ASVS V6.5.2: 112-bit minimum
    expect(readBackupCode("xwFYI-Hb7up-Q2rTz-9kLmN")).toBe(
      "xwFYI-Hb7up-Q2rTz-9kLmN",
    )
    expect(readBackupCode("xwFYIHb7upQ2rTz9kLmN")).toBe(
      "xwFYI-Hb7up-Q2rTz-9kLmN",
    )
    expect(readBackupCode("xwFYI-Hb7up-Q2rTz")).toBeNull()
  })

  test.each(["123456", "xwFYI-Hb7u", "xwFYI_Hb7up", ""])(
    "rejects %p",
    (value) => {
      expect(readBackupCode(value)).toBeNull()
    },
  )
})

describe("secretFromUri", () => {
  test("reads the secret for manual entry", () => {
    expect(
      secretFromUri(
        "otpauth://totp/Suara%20Madani:m%40contoh.id?secret=JBSWY3DPEHPK3PXP&issuer=Suara%20Madani",
      ),
    ).toBe("JBSWY3DPEHPK3PXP")
  })

  test("returns null for another scheme", () => {
    expect(secretFromUri("https://example.com/?secret=X")).toBeNull()
  })
})

describe("twoFactorAction", () => {
  const su = superuserPool()
  afterAll(async () => {
    await su.end()
  })

  const challengeContext = () => {
    const context = new RouterContextProvider()
    context.set(tenantContext, {
      id: crypto.randomUUID(),
      slug: "tf",
      host: "tf.localhost",
      name: "",
      campusCode: "TF",
      campusName: "",
      theme: {},
      settings: {},
    })
    context.set(sessionContext, null)
    return context
  }

  const challengeRequest = (body: Record<string, string>) =>
    new Request("http://tf.localhost/masuk/dua-langkah", {
      method: "POST",
      headers: { cookie: "sb.two_factor=signed" },
      body: new URLSearchParams(body),
    })

  test("a backup code signs the challenge in", async () => {
    const calls: unknown[] = []
    const auth = {
      api: {
        verifyBackupCode: (input: { body: unknown }) => {
          calls.push(input.body)
          return Promise.resolve(
            new Response(null, {
              headers: { "Set-Cookie": "sb.session_token=t; Path=/" },
            }),
          )
        },
      },
    } as unknown as Auth
    const result = await twoFactorAction(
      {
        request: challengeRequest({ intent: "backup", code: "xwFYIHb7up" }),
        context: challengeContext(),
      },
      auth,
    )
    expect(calls).toEqual([{ code: "xwFYI-Hb7up" }])
    if (!(result instanceof Response)) throw new Error("no redirect")
    // Loader sends staff to /kelola
    expect(result.headers.get("Location")).toBe("/masuk/dua-langkah")
    expect(result.headers.get("Set-Cookie")).toContain("sb.session_token=t")
  })

  test("a wrong or malformed backup code is reported", async () => {
    const auth = {
      api: {
        verifyBackupCode: () =>
          Promise.resolve(new Response(null, { status: 401 })),
      },
    } as unknown as Auth
    const run = (code: string) =>
      twoFactorAction(
        {
          request: challengeRequest({ intent: "backup", code }),
          context: challengeContext(),
        },
        auth,
      )
    expect(await run("123456")).toEqual({
      kind: "error",
      error: "backup_format",
    })
    expect(await run("xwFYI-Hb7up")).toEqual({
      kind: "error",
      error: "backup_wrong",
    })
  })

  const URI =
    "otpauth://totp/Suara%20Madani:staf%40contoh.id?secret=JBSWY3DPEHPK3PXP&issuer=Suara+Madani"

  // Real member row, stubbed auth
  async function withEnrolling(
    run: (context: RouterContextProvider, userId: string) => Promise<void>,
  ) {
    const slug = `te${String(Date.now()).slice(-6)}`
    const orgId = await insertOrg(su, slug)
    const email = `${slug}@contoh.id`
    const userId = await insertUser(su, email)
    try {
      await su.query(
        "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
        [orgId, userId],
      )
      const context = new RouterContextProvider()
      context.set(tenantContext, {
        id: orgId,
        slug,
        host: `${slug}.localhost`,
        name: "",
        campusCode: "TE",
        campusName: "",
        theme: {},
        settings: {},
      })
      const base = session(false)
      context.set(sessionContext, {
        ...base,
        user: { ...base.user, id: userId, email },
      })
      await run(context, userId)
    } finally {
      await su.query("DELETE FROM members WHERE user_id = $1", [userId])
      await su.query("DELETE FROM users WHERE id = $1", [userId])
      await su.query("DELETE FROM organizations WHERE id = $1", [orgId])
    }
  }

  const verifyRequest = (body: Record<string, string>) =>
    new Request("http://te.localhost/masuk/dua-langkah", {
      method: "POST",
      body: new URLSearchParams({ intent: "verify", uri: URI, ...body }),
    })

  /** Security lines of one event. */
  function eventLines(lines: unknown[][], event: string) {
    return lines.flatMap((args) => {
      const line = JSON.parse(String(args[0])) as Record<string, unknown>
      return line.event === event ? [line] : []
    })
  }

  const signedOutAuth = {
    api: {
      signOut: () =>
        Promise.resolve(
          new Response(null, {
            headers: { "Set-Cookie": "sb.session_token=; Max-Age=0" },
          }),
        ),
    },
  } as unknown as Auth

  test("a stale TOTP session's sign-out is logged", async () => {
    // ASVS V16.3.1: hook skips in-process
    const lines: unknown[][] = []
    const spy = spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args)
    })
    await withEnrolling(async (context, userId) => {
      const base = session(true, new Date(now.getTime() - 60_000), now)
      context.set(sessionContext, {
        ...base,
        user: { ...base.user, id: userId },
      })
      const result = await twoFactorAction(
        {
          request: new Request("http://te.localhost/masuk/dua-langkah", {
            method: "POST",
            body: new URLSearchParams({ intent: "sign_out" }),
          }),
          context,
        },
        signedOutAuth,
      )
      if (!(result instanceof Response)) throw new Error("no redirect")
      expect(result.headers.get("Location")).toBe("/masuk")
      expect(eventLines(lines, "auth_ok")).toEqual([
        expect.objectContaining({
          factor: "sign_out",
          user_id: userId,
          host: "te.localhost",
          path: "/masuk/dua-langkah",
        }),
      ])
    }).finally(() => spy.mockRestore())
  })

  test("a stale session signs in again to enrol", async () => {
    const lines: unknown[][] = []
    const spy = spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args)
    })
    await withEnrolling(async (context, userId) => {
      const auth = {
        api: {
          enableTwoFactor: () =>
            Promise.reject(
              new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH" }),
            ),
          signOut: () =>
            Promise.resolve(
              new Response(null, {
                headers: { "Set-Cookie": "sb.session_token=; Max-Age=0" },
              }),
            ),
        },
      } as unknown as Auth
      const result = await twoFactorAction(
        {
          request: new Request("http://te.localhost/masuk/dua-langkah", {
            method: "POST",
            body: new URLSearchParams({ intent: "enroll" }),
          }),
          context,
        },
        auth,
      )
      if (!(result instanceof Response)) throw new Error("no redirect")
      expect(result.headers.get("Location")).toBe("/masuk")
      expect(result.headers.get("Set-Cookie")).toContain("Max-Age=0")
      expect(eventLines(lines, "auth_ok")).toEqual([
        expect.objectContaining({ factor: "sign_out", user_id: userId }),
      ])
    }).finally(() => spy.mockRestore())
  })

  test("enrollment needs the saved tick, codes stay shown", async () => {
    const lines: unknown[][] = []
    const spy = spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args)
    })
    await withEnrolling(async (context, userId) => {
      const viewed: unknown[] = []
      let verified = 0
      const auth = {
        api: {
          viewBackupCodes: (input: { headers?: Headers; body: unknown }) => {
            // Direct calls need request host
            expect(input.headers).toBeInstanceOf(Headers)
            viewed.push(input.body)
            return Promise.resolve({
              status: true,
              backupCodes: ["ab12C-3dE45"],
            })
          },
          verifyTOTP: () => {
            verified++
            return Promise.resolve(new Response(null, { status: 401 }))
          },
        },
      } as unknown as Auth
      const result = await twoFactorAction(
        { request: verifyRequest({ code: "123456" }), context },
        auth,
      )
      expect(result).toEqual({
        kind: "error",
        error: "unsaved",
        uri: URI,
        backupCodes: ["ab12C-3dE45"],
        saved: false,
      })
      expect(verified).toBe(0)
      expect(viewed).toEqual([{ userId }])
      // ASVS V16.3.1: reveal is logged
      const shown = lines.flatMap((args) => {
        const line = JSON.parse(String(args[0])) as Record<string, unknown>
        return line.event === "backup_codes_viewed" ? [line] : []
      })
      expect(shown).toEqual([
        expect.objectContaining({ msg: "security", user_id: userId }),
      ])
    }).finally(() => spy.mockRestore())
  })

  test("a wrong code while enrolling re-reads the pending codes", async () => {
    await withEnrolling(async (context) => {
      const auth = {
        api: {
          viewBackupCodes: () =>
            Promise.resolve({ status: true, backupCodes: ["ab12C-3dE45"] }),
          verifyTOTP: () =>
            Promise.resolve(new Response(null, { status: 401 })),
        },
      } as unknown as Auth
      const result = await twoFactorAction(
        {
          request: verifyRequest({ code: "123456", saved: "yes" }),
          context,
        },
        auth,
      )
      expect(result).toEqual({
        kind: "error",
        error: "wrong",
        uri: URI,
        backupCodes: ["ab12C-3dE45"],
        saved: true,
      })
    })
  })

  test("a challenge never reads backup codes", async () => {
    let viewed = 0
    const auth = {
      api: {
        viewBackupCodes: () => {
          viewed++
          return Promise.resolve({ status: true, backupCodes: ["x"] })
        },
        verifyTOTP: () => Promise.resolve(new Response(null, { status: 401 })),
      },
    } as unknown as Auth
    const result = await twoFactorAction(
      {
        request: challengeRequest({
          intent: "verify",
          code: "123456",
          uri: URI,
        }),
        context: challengeContext(),
      },
      auth,
    )
    expect(result).toEqual({ kind: "error", error: "wrong", uri: URI })
    expect(viewed).toBe(0)
  })

  test("a lost enrollment race shows the failed message", async () => {
    const slug = `tf${String(Date.now()).slice(-6)}`
    const orgId = await insertOrg(su, slug)
    const email = `${slug}@contoh.id`
    const userId = await insertUser(su, email)
    try {
      await su.query(
        "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
        [orgId, userId],
      )
      const context = new RouterContextProvider()
      context.set(tenantContext, {
        id: orgId,
        slug,
        host: `${slug}.localhost`,
        name: "",
        campusCode: "TF",
        campusName: "",
        theme: {},
        settings: {},
      })
      const base = session(false)
      context.set(sessionContext, {
        ...base,
        user: { ...base.user, id: userId, email },
      })
      // UNIQUE (user_id) loser
      const duplicate = Object.assign(new Error("duplicate key"), {
        code: "23505",
      })
      const auth = {
        api: { enableTwoFactor: () => Promise.reject(duplicate) },
      } as unknown as Auth
      const request = new Request("http://tf.localhost/kelola/2fa", {
        method: "POST",
        body: new URLSearchParams({ intent: "enroll" }),
      })
      const result = await twoFactorAction({ request, context }, auth)
      expect(result).toEqual({ kind: "error", error: "failed" })
    } finally {
      await su.query("DELETE FROM members WHERE user_id = $1", [userId])
      await su.query("DELETE FROM users WHERE id = $1", [userId])
      await su.query("DELETE FROM organizations WHERE id = $1", [orgId])
    }
  })

  /** Redirect, status or view. */
  async function loaded(run: () => Promise<unknown>) {
    try {
      return { view: await run() }
    } catch (error) {
      if (error instanceof Response) {
        return { location: error.headers.get("Location") }
      }
      if (error instanceof Error) throw error
      return { status: (error as { init?: { status?: number } }).init?.status }
    }
  }

  const page = (cookie?: string) =>
    new Request("http://te.localhost/masuk/dua-langkah", {
      headers: cookie ? { cookie } : {},
    })

  describe("twoFactorLoader", () => {
    test("Given no session and no challenge, when opened, then sign in first", async () => {
      expect(
        await loaded(() =>
          twoFactorLoader({ request: page(), context: challengeContext() }),
        ),
      ).toEqual({ location: "/masuk" })
    })

    test("Given a pending challenge, when opened, then the code form", async () => {
      expect(
        await loaded(() =>
          twoFactorLoader({
            request: page("sb.two_factor=signed"),
            context: challengeContext(),
          }),
        ),
      ).toEqual({ view: { mode: "challenge" } })
    })

    test("Given staff without TOTP, when opened, then enrollment for their email", async () => {
      await withEnrolling(async (context) => {
        const email = context.get(sessionContext)?.user.email
        expect(
          await loaded(() => twoFactorLoader({ request: page(), context })),
        ).toEqual({ view: { mode: "enroll", email } })
      })
    })

    test("Given staff with a fresh TOTP session, when opened, then on to /kelola", async () => {
      await withEnrolling(async (context, userId) => {
        const base = session(true, new Date(), new Date(0))
        context.set(sessionContext, {
          ...base,
          user: { ...base.user, id: userId },
        })
        expect(
          await loaded(() => twoFactorLoader({ request: page(), context })),
        ).toEqual({ location: "/kelola" })
      })
    })

    test("Given a reporter account, when opened, then 403", async () => {
      await withEnrolling(async (context, userId) => {
        await su.query(
          "UPDATE members SET role = 'reporter' WHERE user_id = $1",
          [userId],
        )
        expect(
          await loaded(() => twoFactorLoader({ request: page(), context })),
        ).toEqual({ status: 403 })
      })
    })
  })

  const enroll = () =>
    new Request("http://te.localhost/masuk/dua-langkah", {
      method: "POST",
      body: new URLSearchParams({ intent: "enroll" }),
    })

  test("Given staff without TOTP, when enrolling, then the key, its secret and backup codes are shown", async () => {
    await withEnrolling(async (context) => {
      const sent: unknown[] = []
      const auth = {
        api: {
          enableTwoFactor: (input: { body: unknown }) => {
            sent.push(input.body)
            return Promise.resolve({
              method: "totp",
              totpURI: URI,
              backupCodes: ["ab12C-3dE45", "fg67H-8iJ90"],
            })
          },
        },
      } as unknown as Auth
      expect(
        await twoFactorAction({ request: enroll(), context }, auth),
      ).toEqual({
        kind: "enrolled",
        uri: URI,
        secret: "JBSWY3DPEHPK3PXP",
        backupCodes: ["ab12C-3dE45", "fg67H-8iJ90"],
      })
      expect(sent).toEqual([{ method: "totp" }])
    })
  })

  test("Given an enrollment key without a secret, when enrolling, then failed", async () => {
    await withEnrolling(async (context) => {
      const auth = {
        api: {
          enableTwoFactor: () =>
            Promise.resolve({
              method: "totp",
              totpURI: "https://contoh.id/?secret=X",
              backupCodes: [],
            }),
        },
      } as unknown as Auth
      expect(
        await twoFactorAction({ request: enroll(), context }, auth),
      ).toEqual({ kind: "error", error: "failed" })
    })
  })

  test("Given Better Auth fails unexpectedly, when enrolling, then the error propagates", async () => {
    await withEnrolling(async (context) => {
      const auth = {
        api: {
          enableTwoFactor: () => Promise.reject(new Error("database down")),
        },
      } as unknown as Auth
      await expect(
        twoFactorAction({ request: enroll(), context }, auth),
      ).rejects.toThrow("database down")
    })
  })

  test("Given pending codes cannot be read, when the tick is missing, then no codes and the failure is logged", async () => {
    const lines: unknown[][] = []
    const spy = spyOn(console, "error").mockImplementation((...args) => {
      lines.push(args)
    })
    await withEnrolling(async (context) => {
      const auth = {
        api: {
          viewBackupCodes: () => Promise.reject(new Error("no codes")),
        },
      } as unknown as Auth
      expect(
        await twoFactorAction(
          { request: verifyRequest({ code: "123456" }), context },
          auth,
        ),
      ).toEqual({
        kind: "error",
        error: "unsaved",
        uri: URI,
        backupCodes: [],
        saved: false,
      })
    }).finally(() => spy.mockRestore())
    const logged = lines.map(
      (args) => JSON.parse(String(args[0])) as Record<string, unknown>,
    )
    expect(logged).toEqual([
      expect.objectContaining({ msg: "backup codes unavailable" }),
    ])
  })

  test("Given an intent that does not fit the step, when posted, then 400", async () => {
    await withEnrolling(async (context) => {
      for (const intent of ["backup", "sign_out", "nonsense"]) {
        const result = await loaded(() =>
          twoFactorAction(
            {
              request: new Request("http://te.localhost/masuk/dua-langkah", {
                method: "POST",
                body: new URLSearchParams({ intent, code: "xwFYIHb7up" }),
              }),
              context,
            },
            {} as Auth,
          ),
        )
        expect([intent, result]).toEqual([intent, { status: 400 }])
      }
    })
  })
})
