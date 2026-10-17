import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import type { EmailMessage } from "../../../server/email.ts"
import {
  acceptInvitation,
  cancelInvitation,
  inviteMember,
  listTeam,
  readInvitation,
  removeMember,
  resendInvitation,
  type TeamDeps,
} from "./members.server.ts"

const su = superuserPool()
const NOW = new Date("2026-10-15T03:00:00Z")
let clock = NOW
const orgs = { a: "", b: "" }
const users = { admin: "", admin2: "", peer: "", invitee: "", other: "" }
let sent: EmailMessage[] = []
let failSend = false

const deps: TeamDeps = {
  email: {
    send: async (message) => {
      if (failSend) throw new Error("provider down")
      sent.push(message)
    },
  },
  now: () => clock,
  origin: (host) => `http://${host}`,
  hashKey: () => Buffer.alloc(32, 3),
}

const tenant = (org: "a" | "b") => ({
  id: orgs[org],
  host: `team${org}.localhost`,
  name: `KM TEAM${org.toUpperCase()}`,
  campusName: `Kampus ${org}`,
  theme: {},
})

async function role(org: "a" | "b", user: string) {
  const { rows } = await su.query<{ role: string }>(
    "SELECT role FROM members WHERE organization_id = $1 AND user_id = $2",
    [orgs[org], user],
  )
  return rows[0]?.role ?? null
}

