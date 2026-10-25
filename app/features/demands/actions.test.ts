import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RouterContextProvider } from "react-router"
import { migrate } from "../../../db/migrate.ts"
import type { MemberRole } from "../../../db/schema/auth.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { staffContext } from "../../../server/request-context.server.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import {
  createDemandAction,
  demandEditorAction,
  outcome,
} from "./actions.server.ts"
import {
  changeDemandState,
  createDemand,
  type DemandFields,
  type DemandTenant,
  getManagedDemand,
  uploadBrief,
} from "./manage.server.ts"

process.env.AUDIT_HMAC_KEY ||= Buffer.alloc(32, 7).toString("base64")

const su = superuserPool()
let tenant: DemandTenant
let admin = ""
let filesDir = ""
const savedFilesDir = process.env.FILES_DIR
const YEAR = jakartaIsoDate(new Date()).slice(2, 4)
const FIRST = `TUN-FDACT-${YEAR}-0001`
const ISSUE = "ISU-2026-10-0001"
const MISSING_ID = "0190a000-0000-7000-8000-00000000abcd"

const FIELDS: DemandFields = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: "32.73",
  category: "pendidikan",
  title: "Transparansi anggaran beasiswa daerah",
  body: "Kami menuntut pemerintah kota membuka rincian anggaran beasiswa daerah.",
  summary: "Rincian anggaran beasiswa daerah dibuka untuk publik.",
  target: "Pemerintah Kota Bandung",
  raisedOn: "2026-09-01",
  briefUrl: null,
}

// Form strings for FIELDS
const FORM: Record<string, string> = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: "32.73",
  category: "pendidikan",
  title: FIELDS.title,
  body: FIELDS.body,
  summary: FIELDS.summary,
  target: FIELDS.target,
  raisedOn: FIELDS.raisedOn,
}

function context(role: MemberRole | null = "admin") {
  const provider = new RouterContextProvider()
  provider.set(tenantContext, {
    id: tenant.id,
    slug: "fdact",
    host: tenant.host,
    name: "KM FDACT",
    campusCode: tenant.campusCode,
    campusName: "fdact",
    theme: {},
    settings: {},
  })
  provider.set(sessionContext, {
    user: {
      id: admin,
      email: "admin.aksi@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: true,
      updatedAt: new Date(0),
    },
    session: {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  })
  provider.set(staffContext, role ? { role } : null)
  return provider
}

const post = (fields: Record<string, string>) =>
  new Request("http://fdact.localhost/kelola/tuntutan", {
    method: "POST",
    body: new URLSearchParams(fields),
  })

const create = (fields: Record<string, string>, role?: MemberRole | null) =>
  createDemandAction({ request: post(fields), context: context(role) })

const edit = (code: string, fields: Record<string, string>) =>
  demandEditorAction({
    request: post(fields),
    params: { code },
    context: context(),
  })

type Thrown = { status: number; location: string | null }

async function thrown(run: Promise<unknown>): Promise<Thrown> {
  try {
    await run
  } catch (error) {
    if (error instanceof Response) {
      return { status: error.status, location: error.headers.get("Location") }
    }
    const status = (error as { init?: { status?: number } }).init?.status
    if (status) return { status, location: null }
    throw error
  }
  throw new Error("expected a thrown response")
}

async function draft(
  items = ["Rincian anggaran per sekolah", "Daftar penerima"],
) {
  const result = await createDemand(tenant, {
    fields: FIELDS,
    items,
    actorId: admin,
  })
  if (!result.ok) throw new Error(result.reason)
  return result.code
}

async function managed(code: string) {
  const demand = await getManagedDemand(tenant.id, code)
  if (!demand) throw new Error("no demand")
  return demand
}

async function published(items?: string[]) {
  const code = await draft(items)
  const result = await changeDemandState(tenant, {
    code,
    action: "publish",
    version: (await managed(code)).version,
    note: null,
    actorId: admin,
  })
  if (!result.ok) throw new Error(result.reason)
  return code
}

async function firstItem(code: string) {
  const item = (await managed(code)).items[0]
  if (!item) throw new Error("no item")
  return item
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  tenant = {
    id: await insertOrg(su, "fdact"),
    host: "fdact.localhost",
    campusCode: "FDACT",
  }
  admin = await insertUser(su, "admin.aksi@contoh.id")
  filesDir = await mkdtemp(join(tmpdir(), "sb-fdact-"))
  process.env.FILES_DIR = filesDir
})

