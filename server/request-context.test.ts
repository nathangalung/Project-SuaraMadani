import { describe, expect, test } from "bun:test"
import { RouterContextProvider } from "react-router"
import {
  nationalContext,
  type SessionContext,
  sessionContext,
  type TenantContext,
  tenantContext,
} from "../app/context.ts"
import { inRequestScope, type RequestScope } from "../db/request-scope.ts"
import {
  createRootMiddleware,
  type RootDeps,
  staffContext,
  superadminContext,
} from "./request-context.server.ts"

const itb: TenantContext = {
  id: "org-itb",
  slug: "itb",
  host: "itb.localhost",
  name: "KM ITB",
  campusCode: "ITB",
  campusName: "Institut Teknologi Bandung",
  theme: {},
  settings: {},
}

const now = new Date("2026-10-13T10:00:00Z")

function sessionFor(twoFactorEnabled: boolean): SessionContext {
  return {
    user: {
      id: "user-1",
      email: "moderator@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled,
      updatedAt: new Date("2026-10-13T08:00:00Z"),
    },
    session: {
      id: "s1",
      createdAt: new Date("2026-10-13T09:00:00Z"),
      expiresAt: new Date("2026-10-20T09:00:00Z"),
    },
  }
}

function deps(overrides: Partial<RootDeps> = {}): RootDeps {
  return {
    tenantByHost: async (host) => (host === "itb.localhost" ? itb : undefined),
    readSession: async () => ({ session: null, setCookie: [] }),
    memberRole: async () => null,
    isSuperadmin: async () => false,
    apexHost: () => "localhost",
    now: () => now,
    ...overrides,
  }
}

type Outcome = {
  status: number
  context: RouterContextProvider
  response?: Response
}

async function run(
  middlewareDeps: RootDeps,
  url: string,
  init: RequestInit = {},
): Promise<Outcome> {
  const middleware = createRootMiddleware(middlewareDeps)
  const request = new Request(url, init)
  const context = new RouterContextProvider()
  try {
    const result = await middleware(
      {
        request,
        url: new URL(url),
        pattern: "",
        params: {},
        context,
      },
      async () => new Response("next"),
    )
    return {
      status: result instanceof Response ? result.status : 200,
      context,
      response: result instanceof Response ? result : undefined,
    }
  } catch (error) {
    // Thrown data() carries its status
    const status = (error as { init?: { status?: number } }).init?.status
    if (status) return { status, context }
    throw error
  }
}

describe("tenant", () => {
  test("known host sets the tenant", async () => {
    const { status, context } = await run(deps(), "http://itb.localhost/isu")
    expect(status).toBe(200)
    expect(context.get(tenantContext)).toEqual(itb)
  })

  test("unknown host is 404 before any session lookup", async () => {
    let looked = false
    const { status } = await run(
      deps({
        readSession: async () => {
          looked = true
          return { session: null, setCookie: [] }
        },
      }),
      "http://evil.localhost/isu",
      { headers: { cookie: "sb.session_token=x" } },
    )
    expect(status).toBe(404)
    expect(looked).toBe(false)
  })

  test("a spoofed X-Forwarded-Host is ignored", async () => {
    const { context } = await run(deps(), "http://itb.localhost/isu", {
      headers: { "x-forwarded-host": "ugm.localhost" },
    })
    expect(context.get(tenantContext).host).toBe("itb.localhost")
  })
})

describe("apex national scope", () => {
  test("the apex host is national, with no tenant lookup", async () => {
    let looked = false
    const { status, context } = await run(
      deps({
        tenantByHost: async () => {
          looked = true
          return undefined
        },
      }),
      "http://localhost:5173/",
    )
    expect(status).toBe(200)
    expect(context.get(nationalContext)).toBe(true)
    expect(looked).toBe(false)
  })

  test("tenant hosts stay tenant scoped", async () => {
    const { context } = await run(deps(), "http://itb.localhost/")
    expect(context.get(nationalContext)).toBe(false)
  })

  test("no session lookup, even with a cookie", async () => {
    let looked = false
    const { status, context } = await run(
      deps({
        readSession: async () => {
          looked = true
          return { session: sessionFor(true), setCookie: [] }
        },
      }),
      "http://localhost/",
      { headers: { cookie: "sb.session_token=abc" } },
    )
    expect(status).toBe(200)
    expect(looked).toBe(false)
    expect(context.get(sessionContext)).toBeNull()
  })

  test("content pages pass", async () => {
    for (const path of [
      "/",
      "/tentang",
      "/privasi",
      "/pedoman",
      "/aksesibilitas",
    ]) {
      const { status } = await run(deps(), `http://localhost${path}`)
      expect(status).toBe(200)
    }
  })

  test("every other path is 404 with the national shell", async () => {
    for (const path of [
      "/isu",
      "/data",
      "/lapor",
      "/masuk",
      "/lacak",
      "/kelola",
      "/admin",
      "/api/auth/get-session",
      "/wilayah/32.json",
      "/TENTANG/x",
    ]) {
      const error = await Promise.resolve(
        createRootMiddleware(deps())(
          {
            request: new Request(`http://localhost${path}`),
            url: new URL(`http://localhost${path}`),
            pattern: "",
            params: {},
            context: new RouterContextProvider(),
          },
          async () => new Response("next"),
        ),
      ).catch((e: unknown) => e)
      const thrown = error as { init?: { status?: number }; data?: unknown }
      expect([path, thrown.init?.status]).toEqual([path, 404])
      expect(thrown.data).toMatchObject({ shell: { national: true } })
    }
  })

  test("a lookalike apex host is a tenant lookup", async () => {
    const { status } = await run(deps(), "http://localhost.evil.test/")
    expect(status).toBe(404)
  })
})