async function member(org: "a" | "b", user: string, memberRole: string) {
  await su.query(
    `INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [orgs[org], user, memberRole],
  )
}

async function audit(action: string) {
  const { rows } = await su.query<{ org_id: string; actor_id: string }>(
    "SELECT org_id, actor_id FROM audit_log WHERE action = $1",
    [action],
  )
  return rows
}

async function invite(email = "Baru@Kampus.ac.id") {
  const result = await inviteMember(
    { tenant: tenant("a"), actorId: users.admin, email },
    deps,
  )
  if (!result.ok) throw new Error(result.reason)
  return result.invitationId
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await resetData(su)
  // Not cascaded from users
  await su.query("DELETE FROM email_log")
  sent = []
  failSend = false
  clock = NOW
  orgs.a = await insertOrg(su, "teama")
  orgs.b = await insertOrg(su, "teamb")
  users.admin = await insertUser(su, "admin@kampus.ac.id")
  users.admin2 = await insertUser(su, "admin2@kampus.ac.id")
  users.peer = await insertUser(su, "rekan@kampus.ac.id")
  users.invitee = await insertUser(su, "baru@kampus.ac.id")
  users.other = await insertUser(su, "lain@kampus.ac.id")
  await member("a", users.admin, "admin")
  await member("a", users.peer, "admin")
  await member("b", users.admin2, "admin")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("invitations", () => {
  test("invite stores the address once, audits and mails", async () => {
    const id = await invite()
    const { rows } = await su.query(
      "SELECT email, role, status, expires_at FROM invitations WHERE id = $1",
      [id],
    )
    expect(rows[0]).toEqual({
      email: "baru@kampus.ac.id",
      role: "admin",
      status: "pending",
      expires_at: new Date("2026-10-22T03:00:00Z"),
    })
    expect(await audit("member.invite")).toEqual([
      { org_id: orgs.a, actor_id: users.admin },
    ])
    const { rows: log } = await su.query(
      "SELECT action, entity_type, reason_code, value_hashes FROM audit_log WHERE action = 'member.invite'",
    )
    // Address never in the log
    expect(JSON.stringify(log)).not.toContain("kampus.ac.id")
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe("baru@kampus.ac.id")
    expect(sent[0]?.text).toContain(`http://teama.localhost/undangan/${id}`)
    const { rows: mails } = await su.query("SELECT kind, status FROM email_log")
    expect(mails).toEqual([{ kind: "invitation", status: "sent" }])
  })

  test("existing staff and open invites are refused", async () => {
    const staff = await inviteMember(
      {
        tenant: tenant("a"),
        actorId: users.admin,
        email: "REKAN@kampus.ac.id",
      },
      deps,
    )
    expect(staff).toEqual({ ok: false, reason: "staff" })
    await invite()
    const again = await inviteMember(
      {
        tenant: tenant("a"),
        actorId: users.admin,
        email: "baru@kampus.ac.id",
      },
      deps,
    )
    expect(again).toEqual({ ok: false, reason: "pending" })
  })

  test("a failed send keeps the invitation", async () => {
    failSend = true
    const result = await inviteMember(
      {
        tenant: tenant("a"),
        actorId: users.admin,
        email: "baru@kampus.ac.id",
      },
      deps,
    )
    expect(result).toMatchObject({ ok: true, mail: "failed" })
    const { rows } = await su.query("SELECT status FROM email_log")
    expect(rows).toEqual([{ status: "failed" }])
  })

  test("a reserved test domain is stored but never mailed", async () => {
    const result = await inviteMember(
      {
        tenant: tenant("a"),
        actorId: users.admin,
        email: "uji@contoh.test",
      },
      deps,
    )
    expect(result).toMatchObject({ ok: true, mail: "failed" })
    expect(sent).toHaveLength(0)
  })

  test("resend extends, cancel closes", async () => {
    const id = await invite()
    sent = []
    clock = new Date(NOW.getTime() + 61_000)
    expect(
      await resendInvitation(
        { tenant: tenant("a"), actorId: users.admin, invitationId: id },
        deps,
      ),
    ).toEqual({ ok: true, mail: "sent" })
    expect(sent).toHaveLength(1)
    expect(
      await cancelInvitation({
        tenant: tenant("a"),
        actorId: users.admin,
        invitationId: id,
      }),
    ).toEqual({ ok: true })
    expect(
      await cancelInvitation({
        tenant: tenant("a"),
        actorId: users.admin,
        invitationId: id,
      }),
    ).toEqual({ ok: false, reason: "not_found" })
    expect((await audit("member.invite_cancel")).length).toBe(1)
    expect((await audit("member.invite_resend")).length).toBe(1)
  })

  test("resend waits a minute, five a day", async () => {
    const id = await invite()
    const resend = () =>
      resendInvitation(
        { tenant: tenant("a"), actorId: users.admin, invitationId: id },
        deps,
      )
    clock = new Date(NOW.getTime() + 10_000)
    expect(await resend()).toEqual({ ok: true, mail: "limited" })
    for (let i = 1; i <= 4; i++) {
      clock = new Date(NOW.getTime() + i * 61_000)
      expect(await resend()).toEqual({ ok: true, mail: "sent" })
    }
    clock = new Date(NOW.getTime() + 3_600_000)
    expect(await resend()).toEqual({ ok: true, mail: "limited" })
    expect(sent).toHaveLength(5)
  })

  test("invitations never reach the OTP reserve", async () => {
    await su.query(
      `INSERT INTO email_log (kind, address_hash, status, created_at)
       SELECT 'notification', 'n' || g, 'sent', $1 FROM generate_series(1, 200) g`,
      [NOW],
    )
    const result = await inviteMember(
      {
        tenant: tenant("a"),
        actorId: users.admin,
        email: "baru@kampus.ac.id",
      },
      deps,
    )
    expect(result).toMatchObject({ ok: true, mail: "limited" })
    expect(sent).toHaveLength(0)
  })

  test("a daily invitation cap holds across campuses", async () => {
    await su.query(
      `INSERT INTO email_log (kind, address_hash, status, created_at)
       SELECT 'invitation', 'i' || g, 'sent', $1 FROM generate_series(1, 50) g`,
      [NOW],
    )
    const result = await inviteMember(
      {
        tenant: tenant("b"),
        actorId: users.admin2,
        email: "baru@kampus.ac.id",
      },
      deps,
    )
    expect(result).toMatchObject({ ok: true, mail: "limited" })
  })

  test("another campus cannot touch the invitation", async () => {
    const id = await invite()
    expect(
      await cancelInvitation({
        tenant: tenant("b"),
        actorId: users.admin2,
        invitationId: id,
      }),
    ).toEqual({ ok: false, reason: "not_found" })
    expect(await readInvitation(orgs.b, id)).toBeNull()
  })
})