beforeEach(async () => {
  await su.query("DELETE FROM demands")
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM org_counters")
})

afterAll(async () => {
  if (savedFilesDir === undefined) delete process.env.FILES_DIR
  else process.env.FILES_DIR = savedFilesDir
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("new tuntutan form", () => {
  test("Given a valid form with two lines, when an admin posts, then a draft opens in the editor", async () => {
    const res = await thrown(
      create({
        ...FORM,
        items: "Rincian anggaran per sekolah\n\nDaftar penerima",
      }),
    )
    expect(res).toEqual({
      status: 303,
      location: `/kelola/tuntutan/${FIRST}?dibuat=1`,
    })
    const demand = await managed(FIRST)
    expect(demand.state).toBe("draft")
    expect(demand.title).toBe(FIELDS.title)
    expect(demand.items.map((item) => item.body)).toEqual([
      "Rincian anggaran per sekolah",
      "Daftar penerima",
    ])
  })

  test("an unknown province or regency is refused and the form refilled", async () => {
    expect(
      await create({ ...FORM, provinceCode: "99", regencyCode: "" }),
    ).toEqual({
      errors: ["province"],
      values: expect.objectContaining({
        title: FIELDS.title,
        provinceCode: "99",
      }),
    })
    expect(await create({ ...FORM, regencyCode: "32.99" })).toEqual({
      errors: ["regency"],
      values: expect.objectContaining({ regencyCode: "32.99" }),
    })
    expect(await getManagedDemand(tenant.id, FIRST)).toBeNull()
  })

  test("field and item errors are reported together", async () => {
    const result = await create({ ...FORM, title: "Pendek", items: "kurang" })
    expect(result.errors).toEqual(["title", "items"])
    expect(result.values.items).toBe("kurang")
  })

  test("a national tuntutan skips the region check", async () => {
    const res = await thrown(
      create({ ...FORM, scope: "national", provinceCode: "99", items: "" }),
    )
    expect(res.status).toBe(303)
    const demand = await managed(FIRST)
    expect([demand.scope, demand.provinceCode, demand.items]).toEqual([
      "national",
      null,
      [],
    ])
  })

  test("an editor is not an admin and gets 403", async () => {
    expect(await thrown(create(FORM, "editor"))).toEqual({
      status: 403,
      location: null,
    })
    expect(await getManagedDemand(tenant.id, FIRST)).toBeNull()
  })
})

describe("editor requests", () => {
  test("a malformed code is 404, an unknown intent or item id is 400", async () => {
    const code = await draft()
    expect((await thrown(edit("bukan-kode", { intent: "edit" }))).status).toBe(
      404,
    )
    expect((await thrown(edit(code, { intent: "hapus" }))).status).toBe(400)
    expect(
      (await thrown(edit(code, { intent: "remove_item", itemId: "x" }))).status,
    ).toBe(400)
    // Versioned intents need a version
    for (const intent of ["edit", "publish", "edit_item", "edit_brief"]) {
      const itemId = (await firstItem(code)).id
      expect((await thrown(edit(code, { intent, itemId }))).status).toBe(400)
    }
  })

  test("an unknown tuntutan is 404", async () => {
    expect(
      (
        await thrown(
          edit(FIRST, { intent: "add_item", body: "Butir baru di sini" }),
        )
      ).status,
    ).toBe(404)
  })
})

describe("edit details", () => {
  test("Given the current version, when the title changes, then it is saved", async () => {
    const code = await draft()
    const { version } = await managed(code)
    const title = "Transparansi anggaran beasiswa kota"
    expect(
      await edit(code, {
        ...FORM,
        intent: "edit",
        version: String(version),
        title,
      }),
    ).toEqual({ saved: "edit" })
    expect(await managed(code)).toMatchObject({ title, version: version + 1 })
  })

  test("invalid fields and unknown regions come back with the form", async () => {
    const code = await draft()
    const version = String((await managed(code)).version)
    expect(
      await edit(code, { ...FORM, intent: "edit", version, title: "x" }),
    ).toEqual({
      errors: ["title"],
      intent: "edit",
      values: expect.objectContaining({ title: "x" }),
    })
    expect(
      await edit(code, {
        ...FORM,
        intent: "edit",
        version,
        regencyCode: "32.99",
      }),
    ).toMatchObject({ errors: ["regency"], intent: "edit" })
  })

  test("a stale version is a conflict, not a save", async () => {
    const code = await draft()
    const { version } = await managed(code)
    expect(
      await edit(code, {
        ...FORM,
        intent: "edit",
        version: String(version + 5),
        title: "Judul yang datang terlambat",
      }),
    ).toEqual({ conflict: true })
    expect((await managed(code)).title).toBe(FIELDS.title)
  })

  test("a raised date after a status update is refused with the form refilled", async () => {
    const code = await published()
    const item = await firstItem(code)
    expect(
      await edit(code, {
        intent: "update_item",
        itemId: item.id,
        version: String(item.version),
        response: "responded",
        fulfilment: "fulfilled",
        occurredOn: "2026-09-10",
        note: "Dinas menjawab surat audiensi tertulis.",
        sourceText: "Surat dinas",
      }),
    ).toEqual({ saved: "update_item", itemId: item.id })
    const { version } = await managed(code)
    expect(
      await edit(code, {
        ...FORM,
        intent: "edit",
        version: String(version),
        raisedOn: "2026-09-20",
      }),
    ).toEqual({
      errors: ["raised_after_updates"],
      intent: "edit",
      values: expect.objectContaining({ raisedOn: "2026-09-20" }),
    })
  })
})

describe("state changes", () => {
  test("publish, close with a reason, then reopen", async () => {
    const code = await draft()
    const step = async (intent: string, note = "") =>
      edit(code, {
        intent,
        version: String((await managed(code)).version),
        note,
      })
    expect(await step("publish")).toEqual({ saved: "publish" })
    expect((await managed(code)).state).toBe("published")
    expect(await step("close", "pendek")).toEqual({
      errors: ["close_note"],
      intent: "close",
    })
    expect((await managed(code)).state).toBe("published")
    expect(await step("close", "Tuntutan digabung dengan yang lain.")).toEqual({
      saved: "close",
    })
    expect((await managed(code)).state).toBe("closed")
    expect(await step("reopen")).toEqual({ saved: "reopen" })
    expect((await managed(code)).state).toBe("published")
  })

  test("a transition the state does not allow is a conflict", async () => {
    const code = await published()
    const { version } = await managed(code)
    expect(
      await edit(code, { intent: "reopen", version: String(version) }),
    ).toEqual({ conflict: true })
    expect(await managed(code)).toMatchObject({ state: "published", version })
  })

  test("a draft is deleted and the list opens", async () => {
    const code = await draft()
    expect(await thrown(edit(code, { intent: "delete" }))).toEqual({
      status: 303,
      location: "/kelola/tuntutan?dihapus=1",
    })
    expect(await getManagedDemand(tenant.id, code)).toBeNull()
  })

  test("a published tuntutan is never deleted", async () => {
    const code = await published()
    expect(await edit(code, { intent: "delete" })).toEqual({ conflict: true })
    expect((await managed(code)).state).toBe("published")
  })
})

describe("sub-tuntutan", () => {
  test("add needs a long enough body", async () => {
    const code = await draft()
    expect(await edit(code, { intent: "add_item", body: "pendek" })).toEqual({
      errors: ["item_body"],
      intent: "add_item",
      values: { body: "pendek", briefUrl: "" },
    })
    expect(
      await edit(code, {
        intent: "add_item",
        body: "Jadwal penyaluran beasiswa",
      }),
    ).toEqual({ saved: "add_item" })
    expect((await managed(code)).items.map((item) => item.body)).toEqual([
      "Rincian anggaran per sekolah",
      "Daftar penerima",
      "Jadwal penyaluran beasiswa",
    ])
  })

  test("a thirteenth sub-tuntutan is refused", async () => {
    const code = await draft(
      Array.from({ length: 12 }, (_, i) => `Sub-tuntutan nomor ${i + 1}`),
    )
    expect(
      await edit(code, { intent: "add_item", body: "Sub-tuntutan nomor 13" }),
    ).toEqual({ errors: ["items"], intent: "add_item" })
    expect((await managed(code)).items).toHaveLength(12)
  })

  test("edit keeps the typed body on error and saves a valid one", async () => {
    const code = await draft()
    const item = await firstItem(code)
    const base = {
      intent: "edit_item",
      itemId: item.id,
      version: String(item.version),
    }
    expect(await edit(code, { ...base, body: "pendek" })).toEqual({
      errors: ["item_body"],
      intent: "edit_item",
      itemId: item.id,
      values: { body: "pendek", briefUrl: "" },
    })
    expect(
      await edit(code, {
        ...base,
        body: "Rincian anggaran per sekolah negeri",
      }),
    ).toEqual({ saved: "edit_item", itemId: item.id })
    expect((await firstItem(code)).body).toBe(
      "Rincian anggaran per sekolah negeri",
    )
  })

  test("a brief link is checked on the server, kept on error, saved and cleared", async () => {
    const code = await draft()
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      `https://contoh.id/${"a".repeat(483)}`,
    ]) {
      expect(
        await edit(code, {
          intent: "add_item",
          body: "Jadwal penyaluran beasiswa",
          briefUrl: bad,
        }),
      ).toEqual({
        errors: ["item_brief_url"],
        intent: "add_item",
        values: { body: "Jadwal penyaluran beasiswa", briefUrl: bad },
      })
    }
    expect((await managed(code)).items).toHaveLength(2)
    const item = await firstItem(code)
    const base = {
      intent: "edit_item",
      itemId: item.id,
      version: String(item.version),
      body: item.body,
    }
    expect(
      await edit(code, { ...base, briefUrl: "javascript:alert(1)" }),
    ).toMatchObject({ errors: ["item_brief_url"], itemId: item.id })
    expect((await firstItem(code)).briefUrl).toBeNull()
    const link = "https://docs.google.com/document/d/kajian/view"
    expect(await edit(code, { ...base, briefUrl: ` ${link} ` })).toEqual({
      saved: "edit_item",
      itemId: item.id,
    })
    expect((await firstItem(code)).briefUrl).toBe(link)
    const saved = await firstItem(code)
    expect(
      await edit(code, {
        ...base,
        version: String(saved.version),
        briefUrl: "",
      }),
    ).toEqual({ saved: "edit_item", itemId: item.id })
    expect((await firstItem(code)).briefUrl).toBeNull()
  })

  test("the brief summary is length checked, saved, and cleared", async () => {
    const code = await draft()
    const item = await firstItem(code)
    const base = { intent: "edit_brief", itemId: item.id }
    expect(
      await edit(code, {
        ...base,
        version: String(item.version),
        briefSummary: "x".repeat(1501),
      }),
    ).toEqual({
      errors: ["brief_summary"],
      intent: "edit_brief",
      itemId: item.id,
      values: { briefSummary: "x".repeat(1501) },
    })
    expect(
      await edit(code, {
        ...base,
        version: String(item.version),
        briefSummary: "Ringkasan kajian anggaran.",
      }),
    ).toEqual({ saved: "edit_brief", itemId: item.id })
    const saved = await firstItem(code)
    expect(saved.briefSummary).toBe("Ringkasan kajian anggaran.")
    await edit(code, {
      ...base,
      version: String(saved.version),
      briefSummary: "",
    })
    expect((await firstItem(code)).briefSummary).toBeNull()
  })

  test("move down, move up, then remove", async () => {
    const code = await draft()
    const first = await firstItem(code)
    const bodies = async () =>
      (await managed(code)).items.map((item) => item.body)
    expect(await edit(code, { intent: "move_down", itemId: first.id })).toEqual(
      {
        saved: "move_down",
        itemId: first.id,
      },
    )
    expect(await bodies()).toEqual([
      "Daftar penerima",
      "Rincian anggaran per sekolah",
    ])
    expect(await edit(code, { intent: "move_up", itemId: first.id })).toEqual({
      saved: "move_up",
      itemId: first.id,
    })
    expect(await bodies()).toEqual([
      "Rincian anggaran per sekolah",
      "Daftar penerima",
    ])
    expect(
      await edit(code, { intent: "remove_item", itemId: first.id }),
    ).toEqual({
      saved: "remove_item",
      itemId: first.id,
    })
    expect(await bodies()).toEqual(["Daftar penerima"])
  })
})

