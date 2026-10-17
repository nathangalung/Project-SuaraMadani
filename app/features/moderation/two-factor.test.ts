import { afterAll, describe, expect, test } from "bun:test"
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
    ["sm.two_factor=abc", true],
    ["a=1; __Secure-sm.two_factor=abc", true],
    ["sm.session_token=abc", false],
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
      headers: { cookie: "sm.two_factor=signed" },
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
              headers: { "Set-Cookie": "sm.session_token=t; Path=/" },
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
    expect(result.headers.get("Set-Cookie")).toContain("sm.session_token=t")
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

  test("enrollment needs the saved tick, codes stay shown", async () => {
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
    })
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
})
