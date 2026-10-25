import { describe, expect, test } from "bun:test"
import { createStaticHandler, RouterContextProvider } from "react-router"
import { inRequestScope } from "../../../db/request-scope.ts"
import type { MemberRole } from "../../../db/schema/auth.ts"
import {
  createRootMiddleware,
  staffContext,
} from "../../../server/request-context.server.ts"
import {
  type SessionContext,
  sessionContext,
  type TenantContext,
  tenantContext,
} from "../../context.ts"
import { requireAdmin } from "./access.server.ts"

const tenant: TenantContext = {
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
      email: "admin@contoh.id",
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

function contextWith(
  session: SessionContext | null,
  staff: { role: MemberRole } | null,
) {
  const context = new RouterContextProvider()
  context.set(tenantContext, tenant)
  context.set(sessionContext, session)
  context.set(staffContext, staff)
  return context
}

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise
    return 200
  } catch (error) {
    return (error as { init?: { status?: number } }).init?.status ?? 500
  }
}

describe("requireAdmin", () => {
  test("needs the staff gate verdict, not only a session", async () => {
    const context = contextWith(sessionFor(false), null)
    expect(await status(requireAdmin(context))).toBe(403)
  })

  test("only the admin role passes, editor is staff but not admin", async () => {
    const session = sessionFor(true)
    for (const [role, expected] of [
      ["admin", 200],
      ["editor", 403],
      ["reporter", 403],
    ] as const) {
      const context = contextWith(session, { role })
      expect([role, await status(requireAdmin(context))]).toEqual([
        role,
        expected,
      ])
    }
  })

  test("a refusal is a security event", async () => {
    const lines: Record<string, unknown>[] = []
    const context = contextWith(sessionFor(true), { role: "editor" })
    await inRequestScope({ reqId: "r7" }, () =>
      status(requireAdmin(context, (line) => lines.push(line))),
    )
    expect(lines).toEqual([
      {
        msg: "security",
        event: "staff_refused",
        host: "itb.localhost",
        need: "admin",
        role: "editor",
        user_id: "user-1",
        req_id: "r7",
      },
    ])
  })

  test("the retired moderator role never passes", async () => {
    const context = contextWith(sessionFor(true), {
      role: "moderator" as MemberRole,
    })
    expect(await status(requireAdmin(context))).toBe(403)
  })
})

describe("staff routes through the router", () => {
  // Mirrors app/routes.ts kelola children
  const root = createRootMiddleware({
    tenantByHost: async () => tenant,
    readSession: async () => ({ session: sessionFor(false), setCookie: [] }),
    memberRole: async () => "admin",
    isSuperadmin: async () => false,
    apexHost: () => "localhost",
    now: () => now,
  })
  const handler = createStaticHandler([
    {
      id: "root",
      path: "/",
      middleware: [(args, next) => root(args, next as () => Promise<Response>)],
      children: [
        {
          id: "kelola",
          path: "kelola",
          children: [
            {
              id: "queue",
              index: true,
              loader: async ({ context }) => {
                await requireAdmin(context)
                return "queue"
              },
            },
            {
              id: "report",
              path: "laporan/:code",
              loader: async ({ context }) => {
                await requireAdmin(context)
                return "report"
              },
            },
          ],
        },
      ],
    },
  ])

  async function hit(path: string): Promise<number> {
    const request = new Request(`http://itb.localhost${path}`, {
      headers: { cookie: "sb.session_token=x" },
    })
    try {
      const response = await handler.query(request, {
        requestContext: new RouterContextProvider(),
        generateMiddlewareResponse: async (query) => {
          const result = await query(request)
          return result instanceof Response
            ? result
            : new Response(null, { status: result.statusCode })
        },
      })
      return response instanceof Response ? response.status : 500
    } catch (error) {
      return (error as { init?: { status?: number } }).init?.status ?? 500
    }
  }

  test("an admin without TOTP gets 403 for every spelling", async () => {
    for (const path of [
      "/kelola",
      "/KELOLA",
      "/Kelola/laporan/LPR-2026-10-0001",
      "/%6Belola",
      "/%6belola/laporan/Y",
    ]) {
      expect([path, await hit(path)]).toEqual([path, 403])
    }
  })
})
