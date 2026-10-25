import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test"
import { Pool } from "pg"
import { createFirstCampus, inviteFirstAdmin, main } from "./first-campus.ts"
import { migrate } from "./migrate.ts"
import { insertUser, resetData, superuserPool, testUrl } from "./testing.ts"

const su = superuserPool()
let migrator: Pool

const CAMPUS = {
  slug: "itb",
  name: "KM ITB",
  campusName: "Institut Teknologi Bandung",
  campusCode: "ITB",
  adminEmail: "ketua@km.itb.ac.id",
  contactEmail: null,
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  migrator = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
  })
})

beforeEach(async () => {
  await resetData(su)
})

afterAll(async () => {
  await resetData(su)
  await migrator.end()
  await su.end()
})

test("creates only the organization row, no account", async () => {
  const created = await createFirstCampus(migrator, CAMPUS, "sadarbersuara.id")
  expect(created).toEqual({ ok: true, host: "itb.sadarbersuara.id" })
  const orgs = await su.query("SELECT host, campus_code FROM organizations")
  expect(orgs.rows).toEqual([
    { host: "itb.sadarbersuara.id", campus_code: "ITB" },
  ])
  const users = await su.query("SELECT 1 FROM users")
  expect(users.rowCount).toBe(0)
  expect(await createFirstCampus(migrator, CAMPUS, "sadarbersuara.id")).toEqual(
    { ok: false, reason: "taken" },
  )
})

test("invites the first admin as the superadmin", async () => {
  await createFirstCampus(migrator, CAMPUS, "sadarbersuara.id")
  const root = await insertUser(su, "operator@aliansi.id")
  const input = {
    slug: "itb",
    adminEmail: "Ketua@KM.itb.ac.id",
    superadminEmail: "operator@aliansi.id",
  }
  expect(await inviteFirstAdmin(migrator, input)).toEqual({
    ok: false,
    reason: "not_superadmin",
  })
  await su.query("UPDATE users SET superadmin = true WHERE id = $1", [root])
  expect(await inviteFirstAdmin(migrator, input)).toEqual({ ok: true })
  const invites = await su.query(
    "SELECT email, role, status, inviter_id FROM invitations",
  )
  expect(invites.rows).toEqual([
    {
      email: "ketua@km.itb.ac.id",
      role: "admin",
      status: "pending",
      inviter_id: root,
    },
  ])
  const audit = await su.query(
    "SELECT action, actor_id FROM audit_log WHERE entity_type = 'invitation'",
  )
  expect(audit.rows).toEqual([{ action: "member.invite", actor_id: root }])
  // Second run: resend from /admin
  expect(await inviteFirstAdmin(migrator, input)).toEqual({
    ok: false,
    reason: "invited",
  })
})

test("refuses an unknown campus or bad input", async () => {
  expect(
    await inviteFirstAdmin(migrator, {
      slug: "ugm",
      adminEmail: "a@ugm.ac.id",
      superadminEmail: "operator@aliansi.id",
    }),
  ).toEqual({ ok: false, reason: "no_campus" })
  expect(
    await createFirstCampus(
      migrator,
      { ...CAMPUS, campusCode: "itb!" },
      "sadarbersuara.id",
    ),
  ).toEqual({ ok: false, reason: "invalid", fields: ["campusCode"] })
})

test("Given a racing invite still uncommitted, when the CLI invite times out, then no invite or audit row is left and a retry succeeds", async () => {
  await createFirstCampus(migrator, CAMPUS, "sadarbersuara.id")
  const root = await insertUser(su, "operator@aliansi.id")
  await su.query("UPDATE users SET superadmin = true WHERE id = $1", [root])
  const input = {
    slug: "itb",
    adminEmail: "ketua@km.itb.ac.id",
    superadminEmail: "operator@aliansi.id",
  }
  // One connection, reused after failure
  const impatient = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
    options: "-c lock_timeout=200",
    max: 1,
  })
  const holder = await su.connect()
  try {
    await holder.query("BEGIN")
    await holder.query(
      `INSERT INTO invitations (organization_id, email, role, status, expires_at, inviter_id)
       SELECT id, 'ketua@km.itb.ac.id', 'admin', 'pending', now() + interval '1 day', $1
       FROM organizations WHERE slug = 'itb'`,
      [root],
    )
    const error = await inviteFirstAdmin(impatient, input).catch(
      (e: { code?: string }) => e,
    )
    expect((error as { code?: string }).code).toBe("55P03")
    await holder.query("ROLLBACK")
    expect((await su.query("SELECT 1 FROM invitations")).rowCount).toBe(0)
    expect((await su.query("SELECT 1 FROM audit_log")).rowCount).toBe(0)
    expect(await inviteFirstAdmin(impatient, input)).toEqual({ ok: true })
  } finally {
    holder.release()
    await impatient.end()
  }
})

describe("bun db/first-campus.ts", () => {
  const env = {
    DATABASE_MIGRATOR_URL: testUrl("TEST_DATABASE_MIGRATOR_URL"),
    APEX_HOST: "sadarbersuara.id",
  }
  const create = [
    "create",
    "itb",
    "ITB",
    "KM ITB",
    "Institut Teknologi Bandung",
    "ketua@km.itb.ac.id",
  ]

  async function run(argv: string[], vars: Record<string, string> = env) {
    const logged = spyOn(console, "log").mockImplementation(() => {})
    const failed = spyOn(console, "error").mockImplementation(() => {})
    try {
      const code = await main(argv, vars)
      const lines = [...logged.mock.calls, ...failed.mock.calls].map(([line]) =>
        String(line),
      )
      return { code, lines }
    } finally {
      logged.mockRestore()
      failed.mockRestore()
    }
  }

  test("Given a new campus, when create then invite run, then the campus and a pending admin invite exist", async () => {
    expect(await run(create)).toEqual({
      code: 0,
      lines: [
        JSON.stringify({
          msg: "first campus",
          command: "create",
          ok: true,
          host: "itb.sadarbersuara.id",
        }),
      ],
    })
    const root = await insertUser(su, "operator@aliansi.id")
    await su.query("UPDATE users SET superadmin = true WHERE id = $1", [root])
    const invite = [
      "invite",
      "itb",
      "ketua@km.itb.ac.id",
      "operator@aliansi.id",
    ]
    expect((await run(invite)).code).toBe(0)
    const { rows } = await su.query("SELECT email, status FROM invitations")
    expect(rows).toEqual([{ email: "ketua@km.itb.ac.id", status: "pending" }])
  })

  test("Given the slug is taken, when create runs again, then exit is 1", async () => {
    await run(create)
    const again = await run(create)
    expect(again.code).toBe(1)
    expect(JSON.parse(again.lines[0] ?? "{}")).toMatchObject({
      ok: false,
      reason: "taken",
    })
  })

  test("wrong arity or an unknown command prints usage, touching nothing", async () => {
    for (const argv of [[], ["create", "itb"], ["invite", "itb"], ["drop"]]) {
      const { code, lines } = await run(argv)
      expect(code).toBe(2)
      expect(lines[0]).toStartWith("usage:")
    }
    expect((await su.query("SELECT 1 FROM organizations")).rowCount).toBe(0)
  })

  test("create without APEX_HOST refuses to run", async () => {
    const { APEX_HOST: _, ...noApex } = env
    await expect(run(create, noApex)).rejects.toThrow("APEX_HOST is not set")
  })
})
