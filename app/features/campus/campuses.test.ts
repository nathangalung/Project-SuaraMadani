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
  createCampus,
  listCampuses,
  resendFirstInvitation,
} from "./campuses.server.ts"
import type { TeamDeps } from "./members.server.ts"

const su = superuserPool()
const NOW = new Date("2026-10-15T03:00:00Z")
let clock = NOW
let root = ""
let plain = ""
let sent: EmailMessage[] = []
let resets = 0

const deps: TeamDeps & { resetAuth: () => void } = {
  email: { send: async (message) => void sent.push(message) },
  now: () => clock,
  origin: (host) => `http://${host}`,
  hashKey: () => Buffer.alloc(32, 4),
  resetAuth: () => {
    resets++
  },
}

const value = {
  slug: "ui",
  name: "BEM UI",
  campusName: "Universitas Indonesia",
  campusCode: "UI",
  adminEmail: "admin@ui.ac.id",
  contactEmail: null,
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await resetData(su)
  await su.query("DELETE FROM email_log")
  sent = []
  clock = NOW
  resets = 0
  root = await insertUser(su, "root@suaramadani.test")
  plain = await insertUser(su, "biasa@suaramadani.test")
  await su.query("UPDATE users SET superadmin = true WHERE id = $1", [root])
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("creating a campus", () => {
  test("org, admin invitation, audit and mail in one go", async () => {
    const result = await createCampus(
      { actorId: root, value, apexHost: "localhost" },
      deps,
    )
    if (!result.ok) throw new Error(result.reason)
    const { rows } = await su.query(
      "SELECT name, slug, host, campus_code, campus_name, theme, settings FROM organizations WHERE id = $1",
      [result.orgId],
    )
    expect(rows[0]).toEqual({
      name: "BEM UI",
      slug: "ui",
      host: "ui.localhost",
      campus_code: "UI",
      campus_name: "Universitas Indonesia",
      theme: {},
      settings: {},
    })
    const { rows: invites } = await su.query(
      "SELECT email, role, status, inviter_id FROM invitations WHERE organization_id = $1",
      [result.orgId],
    )
    expect(invites).toEqual([
      {
        email: "admin@ui.ac.id",
        role: "admin",
        status: "pending",
        inviter_id: root,
      },
    ])
    const { rows: audit } = await su.query(
      "SELECT action, actor_id FROM audit_log WHERE org_id = $1 ORDER BY action",
      [result.orgId],
    )
    expect(audit).toEqual([
      { action: "campus.create", actor_id: root },
      { action: "member.invite", actor_id: root },
    ])
    expect(sent[0]?.to).toBe("admin@ui.ac.id")
    expect(sent[0]?.text).toContain("http://ui.localhost/undangan/")
    // New host trusted without restart
    expect(resets).toBe(1)
    expect(result.mail).toBe("sent")
  })

  test("only a superadmin may create", async () => {
    const result = await createCampus(
      { actorId: plain, value, apexHost: "localhost" },
      deps,
    )
    expect(result).toEqual({ ok: false, reason: "forbidden" })
    const { rows } = await su.query("SELECT 1 FROM organizations")
    expect(rows).toHaveLength(0)
  })

  test("a taken subdomain or code is named", async () => {
    await insertOrg(su, "ui")
    expect(
      await createCampus({ actorId: root, value, apexHost: "localhost" }, deps),
    ).toEqual({ ok: false, reason: "taken", field: "slug" })
    expect(
      await createCampus(
        {
          actorId: root,
          value: { ...value, slug: "univ-indonesia" },
          apexHost: "localhost",
        },
        deps,
      ),
    ).toEqual({ ok: false, reason: "taken", field: "campusCode" })
    expect(sent).toHaveLength(0)
  })

  test("the list counts admins and open invitations", async () => {
    const result = await createCampus(
      { actorId: root, value, apexHost: "localhost" },
      deps,
    )
    if (!result.ok) throw new Error(result.reason)
    const list = await listCampuses()
    expect(list).toEqual([
      expect.objectContaining({
        host: "ui.localhost",
        campusCode: "UI",
        admins: 0,
        pendingInvitations: 1,
      }),
    ])
  })

  test("the first admin invitation can be sent again", async () => {
    const result = await createCampus(
      { actorId: root, value, apexHost: "localhost" },
      deps,
    )
    if (!result.ok) throw new Error(result.reason)
    sent = []
    // Resend spacing is a minute
    clock = new Date(NOW.getTime() + 61_000)
    expect(
      await resendFirstInvitation(
        { actorId: plain, orgId: result.orgId },
        deps,
      ),
    ).toEqual({ ok: false, reason: "forbidden" })
    expect(
      await resendFirstInvitation({ actorId: root, orgId: result.orgId }, deps),
    ).toEqual({ ok: true, mail: "sent" })
    expect(sent[0]?.to).toBe("admin@ui.ac.id")
    // Then campus admins own it
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [result.orgId, plain],
    )
    expect(
      await resendFirstInvitation({ actorId: root, orgId: result.orgId }, deps),
    ).toEqual({ ok: false, reason: "not_found" })
  })
})