describe("status updates", () => {
  test("Given a published item, when a sourced status arrives, then progress moves", async () => {
    const code = await published()
    const item = await firstItem(code)
    expect(
      await edit(code, {
        intent: "update_item",
        itemId: item.id,
        version: String(item.version),
        response: "responded",
        fulfilment: "fulfilled",
        occurredOn: "2026-10-01",
        note: "Dinas Pendidikan mengunggah rincian anggaran.",
        sourceText: "Laman resmi dinas",
        sourceUrl: "https://contoh.go.id/anggaran",
      }),
    ).toEqual({ saved: "update_item", itemId: item.id })
    expect((await firstItem(code)).state).toEqual({
      response: "responded",
      fulfilment: "fulfilled",
    })
  })

  test("an unknown item is 404, a malformed update 400, a bad date an error", async () => {
    const code = await published()
    const item = await firstItem(code)
    const base = {
      intent: "update_item",
      itemId: item.id,
      version: String(item.version),
      response: "responded",
      fulfilment: "not_fulfilled",
      note: "Dinas menjawab surat audiensi tertulis.",
      sourceText: "Surat dinas",
    }
    expect(
      (await thrown(edit(code, { ...base, itemId: MISSING_ID }))).status,
    ).toBe(404)
    expect(
      (await thrown(edit(code, { ...base, response: "maybe" }))).status,
    ).toBe(400)
    expect(await edit(code, { ...base, occurredOn: "2099-01-01" })).toEqual({
      errors: ["occurred_on"],
      intent: "update_item",
      itemId: item.id,
    })
    expect((await firstItem(code)).state.response).toBe("not_responded")
  })
})

