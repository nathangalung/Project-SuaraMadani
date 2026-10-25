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
import {
  action as campusesAction,
  loader as campusesLoader,
} from "../admin/campuses"
import { action as whatsappAction } from "../admin/whatsapp"
import { loader as logoLoader } from "../logo"
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
  // Send quotas count today
  await su.query("DELETE FROM email_log")
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

  test("an invitation id that is no UUID is not found", async () => {
    const who = session(users.invitee, "baru@kampus.ac.id")
    expect(await invitationAction(args("a", who, "bukan-uuid"))).toEqual({
      refused: "not_found",
    })
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

/** Polls until a lock wait. */
async function waitForLock(sql: string) {
  for (let tries = 0; tries < 500; tries++) {
    const { rows } = await su.query(
      `SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query ILIKE $1`,
      [`${sql}%`],
    )
    if (rows.length > 0) return
    await Bun.sleep(10)
  }
  throw new Error(`no statement waited: ${sql}`)
}

// Fresh address per run
const fresh = (local: string) =>
  `${local}.${crypto.randomUUID().slice(0, 8)}@kampus.ac.id`

/** Mail bodies sent there. */
async function mailpitTo(address: string): Promise<string[]> {
  const base = process.env.MAILPIT_URL ?? "http://127.0.0.1:58025"
  const found = (await (
    await fetch(
      `${base}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    )
  ).json()) as { messages: { ID: string }[] }
  return Promise.all(
    found.messages.map(async ({ ID }) => {
      const message = (await (
        await fetch(`${base}/api/v1/message/${ID}`)
      ).json()) as { Text: string }
      return message.Text
    }),
  )
}

describe("superadmin creates a campus, /admin", () => {
  const superadmin = () => session(users.admin, "admin@kampus.ac.id")
  const create = (fields: Record<string, string>, flag = true) =>
    campusesAction(
      routeArgs(post("/admin", fields), context("a", superadmin(), null, flag)),
    )
  const form = (adminEmail: string) => ({
    campusName: "Universitas Contoh",
    name: "KM Contoh",
    slug: "contoh",
    campusCode: "UCX",
    adminEmail,
    contactEmail: "",
  })

  beforeEach(async () => {
    await su.query("UPDATE users SET superadmin = true WHERE id = $1", [
      users.admin,
    ])
  })

  test("Given a superadmin, when a campus is created, then the org, its first admin invitation and the mail exist", async () => {
    const adminEmail = fresh("ketua")
    const result = await create(form(adminEmail))
    expect(result).toEqual({
      created: {
        host: "contoh.localhost",
        campusName: "Universitas Contoh",
        mail: "sent",
      },
    })
    const { rows } = await su.query(
      `SELECT o.host, i.email, i.status FROM organizations o
         JOIN invitations i ON i.organization_id = o.id WHERE o.slug = 'contoh'`,
    )
    expect(rows).toEqual([
      { host: "contoh.localhost", email: adminEmail, status: "pending" },
    ])
    const mails = await mailpitTo(adminEmail)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toContain("http://contoh.localhost")
  })

  test("an invalid form is returned with its values and creates nothing", async () => {
    const fields = { ...form("bukan-surel"), slug: "Bukan Slug" }
    expect(await create(fields)).toEqual({
      errors: ["slug", "adminEmail"],
      values: fields,
    })
    const { rows } = await su.query(
      "SELECT 1 FROM organizations WHERE campus_code = 'UCX'",
    )
    expect(rows).toHaveLength(0)
  })

  test("a subdomain or campus code in use is flagged as taken", async () => {
    const taken = { ...form(fresh("dua")), slug: "rta" }
    expect(await create(taken)).toEqual({
      errors: ["slug"],
      values: taken,
      taken: true,
    })
    const code = { ...form(fresh("tiga")), campusCode: "RTB" }
    expect(await create(code)).toEqual({
      errors: ["campusCode"],
      values: code,
      taken: true,
    })
  })

  test("Given a campus without an admin yet, when the invitation is resent, then it is mailed again once a minute passed", async () => {
    const adminEmail = fresh("ulang")
    await create(form(adminEmail))
    const { rows } = await su.query<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = 'contoh'",
    )
    const org = rows[0]?.id ?? ""
    // Within a minute: held back
    expect(await create({ intent: "resend", org })).toEqual({
      resent: "limited",
    })
    expect(await mailpitTo(adminEmail)).toHaveLength(1)
    await su.query(
      "UPDATE email_log SET created_at = now() - interval '2 minutes'",
    )
    expect(await create({ intent: "resend", org })).toEqual({ resent: "sent" })
    expect(await mailpitTo(adminEmail)).toHaveLength(2)
    // Campus A has its admin
    expect(await create({ intent: "resend", org: orgs.a })).toEqual({
      resent: "not_found",
    })
    expect(await create({ intent: "resend", org: "bukan-uuid" })).toEqual({
      resent: "not_found",
    })
  })

  test("Given a rival commits the same subdomain after the check, when the insert lands, then it is flagged as taken", async () => {
    const rival = await su.connect()
    const fields = form(fresh("balap"))
    try {
      await rival.query("BEGIN")
      await rival.query(
        `INSERT INTO organizations (name, slug, host, campus_code, campus_name)
         VALUES ('KM Lain', 'contoh', 'contoh.localhost', 'LAIN', 'Lain')`,
      )
      // Check passes, insert waits
      const creating = create(fields)
      await waitForLock('insert into "organizations"')
      await rival.query("COMMIT")
      expect(await creating).toEqual({
        errors: ["slug"],
        values: fields,
        taken: true,
      })
    } finally {
      await rival.query("ROLLBACK").catch(() => {})
      rival.release()
    }
    const { rows } = await su.query(
      "SELECT campus_code FROM organizations WHERE slug = 'contoh'",
    )
    expect(rows).toEqual([{ campus_code: "LAIN" }])
  })

  test("a revoked superadmin flag refuses both forms with 403", async () => {
    await su.query("UPDATE users SET superadmin = false WHERE id = $1", [
      users.admin,
    ])
    expect(await status(() => create(form(fresh("cabut"))))).toBe(403)
    expect(await status(() => create({ intent: "resend", org: orgs.a }))).toBe(
      403,
    )
    expect(await status(() => create(form(fresh("tanpa")), false))).toBe(403)
    const { rows } = await su.query(
      "SELECT 1 FROM organizations WHERE slug = 'contoh'",
    )
    expect(rows).toHaveLength(0)
  })
})

describe("admin team changes, /kelola/anggota", () => {
  const admin = () => session(users.admin, "admin@kampus.ac.id")
  const team = (fields: Record<string, string>, org: "a" | "b" = "a") =>
    membersAction(
      routeArgs(
        post("/kelola/anggota", fields),
        context(org, admin(), "admin"),
      ),
    )
  const invitationOf = async (email: string) => {
    const { rows } = await su.query<{ id: string; status: string }>(
      "SELECT id, status FROM invitations WHERE email = $1",
      [email],
    )
    return rows[0]
  }

  test("Given an admin, when a new address is invited, then a pending invitation is mailed", async () => {
    const email = fresh("anggota")
    expect(await team({ intent: "invite", email })).toEqual({
      notice: "invited",
      email,
    })
    expect((await invitationOf(email))?.status).toBe("pending")
    expect(await mailpitTo(email)).toHaveLength(1)
  })

  test("an address that cannot receive mail is invited but reported unsent", async () => {
    const email = "mati@kampus.test"
    expect(await team({ intent: "invite", email })).toEqual({
      notice: "invited_unsent",
      email,
    })
    expect((await invitationOf(email))?.status).toBe("pending")
  })

  test("current staff and an open invitation are not invited twice", async () => {
    expect(await team({ intent: "invite", email: "mod@kampus.ac.id" })).toEqual(
      { notice: "staff", email: "mod@kampus.ac.id" },
    )
    const email = "dobel@kampus.test"
    await team({ intent: "invite", email })
    expect(await team({ intent: "invite", email })).toEqual({
      notice: "pending",
      email,
    })
  })

  test("Given an open invitation, when it is resent and then canceled, then it is mailed again after the spacing and closed", async () => {
    const email = fresh("batal")
    await team({ intent: "invite", email })
    const invitation = (await invitationOf(email))?.id ?? ""
    expect(await team({ intent: "resend", invitation })).toEqual({
      notice: "resent_limited",
    })
    await su.query(
      "UPDATE email_log SET created_at = now() - interval '2 minutes'",
    )
    expect(await team({ intent: "resend", invitation })).toEqual({
      notice: "resent",
    })
    expect(await mailpitTo(email)).toHaveLength(2)
    expect(await team({ intent: "cancel", invitation })).toEqual({
      notice: "canceled",
    })
    expect((await invitationOf(email))?.status).toBe("canceled")
    expect(await team({ intent: "cancel", invitation })).toEqual({
      notice: "not_found",
    })
    expect(await team({ intent: "resend", invitation })).toEqual({
      notice: "not_found",
    })
  })

  test("Given a confirmed removal, when an editor is removed, then they become a reporter signed out", async () => {
    expect(
      await team({ intent: "remove", user: users.mod, confirm: "yes" }),
    ).toEqual({ notice: "removed" })
    const { rows } = await su.query(
      `SELECT m.role, (SELECT count(*)::int FROM sessions s WHERE s.user_id = m.user_id) AS sessions
         FROM members m WHERE m.organization_id = $1 AND m.user_id = $2`,
      [orgs.a, users.mod],
    )
    expect(rows).toEqual([{ role: "reporter", sessions: 0 }])
  })

  test("a removal without the confirmation box or of no staff changes nothing", async () => {
    expect(await team({ intent: "remove", user: users.mod })).toEqual({
      notice: "unconfirmed",
    })
    for (const user of [users.invitee, "bukan-uuid"]) {
      expect(await team({ intent: "remove", user, confirm: "yes" })).toEqual({
        notice: "not_found",
      })
    }
    const { rows } = await su.query(
      "SELECT role FROM members WHERE user_id = $1",
      [users.mod],
    )
    expect(rows).toEqual([{ role: "editor" }])
  })

  test("the gate saying admin without the row is 403, an unknown intent 400", async () => {
    expect(
      await status(() =>
        team({ intent: "invite", email: "lain@kampus.test" }, "b"),
      ),
    ).toBe(403)
    expect(
      await status(() =>
        team({ intent: "remove", user: users.mod, confirm: "yes" }, "b"),
      ),
    ).toBe(403)
    expect(await status(() => team({ intent: "promote" }))).toBe(400)
    const { rows } = await su.query("SELECT 1 FROM invitations")
    expect(rows).toHaveLength(0)
  })
})

describe("admin settings, /kelola/pengaturan", () => {
  const admin = () => session(users.admin, "admin@kampus.ac.id")
  const save = (
    body: FormData | Record<string, string>,
    org: "a" | "b" = "a",
  ) =>
    settingsAction(
      routeArgs(
        new Request("http://rta.localhost/kelola/pengaturan", {
          method: "POST",
          body: body instanceof FormData ? body : new URLSearchParams(body),
        }),
        context(org, admin(), "admin"),
      ),
    )
  const serve = (file: string) =>
    logoLoader(
      routeArgs(
        new Request(`http://rta.localhost/logo/${file}`),
        context("a", null, null),
        { file },
      ),
    )
  const settings = async () =>
    await settingsLoader(
      routeArgs(
        new Request("http://rta.localhost/kelola/pengaturan"),
        context("a", admin(), "admin"),
      ),
    )

  test("an unknown logo file is 404", async () => {
    expect(await status(() => serve("bukan-logo.png"))).toBe(404)
  })

  test("an intake choice outside open or paused and a status link that is no URL are refused", async () => {
    expect(
      await save({ intent: "intake", intake: "maybe", statusUrl: "x" }),
    ).toEqual({ error: "intake_choice", statusUrl: "x" })
    expect(
      await save({
        intent: "intake",
        intake: "paused",
        statusUrl: "bukan url",
      }),
    ).toEqual({ error: "status_url", statusUrl: "bukan url" })
    expect((await settings()).intakePaused).toBe(false)
  })

  test("the gate saying admin without the row is 403, an unknown intent 400", async () => {
    expect(
      await status(() =>
        save({ intent: "intake", intake: "paused", statusUrl: "" }, "b"),
      ),
    ).toBe(403)
    expect(await status(() => save({ intent: "colour" }))).toBe(400)
  })
})

describe("WhatsApp sender, /admin/whatsapp", () => {
  const send = (fields: Record<string, string>) =>
    whatsappAction(
      routeArgs(
        post("/admin/whatsapp", fields),
        context("a", session(users.admin, "admin@kampus.ac.id"), null, true),
      ),
    )
  const requested = async () =>
    (await su.query("SELECT requested, pairing_phone FROM whatsapp_sender"))
      .rows

  beforeEach(async () => {
    await su.query("DELETE FROM whatsapp_sender")
  })

  afterAll(async () => {
    await su.query("DELETE FROM whatsapp_sender")
  })

  test("Given a superadmin, when a QR link is asked, then the worker request is recorded", async () => {
    expect(await send({ intent: "link_qr" })).toEqual({ error: null })
    expect(await requested()).toEqual([
      { requested: "link_qr", pairing_phone: null },
    ])
  })

  test("a pairing code for a non-mobile number is an error, an unknown intent does nothing", async () => {
    expect(await send({ intent: "link_code", phone: "0221234567" })).toEqual({
      error: "phone",
    })
    expect(await send({ intent: "restart" })).toEqual({ error: null })
    expect(await requested()).toEqual([])
  })
})