describe("accepting", () => {
  const accept = (
    id: string,
    user: string,
    email: string,
    org: "a" | "b" = "a",
    now = NOW,
    emailVerified = true,
  ) =>
    acceptInvitation({
      tenant: tenant(org),
      invitationId: id,
      user: { id: user, email, emailVerified },
      now,
    })

  test("an unproven address cannot accept", async () => {
    const id = await invite("belum@kampus.ac.id")
    expect(
      await accept(id, users.invitee, "belum@kampus.ac.id", "a", NOW, false),
    ).toEqual({ ok: false, reason: "unverified" })
    expect(await role("a", users.invitee)).toBeNull()
  })

  test("the invited address joins as admin", async () => {
    const id = await invite("baru@kampus.ac.id")
    expect(await accept(id, users.invitee, "BARU@kampus.ac.id")).toEqual({
      ok: true,
      role: "admin",
    })
    expect(await role("a", users.invitee)).toBe("admin")
    expect(await audit("member.join")).toEqual([
      { org_id: orgs.a, actor_id: users.invitee },
    ])
    expect(await accept(id, users.invitee, "baru@kampus.ac.id")).toEqual({
      ok: false,
      reason: "used",
    })
  })

  test("another address, host or a late click is refused", async () => {
    const id = await invite()
    expect(await accept(id, users.other, "lain@kampus.ac.id")).toEqual({
      ok: false,
      reason: "email",
    })
    expect(await accept(id, users.invitee, "baru@kampus.ac.id", "b")).toEqual({
      ok: false,
      reason: "not_found",
    })
    const late = new Date("2026-10-23T03:00:00Z")
    expect(
      await accept(id, users.invitee, "baru@kampus.ac.id", "a", late),
    ).toEqual({
      ok: false,
      reason: "expired",
    })
    expect(await role("a", users.invitee)).toBeNull()
  })

  test("a reporter keeps the account and becomes admin", async () => {
    await member("a", users.invitee, "reporter")
    const id = await invite()
    await accept(id, users.invitee, "baru@kampus.ac.id")
    expect(await role("a", users.invitee)).toBe("admin")
  })
})

describe("removal", () => {
  const remove = (actor: string, user: string, org: "a" | "b" = "a") =>
    removeMember({ tenant: tenant(org), actorId: actor, userId: user })

  test("no admin removes themself, even with another admin", async () => {
    expect(await remove(users.admin, users.admin)).toEqual({
      ok: false,
      reason: "self",
    })
    expect(await role("a", users.admin)).toBe("admin")
  })

  test("the only admin of a campus always stays", async () => {
    expect(await remove(users.admin2, users.admin2, "b")).toEqual({
      ok: false,
      reason: "self",
    })
    expect(await role("b", users.admin2)).toBe("admin")
  })

  test("two admins removing each other leave one admin", async () => {
    const results = await Promise.all([
      remove(users.admin, users.peer),
      remove(users.peer, users.admin),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: "forbidden" },
    ])
    const { rows } = await su.query(
      "SELECT count(*)::int AS n FROM members WHERE organization_id = $1 AND role = 'admin'",
      [orgs.a],
    )
    expect(rows[0]?.n).toBe(1)
  })

  test("a reporter cannot manage the team", async () => {
    await member("a", users.other, "reporter")
    expect(await remove(users.other, users.peer)).toEqual({
      ok: false,
      reason: "forbidden",
    })
  })

  test("removal ends admin access and every session", async () => {
    await su.query(
      "INSERT INTO sessions (token, user_id, expires_at) VALUES ('t-peer', $1, now() + interval '1 hour')",
      [users.peer],
    )
    expect(await remove(users.admin, users.peer)).toEqual({ ok: true })
    // Stays a reporter, keeps email
    expect(await role("a", users.peer)).toBe("reporter")
    const { rows } = await su.query(
      "SELECT 1 FROM sessions WHERE user_id = $1",
      [users.peer],
    )
    expect(rows).toHaveLength(0)
    expect((await audit("member.remove")).length).toBe(1)
    expect(await remove(users.admin, users.peer)).toEqual({
      ok: false,
      reason: "not_found",
    })
  })

  test("an admin of another campus reaches nothing", async () => {
    expect(await remove(users.admin2, users.peer, "b")).toEqual({
      ok: false,
      reason: "not_found",
    })
    expect(await role("a", users.peer)).toBe("admin")
  })

  test("the team lists admins with second factor state", async () => {
    await su.query("UPDATE users SET two_factor_enabled = true WHERE id = $1", [
      users.admin,
    ])
    await invite()
    const team = await listTeam(orgs.a, NOW)
    expect(team.members.map((m) => [m.email, m.role, m.twoFactor])).toEqual([
      ["admin@kampus.ac.id", "admin", true],
      ["rekan@kampus.ac.id", "admin", false],
    ])
    expect(team.invitations.map((i) => [i.email, i.expired])).toEqual([
      ["baru@kampus.ac.id", false],
    ])
  })
})
