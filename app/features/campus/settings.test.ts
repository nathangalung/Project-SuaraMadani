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
import { LOGO_MAX_BYTES } from "../../../shared/campus.ts"
import {
  readLogo,
  readSettings,
  removeLogo,
  saveIdentity,
  saveLogo,
  saveTheme,
  setIntakePause,
} from "./settings.server.ts"

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

const png = (width: number, height: number) =>
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

describe("theme", () => {
  test("an admin saves, the audit names the tokens", async () => {
    const result = await saveTheme({
      tenant: tenant("a"),
      actorId: users.admin,
      theme: { brand: "#176bff" },
      changed: ["brand"],
    })
    expect(result).toEqual({ ok: true })
    expect((await org(orgs.a))?.theme).toEqual({ brand: "#176bff" })
    expect(await audit("settings.theme")).toEqual([
      {
        org_id: orgs.a,
        changed_columns: ["brand"],
        reason_code: null,
        entity_type: "organization",
      },
    ])
  })

  test("a reporter or another campus changes nothing", async () => {
    const input = { theme: { brand: "#176bff" }, changed: ["brand" as const] }
    expect(
      await saveTheme({ tenant: tenant("a"), actorId: users.mod, ...input }),
    ).toEqual({ ok: false, reason: "forbidden" })
    expect(
      await saveTheme({ tenant: tenant("b"), actorId: users.admin, ...input }),
    ).toEqual({ ok: false, reason: "forbidden" })
    expect((await org(orgs.a))?.theme).toEqual({})
    expect((await org(orgs.b))?.theme).toEqual({})
  })
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

describe("logo", () => {
  test("stored as a re-encoded WebP and served by hash", async () => {
    const result = await saveLogo({
      tenant: tenant("a"),
      actorId: users.admin,
      bytes: new Uint8Array(await png(400, 400)),
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.file).toMatch(/^[0-9a-f]{16}\.webp$/)
    const logo = await readLogo(orgs.a, result.file)
    expect(logo).not.toBeNull()
    const meta = await sharp(logo ?? Buffer.alloc(0)).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.height).toBeLessThanOrEqual(168)
    // Another campus never serves it
    expect(await readLogo(orgs.b, result.file)).toBeNull()
    expect((await audit("settings.logo"))[0]?.reason_code).toBe("set")
  })

  test("SVG, junk and oversize files are refused", async () => {
    const svg = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg'/>",
    )
    const big = new Uint8Array(LOGO_MAX_BYTES + 1)
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const broken = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
    ])
    for (const bytes of [svg, big, broken]) {
      expect(
        await saveLogo({ tenant: tenant("a"), actorId: users.admin, bytes }),
      ).toEqual({ ok: false, reason: "invalid" })
    }
    expect((await org(orgs.a))?.logo_hash).toBeNull()
  })

  test("removal clears it", async () => {
    await saveLogo({
      tenant: tenant("a"),
      actorId: users.admin,
      bytes: new Uint8Array(await png(120, 60)),
    })
    expect(
      await removeLogo({ tenant: tenant("a"), actorId: users.admin }),
    ).toEqual({
      ok: true,
    })
    expect((await org(orgs.a))?.logo_hash).toBeNull()
  })
})

describe("operator identity", () => {
  const identity = {
    name: "KM ITB",
    campusName: "Institut Teknologi Bandung",
    contactEmail: "halo@km.itb.ac.id",
    alliance: "Aliansi Mahasiswa Indonesia",
    legalNumber: null,
    credit: null,
    officers: ["Ketua: Ani Rahma"],
  }

  test("an admin saves, facts merge, the audit names fields", async () => {
    await setIntakePause({
      tenant: tenant("a"),
      actorId: users.admin,
      paused: true,
      statusUrl: "",
    })
    const result = await saveIdentity({
      tenant: tenant("a"),
      actorId: users.admin,
      identity,
    })
    expect(result).toEqual({ ok: true })
    const { rows } = await su.query(
      "SELECT name, campus_name, contact_email, settings FROM organizations WHERE id = $1",
      [orgs.a],
    )
    expect(rows[0]).toEqual({
      name: "KM ITB",
      campus_name: "Institut Teknologi Bandung",
      contact_email: "halo@km.itb.ac.id",
      settings: {
        intakePaused: true,
        alliance: "Aliansi Mahasiswa Indonesia",
        officers: ["Ketua: Ani Rahma"],
      },
    })
    const [row] = await audit("settings.identity")
    expect(row?.changed_columns).toEqual([
      "name",
      "campusName",
      "contactEmail",
      "alliance",
      "credit",
      "officers",
    ])
  })

  test("a reporter or another campus changes nothing", async () => {
    for (const [org, actor] of [
      ["a", users.mod],
      ["b", users.admin],
    ] as const) {
      expect(
        await saveIdentity({ tenant: tenant(org), actorId: actor, identity }),
      ).toEqual({ ok: false, reason: "forbidden" })
    }
    expect(await audit("settings.identity")).toEqual([])
  })
})
