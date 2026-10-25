import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import sharp from "sharp"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { readSettings, setIntakePause } from "./settings.server.ts"

const su = superuserPool()
const orgs = { a: "", b: "" }
const users = { admin: "", mod: "" }

const tenant = (org: "a" | "b") => ({
  id: orgs[org],
  host: `set${org}.localhost`,
})

async function org(id: string) {
  const { rows } = await su.query<{
    theme: Record<string, string>
    settings: Record<string, unknown>
    logo_hash: string | null
  }>("SELECT theme, settings, logo_hash FROM organizations WHERE id = $1", [id])
  return rows[0]
}

async function audit(action: string) {
  const { rows } = await su.query<{
    org_id: string
    changed_columns: string[]
    reason_code: string | null
    entity_type: string
  }>(
    "SELECT org_id, changed_columns, reason_code, entity_type FROM audit_log WHERE action = $1",
    [action],
  )
  return rows
}

const _png = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: "#176bff" },
  })
    .png()
    .toBuffer()

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
})

beforeEach(async () => {
  await resetData(su)
  orgs.a = await insertOrg(su, "seta")
  orgs.b = await insertOrg(su, "setb")
  users.admin = await insertUser(su, "admin@kampus.ac.id")
  users.mod = await insertUser(su, "mod@kampus.ac.id")
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'reporter')",
    [orgs.a, users.admin, users.mod],
  )
  await su.query(
    `UPDATE organizations SET settings = '{"credit":"Tim lama"}' WHERE id = $1`,
    [orgs.a],
  )
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("intake pause", () => {
  test("merges into settings and keeps other facts", async () => {
    const result = await setIntakePause({
      tenant: tenant("a"),
      actorId: users.admin,
      paused: true,
      statusUrl: "https://status.contoh.id",
    })
    expect(result).toEqual({ ok: true })
    expect((await org(orgs.a))?.settings).toEqual({
      credit: "Tim lama",
      intakePaused: true,
      statusUrl: "https://status.contoh.id/",
    })
    expect((await audit("settings.intake_pause"))[0]).toMatchObject({
      reason_code: "paused",
      changed_columns: ["intakePaused", "statusUrl"],
    })
    expect(await readSettings(orgs.a)).toMatchObject({
      intakePaused: true,
      statusUrl: "https://status.contoh.id/",
    })
  })

  test("an empty status link removes it, http is refused", async () => {
    await setIntakePause({
      tenant: tenant("a"),
      actorId: users.admin,
      paused: true,
      statusUrl: "https://status.contoh.id",
    })
    expect(
      await setIntakePause({
        tenant: tenant("a"),
        actorId: users.admin,
        paused: false,
        statusUrl: "http://status.contoh.id",
      }),
    ).toEqual({ ok: false, reason: "status_url" })
    await setIntakePause({
      tenant: tenant("a"),
      actorId: users.admin,
      paused: false,
      statusUrl: "",
    })
    expect((await org(orgs.a))?.settings).toEqual({
      credit: "Tim lama",
      intakePaused: false,
    })
  })
})