describe("session", () => {
  test("looked up only when the cookie exists", async () => {
    let calls = 0
    const readSession = async () => {
      calls++
      return { session: sessionFor(false), setCookie: [] }
    }
    const anon = await run(deps({ readSession }), "http://itb.localhost/isu")
    expect(anon.context.get(sessionContext)).toBeNull()
    expect(calls).toBe(0)
    const signed = await run(
      deps({ readSession }),
      "http://itb.localhost/isu",
      {
        headers: { cookie: "sb.session_token=abc" },
      },
    )
    expect(signed.context.get(sessionContext)?.user.id).toBe("user-1")
    expect(calls).toBe(1)
  })

  test("the request scope names the account", async () => {
    const scope: RequestScope = { reqId: "r1" }
    await inRequestScope(scope, () =>
      run(
        deps({
          readSession: async () => ({
            session: sessionFor(false),
            setCookie: [],
          }),
        }),
        "http://itb.localhost/isu",
        { headers: { cookie: "sb.session_token=abc" } },
      ),
    )
    expect(scope.userId).toBe("user-1")
  })

  test("a refused report page masks its code", async () => {
    const lines: Record<string, unknown>[] = []
    await run(
      { ...deps(), log: (line) => lines.push(line) },
      "http://itb.localhost/kelola/laporan/ITB-26-ABCDE",
    )
    expect(lines[0]?.path).toBe("/kelola/laporan/:code")
  })

  test("a refreshed session cookie reaches the response", async () => {
    const refreshed = "sb.session_token=new; Max-Age=604800; Path=/; HttpOnly"
    const { response } = await run(
      deps({
        readSession: async () => ({
          session: sessionFor(false),
          setCookie: [refreshed],
        }),
      }),
      "http://itb.localhost/lapor/periksa",
      { headers: { cookie: "sb.session_token=abc" } },
    )
    expect(response?.headers.getSetCookie()).toEqual([refreshed])
  })

  test("auth API paths skip the lookup", async () => {
    let calls = 0
    await run(
      deps({
        readSession: async () => {
          calls++
          return { session: null, setCookie: [] }
        },
      }),
      "http://itb.localhost/api/auth/get-session",
      { headers: { cookie: "sb.session_token=abc" } },
    )
    expect(calls).toBe(0)
  })
})

describe("csrf", () => {
  test("cross-origin writes are 403", async () => {
    const { status } = await run(deps(), "http://itb.localhost/api/upload/x", {
      method: "POST",
      headers: { origin: "http://ugm.localhost" },
    })
    expect(status).toBe(403)
  })

  test("a refused write is a security event", async () => {
    // OWASP A09: alertable refusals
    const lines: Record<string, unknown>[] = []
    await run(
      deps({ log: (line) => lines.push(line) }),
      "http://itb.localhost/api/upload/x",
      { method: "POST", headers: { origin: "http://ugm.localhost" } },
    )
    expect(lines).toEqual([
      {
        msg: "security",
        event: "csrf_refused",
        host: "itb.localhost",
        path: "/api/upload/x",
      },
    ])
  })

  test("same-origin writes pass", async () => {
    const { status } = await run(deps(), "http://itb.localhost/api/upload/x", {
      method: "POST",
      headers: { origin: "http://itb.localhost" },
    })
    expect(status).toBe(200)
  })
})

