import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
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
import { briefPath } from "../../../server/files.server.ts"
import { staffContext } from "../../../server/request-context.server.ts"
import { BRIEF_MAX_BYTES } from "../../../shared/demands.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import {
  changeDemandState,
  createDemand,
  type DemandTenant,
  getManagedDemand,
} from "../../features/demands/manage.server.ts"
import { action } from "./demand-upload"

process.env.AUDIT_HMAC_KEY ||= Buffer.alloc(32, 7).toString("base64")

const su = superuserPool()
let tenant: DemandTenant
let admin = ""
let filesDir = ""
const savedFilesDir = process.env.FILES_DIR
const PDF = new TextEncoder().encode("%PDF-1.4\n% unggah\n")

function context(role: MemberRole | null) {
  const provider = new RouterContextProvider()
  provider.set(tenantContext, {
    id: tenant.id,
    slug: "fdup",
    host: tenant.host,
    name: "KM FDUP",
    campusCode: tenant.campusCode,
    campusName: "fdup",
    theme: {},
    settings: {},
  })
  provider.set(sessionContext, {
    user: {
      id: admin,
      email: "admin.unggah@contoh.id",
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

function upload(
  code: string,
  itemId: string,
  file: Blob | null,
  role: MemberRole | null = "admin",
): never {
  const form = new FormData()
  form.set("itemId", itemId)
  if (file) form.set("brief", file, "kajian.pdf")
  const request = new Request(
    `http://fdup.localhost/kelola/tuntutan/${code}/unggah`,
    { method: "POST", body: form },
  )
  return { request, params: { code }, context: context(role) } as never
}

async function outcome(args: never): Promise<string | number> {
  try {
    await action(args)
  } catch (error) {
    if (error instanceof Response) return error.headers.get("Location") ?? ""
    const status = (error as { init?: { status?: number } }).init?.status
    if (status) return status
    throw error
  }
  throw new Error("expected a thrown response")
}

async function published(): Promise<{ code: string; itemId: string }> {
  const created = await createDemand(tenant, {
    fields: {
      scope: "national",
      provinceCode: null,
      regencyCode: null,
      category: "lingkungan_hidup",
      title: "Pengelolaan sampah plastik kampus",
      body: "Kami menuntut kebijakan pengurangan sampah plastik di lingkungan kampus.",
      summary: "Kebijakan pengurangan sampah plastik sekali pakai di kampus.",
      target: "Kementerian Lingkungan Hidup",
      raisedOn: "2026-09-01",
      briefUrl: null,
    },
    items: ["Larangan plastik sekali pakai"],
    actorId: admin,
  })
  if (!created.ok) throw new Error(created.reason)
  const code = created.code
  const demand = await getManagedDemand(tenant.id, code)
  const done = await changeDemandState(tenant, {
    code,
    action: "publish",
    version: demand?.version ?? 0,
    note: null,
    actorId: admin,
  })
  if (!done.ok) throw new Error(done.reason)
  return { code, itemId: demand?.items[0]?.id ?? "" }
}

async function briefs() {
  const { rows } = await su.query<{ id: string; status: string }>(
    "SELECT id, status FROM policy_briefs",
  )
  return rows
}

// Refused uploads leave nothing
async function storedFiles(): Promise<string[]> {
  const all = await readdir(filesDir, { recursive: true, withFileTypes: true })
  return all.filter((entry) => entry.isFile()).map((entry) => entry.name)
}

const back = (code: string, result: string, itemId: string) =>
  `/kelola/tuntutan/${code}?dokumen=${result}&butir=${itemId}#sub-${itemId}`

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  tenant = {
    id: await insertOrg(su, "fdup"),
    host: "fdup.localhost",
    campusCode: "FDUP",
  }
  admin = await insertUser(su, "admin.unggah@contoh.id")
  filesDir = await mkdtemp(join(tmpdir(), "sb-fdup-"))
  process.env.FILES_DIR = filesDir
})

beforeEach(async () => {
  await rm(join(filesDir, "evidence"), { recursive: true, force: true })
  await su.query("DELETE FROM demands")
  await su.query("DELETE FROM org_counters")
})

afterAll(async () => {
  if (savedFilesDir === undefined) delete process.env.FILES_DIR
  else process.env.FILES_DIR = savedFilesDir
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("policy brief upload", () => {
  test("Given a PDF for a published sub-tuntutan, when an admin uploads it, then it waits for the scan", async () => {
    const { code, itemId } = await published()
    expect(await outcome(upload(code, itemId, new Blob([PDF])))).toBe(
      back(code, "diunggah", itemId),
    )
    const [brief] = await briefs()
    expect(brief?.status).toBe("pending")
    expect(
      await readFile(briefPath(filesDir, tenant.id, brief?.id ?? "")),
    ).toEqual(Buffer.from(PDF))
  })

  test("an empty, oversized or non-PDF file goes back with a reason", async () => {
    const { code, itemId } = await published()
    expect(await outcome(upload(code, itemId, null))).toBe(
      back(code, "kosong", itemId),
    )
    expect(await outcome(upload(code, itemId, new Blob([])))).toBe(
      back(code, "kosong", itemId),
    )
    const big = new Uint8Array(BRIEF_MAX_BYTES + 1)
    big.set(PDF)
    expect(await outcome(upload(code, itemId, new Blob([big])))).toBe(
      back(code, "besar", itemId),
    )
    expect(await outcome(upload(code, itemId, new Blob(["<html>"])))).toBe(
      back(code, "bukan-pdf", itemId),
    )
    expect(await briefs()).toEqual([])
  })

  test("a closed tuntutan takes no new brief", async () => {
    const { code, itemId } = await published()
    await changeDemandState(tenant, {
      code,
      action: "close",
      version: (await getManagedDemand(tenant.id, code))?.version ?? 0,
      note: "Ditutup setelah audiensi terakhir.",
      actorId: admin,
    })
    expect(await outcome(upload(code, itemId, new Blob([PDF])))).toBe(
      back(code, "ditutup", itemId),
    )
    expect(await briefs()).toEqual([])
    expect(await storedFiles()).toEqual([])
  })

  test("an unknown tuntutan or item is 404, a malformed item id 400", async () => {
    const { code, itemId } = await published()
    const pdf = new Blob([PDF])
    expect(await outcome(upload("x", itemId, pdf))).toBe(404)
    expect(await outcome(upload("TUN-FDUP-26-0099", itemId, pdf))).toBe(404)
    expect(await outcome(upload(code, crypto.randomUUID(), pdf))).toBe(404)
    expect(await outcome(upload(code, "x", pdf))).toBe(400)
    expect(await briefs()).toEqual([])
    expect(await storedFiles()).toEqual([])
  })

  test("only an admin may upload", async () => {
    const { code, itemId } = await published()
    expect(await outcome(upload(code, itemId, new Blob([PDF]), "editor"))).toBe(
      403,
    )
    expect(await briefs()).toEqual([])
  })
})
