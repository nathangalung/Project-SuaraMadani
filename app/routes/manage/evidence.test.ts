import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { RouterContextProvider } from "react-router"
import { migrate } from "../../../db/migrate.ts"
import type { MemberRole } from "../../../db/schema/auth.ts"
import { evidence, reports } from "../../../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { derivedPath, originalPath } from "../../../server/files.server.ts"
import { staffContext } from "../../../server/request-context.server.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import { loader as previewLoader } from "./evidence"
import { loader as originalLoader } from "./evidence-original"

const su = superuserPool()
const suDb = drizzle({ client: su })
const BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6])
const ids = { org: "", admin: "", reporter: "" }
let filesDir = ""
const previousFilesDir = process.env.FILES_DIR

function context(role: MemberRole) {
  const provider = new RouterContextProvider()
  provider.set(tenantContext, {
    id: ids.org,
    slug: "evr",
    host: "evr.localhost",
    name: "KM EVR",
    campusCode: "EVR",
    campusName: "Kampus EVR",
    theme: {},
    settings: {},
  })
  provider.set(sessionContext, {
    user: {
      id: ids.admin,
      email: "admin.evr@contoh.id",
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
  provider.set(staffContext, { role })
  return provider
}

/** Loader result or thrown status. */
async function load(
  loader: typeof previewLoader | typeof originalLoader,
  params: Record<string, string>,
  options: { role?: MemberRole; range?: string } = {},
): Promise<Response | number> {
  const request = new Request("http://evr.localhost/kelola/bukti", {
    headers: options.range ? { range: options.range } : {},
  })
  try {
    return await loader({
      request,
      params,
      context: context(options.role ?? "admin"),
      url: new URL(request.url),
      pattern: "",
    } as never)
  } catch (error) {
    if (error instanceof Error) throw error
    return (error as { init?: { status?: number } }).init?.status ?? 0
  }
}

async function seedFile(
  kind: "image" | "video",
  options: { scanned?: boolean; derived?: string } = {},
): Promise<string> {
  const [report] = await suDb
    .insert(reports)
    .values(reportValues(ids.org, ids.reporter))
    .returning({ id: reports.id })
  if (!report) throw new Error("report not inserted")
  const [row] = await suDb
    .insert(evidence)
    .values({
      orgId: ids.org,
      reportId: report.id,
      position: 0,
      kind,
      declaredName: kind === "video" ? "rekaman.mp4" : "foto.jpg",
      declaredType: kind === "video" ? "video/mp4" : "image/jpeg",
      declaredSize: 1000,
      status: "ready",
      detectedType: kind === "video" ? "video/mp4" : "image/jpeg",
      previewPages: kind === "video" ? 0 : 1,
      scannedAt: options.scanned ? new Date() : null,
    })
    .returning({ id: evidence.id })
  if (!row) throw new Error("evidence not inserted")
  if (options.derived) {
    const path = derivedPath(filesDir, ids.org, row.id, options.derived)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, BYTES)
  }
  const original = originalPath(filesDir, ids.org, row.id)
  await mkdir(dirname(original), { recursive: true })
  await writeFile(original, BYTES)
  return row.id
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  ids.org = await insertOrg(su, "evr")
  ids.admin = await insertUser(su, "admin.evr@contoh.id")
  ids.reporter = await insertUser(su, "pelapor.evr@contoh.id")
  filesDir = await mkdtemp(`${tmpdir()}/sb-evidence-route-`)
  // Loaders read the default dir
  process.env.FILES_DIR = filesDir
})

afterAll(async () => {
  if (previousFilesDir === undefined) delete process.env.FILES_DIR
  else process.env.FILES_DIR = previousFilesDir
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("evidence preview route", () => {
  test("Given an editor session, when a preview is requested, then 403", async () => {
    const id = await seedFile("image", { derived: "0.webp" })
    expect(
      await load(previewLoader, { id, file: "0.webp" }, { role: "editor" }),
    ).toBe(403)
  })

  test("Given an id that is not a UUID or not here, when requested, then 404", async () => {
    expect(await load(previewLoader, { id: "../etc", file: "0.webp" })).toBe(
      404,
    )
    expect(
      await load(previewLoader, { id: crypto.randomUUID(), file: "0.webp" }),
    ).toBe(404)
  })

  test("Given a ready image, when its page is requested, then a sandboxed private webp", async () => {
    const id = await seedFile("image", { derived: "0.webp" })
    const response = await load(previewLoader, { id, file: "0.webp" })
    if (typeof response === "number") throw new Error(`status ${response}`)
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "image/webp",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
  })

  test("Given a ready video, when a byte range is requested, then 206 of that range", async () => {
    const id = await seedFile("video", { derived: "video.mp4" })
    const response = await load(
      previewLoader,
      { id, file: "video.mp4" },
      { range: "bytes=2-5" },
    )
    if (typeof response === "number") throw new Error(`status ${response}`)
    expect(response.status).toBe(206)
    expect(response.headers.get("Content-Type")).toBe("video/mp4")
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      BYTES.slice(2, 6),
    )
  })
})

describe("evidence original route", () => {
  async function downloads(id: string): Promise<number> {
    const { rows } = await su.query(
      "SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'evidence.download_original'",
      [id],
    )
    return rows.length
  }

  test("Given an id that is not a UUID, when requested, then 404", async () => {
    expect(await load(originalLoader, { id: "bukan-uuid" })).toBe(404)
  })

  test("Given an unscanned original, when requested, then 404 and no download logged", async () => {
    const id = await seedFile("image")
    expect(await load(originalLoader, { id })).toBe(404)
    expect(await downloads(id)).toBe(0)
  })

  test("Given a scanned original, when requested, then an attachment and one audit row", async () => {
    const id = await seedFile("image", { scanned: true })
    const response = await load(originalLoader, { id })
    if (typeof response === "number") throw new Error(`status ${response}`)
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    )
    expect(response.headers.get("Content-Disposition")).toStartWith(
      'attachment; filename="foto.jpg"',
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
    expect(await downloads(id)).toBe(1)
  })
})