describe("status date race", () => {
  // Another admin dated later status
  test("an update found older inside the lock points at its item", () => {
    expect(
      outcome("update_item", { ok: false, reason: "before_last" }, MISSING_ID),
    ).toEqual({
      errors: ["occurred_before_last"],
      intent: "update_item",
      itemId: MISSING_ID,
    })
  })
})

describe("policy brief", () => {
  test("a clean brief is published then withdrawn from the editor", async () => {
    const code = await published()
    const item = await firstItem(code)
    const upload = await uploadBrief(tenant, {
      code,
      itemId: item.id,
      bytes: new TextEncoder().encode("%PDF-1.4\n"),
      actorId: admin,
    })
    expect(upload.ok).toBe(true)
    const briefId = (await firstItem(code)).briefs[0]?.id ?? ""
    expect(
      (await thrown(edit(code, { intent: "publish_brief", briefId: "x" })))
        .status,
    ).toBe(400)
    // Pending: not yet scanned
    expect(
      await edit(code, { intent: "publish_brief", briefId, itemId: item.id }),
    ).toEqual({ conflict: true })
    await su.query(
      "UPDATE policy_briefs SET status = 'clean', scanned_at = now()",
    )
    expect(
      await edit(code, { intent: "publish_brief", briefId, itemId: item.id }),
    ).toEqual({ saved: "publish_brief", itemId: item.id })
    expect((await firstItem(code)).briefs[0]?.publishedAt).toBeInstanceOf(Date)
    expect(await edit(code, { intent: "withdraw_brief", briefId })).toEqual({
      saved: "withdraw_brief",
    })
    expect((await firstItem(code)).briefs).toEqual([])
  })
})