describe("staff paths", () => {
  const staffDeps = (twoFactorEnabled: boolean, role: "admin" | null) =>
    deps({
      readSession: async () => ({
        session: sessionFor(twoFactorEnabled),
        setCookie: [],
      }),
      memberRole: async (orgId) => (orgId === "org-itb" ? role : null),
    })
  const cookie = { headers: { cookie: "sb.session_token=abc" } }

  test("no session is 403", async () => {
    expect((await run(deps(), "http://itb.localhost/kelola")).status).toBe(403)
  })

  test("a refused staff page names the account", async () => {
    const lines: Record<string, unknown>[] = []
    await run(
      { ...staffDeps(false, "admin"), log: (line) => lines.push(line) },
      "http://itb.localhost/kelola/antrean",
      cookie,
    )
    expect(lines).toEqual([
      {
        msg: "security",
        event: "staff_refused",
        host: "itb.localhost",
        path: "/kelola/antrean",
        user_id: "user-1",
      },
    ])
  })

  test("admin without TOTP is 403", async () => {
    const { status } = await run(
      staffDeps(false, "admin"),
      "http://itb.localhost/kelola/antrean",
      cookie,
    )
    expect(status).toBe(403)
  })

  test("admin with TOTP passes", async () => {
    const { status } = await run(
      staffDeps(true, "admin"),
      "http://itb.localhost/kelola",
      cookie,
    )
    expect(status).toBe(200)
  })

  test("a member of another campus is 403", async () => {
    const { status } = await run(
      staffDeps(true, null),
      "http://itb.localhost/kelola",
      cookie,
    )
    expect(status).toBe(403)
  })

  // Thrown payload, not just status
  async function forbiddenBody(
    middlewareDeps: RootDeps,
    init: RequestInit,
    path = "/kelola",
  ) {
    const middleware = createRootMiddleware(middlewareDeps)
    const url = `http://itb.localhost${path}`
    try {
      await middleware(
        {
          request: new Request(url, init),
          url: new URL(url),
          pattern: "",
          params: {},
          context: new RouterContextProvider(),
        },
        async () => new Response("next"),
      )
    } catch (error) {
      return (error as { data?: unknown }).data
    }
    throw new Error("not forbidden")
  }

  test("a 403 still carries the campus shell", async () => {
    const anonymous = await forbiddenBody(deps(), {})
    expect(anonymous).toMatchObject({
      shell: { siteName: "KM ITB", user: null },
      staff: false,
    })
    const stale = await forbiddenBody(staffDeps(false, "admin"), cookie)
    expect(stale).toMatchObject({
      shell: { siteName: "KM ITB", user: { email: "moderator@contoh.id" } },
      staff: true,
    })
    const outsider = await forbiddenBody(staffDeps(true, null), cookie)
    expect(outsider).toMatchObject({ staff: false })
  })

  test("/admin needs the superadmin flag, not a campus role", async () => {
    const { status } = await run(
      staffDeps(true, "admin"),
      "http://itb.localhost/admin",
      cookie,
    )
    expect(status).toBe(403)
  })

  test("any spelling React Router routes to /kelola is gated", async () => {
    for (const path of [
      "/KELOLA",
      "/Kelola/laporan/ITB-26-X",
      "/%6Belola",
      "/%6belola/laporan/Y",
      "/kelola%2Fbukti",
      // Malformed escape, still gated
      "/kelola/%E0%A4%A",
    ]) {
      const { status } = await run(
        staffDeps(false, "admin"),
        `http://itb.localhost${path}`,
        cookie,
      )
      expect([path, status]).toEqual([path, 403])
    }
  })

  test("any spelling of /admin is gated", async () => {
    for (const path of ["/ADMIN", "/%61dmin/x"]) {
      const { status } = await run(
        staffDeps(true, "admin"),
        `http://itb.localhost${path}`,
        cookie,
      )
      expect([path, status]).toEqual([path, 403])
    }
  })

  const rootDeps = (twoFactorEnabled: boolean, superadmin: boolean) =>
    deps({
      readSession: async () => ({
        session: sessionFor(twoFactorEnabled),
        setCookie: [],
      }),
      isSuperadmin: async (userId) => superadmin && userId === "user-1",
    })

  test("a superadmin with TOTP reaches /admin on any campus host", async () => {
    const { status, context } = await run(
      rootDeps(true, true),
      "http://itb.localhost/admin",
      cookie,
    )
    expect(status).toBe(200)
    expect(context.get(staffContext)).toBeNull()
    expect(context.get(superadminContext)).toBe(true)
  })

  test("a superadmin without TOTP is sent to enrol", async () => {
    const body = await forbiddenBody(rootDeps(false, true), cookie, "/admin")
    expect(body).toMatchObject({ staff: true })
  })

  test("no session, or a stale one, fails closed", async () => {
    expect((await run(deps(), "http://itb.localhost/admin")).status).toBe(403)
    const late = deps({
      readSession: async () => ({ session: sessionFor(true), setCookie: [] }),
      isSuperadmin: async () => true,
      now: () => new Date("2026-10-13T22:00:00Z"),
    })
    expect((await run(late, "http://itb.localhost/admin", cookie)).status).toBe(
      403,
    )
  })

  test("a lookup failure is a refusal, not a pass", async () => {
    const broken = deps({
      readSession: async () => ({ session: sessionFor(true), setCookie: [] }),
      isSuperadmin: async () => {
        throw new Error("db down")
      },
    })
    await expect(
      run(broken, "http://itb.localhost/admin", cookie),
    ).rejects.toThrow("db down")
  })

  test("the gate records the staff role for loaders", async () => {
    const staff = await run(
      staffDeps(true, "admin"),
      "http://itb.localhost/Kelola",
      cookie,
    )
    expect(staff.status).toBe(200)
    expect(staff.context.get(staffContext)).toEqual({ role: "admin" })
    const other = await run(
      staffDeps(true, "admin"),
      "http://itb.localhost/isu",
      cookie,
    )
    expect(other.context.get(staffContext)).toBeNull()
  })

  test("lookalike paths are not staff paths", async () => {
    const { status } = await run(deps(), "http://itb.localhost/kelolaan")
    expect(status).toBe(200)
  })
})
