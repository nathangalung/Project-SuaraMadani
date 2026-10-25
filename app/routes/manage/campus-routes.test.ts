import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { RouterContextProvider } from "react-router"
import { migrate } from "../../../db/migrate.ts"
import type { MemberRole } from "../../../db/schema/auth.ts"
import {
  insertOrg,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import {
  staffContext,
  superadminContext,
} from "../../../server/request-context.server.ts"
import {
  type SessionContext,
  sessionContext,
  tenantContext,
} from "../../context.ts"
import {
  action as invitationAction,
  loader as invitationLoader,
} from "../account/invitation"
import { loader as campusesLoader } from "../admin/campuses"
import { action as membersAction, loader as membersLoader } from "./members"
import { action as settingsAction, loader as settingsLoader } from "./settings"

const su = superuserPool()
const orgs = { a: "", b: "" }
const users = { admin: "", mod: "", invitee: "" }
// Real rows: step-up reads them
const sessionIds = new Map<string, string>()

function session(id: string, email: string): SessionContext {
  return {
    user: {
      id,
      email,
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: true,
      updatedAt: new Date(0),
    },
    session: {
      id: sessionIds.get(id) ?? crypto.randomUUID(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  }
}

function context(
  org: "a" | "b",
  who: SessionContext | null,
  role: MemberRole | null,
  superadmin = false,
) {
  const provider = new RouterContextProvider()
  provider.set(tenantContext, {
    id: orgs[org],
    slug: `rt${org}`,
    host: `rt${org}.localhost`,
    name: `KM RT${org.toUpperCase()}`,
    campusCode: `RT${org.toUpperCase()}`,
    campusName: `Kampus ${org}`,
    theme: {},
    settings: {},
  })
  provider.set(sessionContext, who)
  provider.set(staffContext, role ? { role } : null)
  provider.set(superadminContext, superadmin)
  return provider
}

const post = (path: string, fields: Record<string, string>) =>
  new Request(`http://rta.localhost${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  })

// Route args need url, pattern
function routeArgs(
  request: Request,
  ctx: RouterContextProvider,
  params: Record<string, string> = {},
): never {
  return {
    request,
    context: ctx,
    params,
    url: new URL(request.url),
    pattern: "",
  } as never
}

async function status(run: () => Promise<unknown>): Promise<number> {
  try {
    const result = await run()
    return result instanceof Response ? result.status : 200
  } catch (error) {
    if (error instanceof Response) return error.status
    return (error as { init?: { status?: number } }).init?.status ?? 500
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await resetData(su)
  orgs.a = await insertOrg(su, "rta")
  orgs.b = await insertOrg(su, "rtb")
  users.admin = await insertUser(su, "admin@kampus.ac.id")
  users.mod = await insertUser(su, "mod@kampus.ac.id")
  users.invitee = await insertUser(su, "baru@kampus.ac.id")
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'editor')",
    [orgs.a, users.admin, users.mod],
  )
  for (const id of [users.admin, users.mod]) {
    const { rows } = await su.query<{ id: string }>(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id",
      [crypto.randomUUID(), id],
    )
    sessionIds.set(id, rows[0]?.id ?? "")
  }
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("admin routes", () => {
  const admin = () => session(users.admin, "admin@kampus.ac.id")
  const mod = () => session(users.mod, "mod@kampus.ac.id")

  test("staff without the admin role gets 403 everywhere", async () => {
    const ctx = () => context("a", mod(), "editor")
    const args = (request: Request) => routeArgs(request, ctx())
    expect(
      await status(() =>
        membersLoader(args(new Request("http://rta.localhost/kelola/anggota"))),
      ),
    ).toBe(403)
    expect(
      await status(() =>
        settingsLoader(
          args(new Request("http://rta.localhost/kelola/pengaturan")),
        ),
      ),
    ).toBe(403)
    expect(
      await status(() =>
        membersAction(
          args(
            post("/kelola/anggota", {
              intent: "invite",
              email: "x@kampus.ac.id",
            }),
          ),
        ),
      ),
    ).toBe(403)
    expect(
      await status(() =>
        settingsAction(
          args(
            post("/kelola/pengaturan", { intent: "intake", intake: "paused" }),
          ),
        ),
      ),
    ).toBe(403)
    const { rows } = await su.query("SELECT 1 FROM invitations")
    expect(rows).toHaveLength(0)
  })

  test("an admin of campus A is refused on campus B", async () => {
    // Gate says admin, row missing
    const result = await settingsAction(
      routeArgs(
        post("/kelola/pengaturan", {
          intent: "intake",
          intake: "paused",
        }),
        context("b", admin(), "admin"),
      ),
    ).catch((error: unknown) => error)
    expect((result as { init?: { status?: number } }).init?.status).toBe(403)
    const { rows } = await su.query(
      "SELECT settings FROM organizations WHERE id = $1",
      [orgs.b],
    )
    expect(rows[0]?.settings).toEqual({})
  })

  test("an admin pauses intake and sees it", async () => {
    const result = await settingsAction(
      routeArgs(
        post("/kelola/pengaturan", {
          intent: "intake",
          intake: "paused",
          statusUrl: "",
        }),
        context("a", admin(), "admin"),
      ),
    )
    expect(result).toEqual({ saved: "intake" })
    const page = await settingsLoader(
      routeArgs(
        new Request("http://rta.localhost/kelola/pengaturan"),
        context("a", admin(), "admin"),
      ),
    )
    expect(page.intakePaused).toBe(true)
  })

  test("theme and logo are no longer editable", async () => {
    for (const intent of ["theme", "logo", "logo_remove"]) {
      const refused = await settingsAction(
        routeArgs(
          post("/kelola/pengaturan", { intent, brand: "#ffd400" }),
          context("a", admin(), "admin"),
        ),
      ).then(
        () => 0,
        (error: unknown) =>
          (error as { init?: { status?: number } }).init?.status,
      )
      expect(refused).toBe(400)
    }
    const { rows } = await su.query(
      "SELECT theme FROM organizations WHERE id = $1",
      [orgs.a],
    )
    expect(rows[0]?.theme).toEqual({})
  })

  test("a stale admin session confirms TOTP before changes", async () => {
    await su.query(
      "UPDATE sessions SET created_at = now() - interval '10 minutes' WHERE user_id = $1",
      [users.admin],
    )
    const where = async (run: () => Promise<unknown>) =>
      run().then(
        () => "ran",
        (error: unknown) =>
          error instanceof Response ? error.headers.get("Location") : "error",
      )
    const ctx = () => context("a", admin(), "admin")
    expect(
      await where(() =>
        membersLoader(
          routeArgs(new Request("http://rta.localhost/kelola/anggota"), ctx()),
        ),
      ),
    ).toBe("/masuk/konfirmasi?ke=%2Fkelola%2Fanggota")
    expect(
      await where(() =>
        settingsAction(
          routeArgs(
            post("/kelola/pengaturan", { intent: "intake", intake: "paused" }),
            ctx(),
          ),
        ),
      ),
    ).toBe("/masuk/konfirmasi?ke=%2Fkelola%2Fpengaturan")
    const { rows } = await su.query(
      "SELECT settings FROM organizations WHERE id = $1",
      [orgs.a],
    )
    expect(rows[0]?.settings).toEqual({})
    expect(
      await where(() =>
        campusesLoader(
          routeArgs(
            new Request("http://rta.localhost/admin"),
            context("a", admin(), "admin", true),
          ),
        ),
      ),
    ).toBe("/masuk/konfirmasi?ke=%2Fadmin")
  })

  test("an invalid invite is returned with its values", async () => {
    const result = await membersAction(
      routeArgs(
        post("/kelola/anggota", {
          intent: "invite",
          email: "bukan",
        }),
        context("a", admin(), "admin"),
      ),
    )
    expect(result).toEqual({
      errors: ["invite_email"],
      values: { email: "bukan" },
    })
  })

  test("an admin cannot remove themself", async () => {
    const result = await membersAction(
      routeArgs(
        post("/kelola/anggota", {
          intent: "remove",
          user: users.admin,
          confirm: "yes",
        }),
        context("a", admin(), "admin"),
      ),
    )
    expect(result).toEqual({ notice: "self" })
    const { rows } = await su.query(
      "SELECT role FROM members WHERE organization_id = $1 AND user_id = $2",
      [orgs.a, users.admin],
    )
    expect(rows).toEqual([{ role: "admin" }])
  })
})

describe("superadmin route", () => {
  test("without the gate verdict the loader refuses", async () => {
    const args = (superadmin: boolean) =>
      routeArgs(
        new Request("http://rta.localhost/admin"),
        context(
          "a",
          session(users.admin, "admin@kampus.ac.id"),
          "admin",
          superadmin,
        ),
      )
    expect(await status(() => campusesLoader(args(false)))).toBe(403)
    expect(await status(() => campusesLoader(args(true)))).toBe(200)
  })
})

describe("invitation page", () => {
  async function invitation(org: string, email: string) {
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO invitations (organization_id, email, role, status, expires_at, inviter_id)
       VALUES ($1, $2, 'admin', 'pending', now() + interval '7 days', $3) RETURNING id`,
      [org, email, users.admin],
    )
    return rows[0]?.id ?? ""
  }

  const args = (org: "a" | "b", who: SessionContext | null, id: string) =>
    routeArgs(
      new Request(`http://rt${org}.localhost/undangan/${id}`, {
        method: "POST",
      }),
      context(org, who, null),
      { id },
    )

  test("signed out sees a sign-in step and no address", async () => {
    const id = await invitation(orgs.a, "baru@kampus.ac.id")
    const page = await invitationLoader(args("a", null, id))
    expect(page).toMatchObject({ view: "sign_in", email: null })
  })

  test("another campus host does not know it", async () => {
    const id = await invitation(orgs.a, "baru@kampus.ac.id")
    expect(await status(() => invitationLoader(args("b", null, id)))).toBe(404)
  })

  test("accepting leads to second factor setup", async () => {
    const id = await invitation(orgs.a, "baru@kampus.ac.id")
    const who = session(users.invitee, "baru@kampus.ac.id")
    expect(await invitationLoader(args("a", who, id))).toMatchObject({
      view: "accept",
      email: "baru@kampus.ac.id",
    })
    const response = await invitationAction(args("a", who, id)).catch(
      (error: unknown) => error,
    )
    expect(response).toBeInstanceOf(Response)
    expect((response as Response).headers.get("Location")).toBe(
      "/masuk/dua-langkah",
    )
    const { rows } = await su.query(
      "SELECT role FROM members WHERE organization_id = $1 AND user_id = $2",
      [orgs.a, users.invitee],
    )
    expect(rows).toEqual([{ role: "admin" }])
  })

  test("someone else signed in is told to switch", async () => {
    const id = await invitation(orgs.a, "baru@kampus.ac.id")
    const who = session(users.mod, "mod@kampus.ac.id")
    expect(await invitationLoader(args("a", who, id))).toMatchObject({
      view: "other_email",
      email: null,
    })
    expect(await invitationAction(args("a", who, id))).toEqual({
      refused: "email",
    })
  })
})