describe("related issues", () => {
  test("a published issue is linked by code, then unlinked", async () => {
    const code = await published()
    await su.query(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary, category_id, subcategory_id, province_code, regency_code, report_count, published_at)
       VALUES ($1, 2026, 1, $2, 'Beasiswa daerah terlambat cair', 'Pencairan beasiswa daerah terlambat tiga bulan.', 'program', 'program.pendidikan', '32', '32.73', 1, now())`,
      [tenant.id, ISSUE],
    )
    expect(
      await edit(code, { intent: "link_issue", issueCode: "isu-x" }),
    ).toEqual({
      errors: ["issue_code"],
      intent: "link_issue",
    })
    expect(
      await edit(code, {
        intent: "link_issue",
        issueCode: ISSUE.toLowerCase(),
      }),
    ).toEqual({ saved: "link_issue" })
    expect((await managed(code)).issues.map((issue) => issue.code)).toEqual([
      ISSUE,
    ])
    expect(
      await edit(code, { intent: "unlink_issue", issueCode: ISSUE }),
    ).toEqual({
      saved: "unlink_issue",
    })
    expect((await managed(code)).issues).toEqual([])
  })

  test("a well-formed code with no issue behind it is an issue code error", async () => {
    const code = await published()
    expect(
      await edit(code, {
        intent: "link_issue",
        issueCode: "ISU-2026-10-0099",
      }),
    ).toEqual({ errors: ["issue_code"], intent: "link_issue" })
    expect((await managed(code)).issues).toEqual([])
  })
})
