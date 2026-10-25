import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { schema } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import { insertOrg, resetData, superuserPool, testUrl } from "../db/testing.ts"
import { writeAtomic } from "../server/atomic-file.server.ts"
import { briefPath, cleanBriefPath } from "../server/files.server.ts"
import { clamdFromEnv } from "./clamav.ts"
import { createBriefScanHandler } from "./evidence-brief.ts"
import {
  eicar,
  pdfWithAttachment,
  pdfWithMetadata,
  simplePdf,
} from "./fixtures.ts"
import { stripPdfMetadata } from "./pdf.ts"

// Container runs set REQUIRE_MEDIA_TOOLS
const required = process.env.REQUIRE_MEDIA_TOOLS === "true"
const qpdfTest = test.skipIf(!Bun.which("qpdf") && !required)
const STRIPPED = new TextEncoder().encode("%PDF-1.4 stripped")

const su = superuserPool()
// Runs as sb_media, real grants
const mediaPool = new Pool({
  connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
  max: 2,
  options: "-c role=sb_media",
})
const mediaDb = drizzle({ client: mediaPool, schema })
const clamd = clamdFromEnv()
let filesDir = ""
let orgId = ""
let itemId = ""

async function brief(bytes: Uint8Array): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO policy_briefs (org_id, item_id, sha256, byte_size)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      orgId,
      itemId,
      createHash("sha256").update(bytes).digest("hex"),
      bytes.byteLength,
    ],
  )
  const id = rows[0]?.id ?? ""
  await writeAtomic(briefPath(filesDir, orgId, id), bytes)
  return id
}

async function statusOf(id: string) {
  const { rows } = await su.query<{ status: string; scanned: boolean }>(
    "SELECT status, scanned_at IS NOT NULL AS scanned FROM policy_briefs WHERE id = $1",
    [id],
  )
  return rows[0]
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  orgId = await insertOrg(su, "brf")
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO demands (org_id, year, number, public_code, scope, title, body,
       summary, target, raised_on)
     VALUES ($1, 2026, 1, 'TUN-BRF-26-0001', 'national', 'Judul tuntutan',
       'Teks tuntutan.', 'Ringkasan.', 'Kementerian', '2026-09-01')
     RETURNING id`,
    [orgId],
  )
  const items = await su.query<{ id: string }>(
    `INSERT INTO demand_items (org_id, demand_id, position, body)
     VALUES ($1, $2, 0, 'Sub-tuntutan pertama') RETURNING id`,
    [orgId, rows[0]?.id],
  )
  itemId = items.rows[0]?.id ?? ""
  filesDir = await mkdtemp(join(tmpdir(), "sb-brief-scan-"))
})

beforeEach(async () => {
  await su.query("DELETE FROM policy_briefs")
})

afterAll(async () => {
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await mediaPool.end()
  await su.end()
})

describe("evidence-brief", () => {
  const handler = (
    strip = async (_: Uint8Array): Promise<Uint8Array | null> => STRIPPED,
  ) => createBriefScanHandler({ filesDir, db: mediaDb, clamd, strip })
  const read = (path: string) =>
    Bun.file(path)
      .bytes()
      .catch(() => null)

  test("a clean PDF is marked clean", async () => {
    const id = await brief(simplePdf(2))
    expect(await handler()({ orgId, briefId: id })).toBe("clean")
    expect(await statusOf(id)).toEqual({ status: "clean", scanned: true })
  })

  test("the public copy is the stripped one", async () => {
    const original = simplePdf(1)
    const id = await brief(original)
    await handler()({ orgId, briefId: id })
    expect(await read(cleanBriefPath(filesDir, orgId, id))).toEqual(STRIPPED)
    const kept = await read(briefPath(filesDir, orgId, id))
    expect(Buffer.from(kept ?? [])).toEqual(Buffer.from(original))
  })

  test("a PDF qpdf cannot read is refused", async () => {
    const id = await brief(simplePdf(1))
    expect(await handler(async () => null)({ orgId, briefId: id })).toBe(
      "infected",
    )
    expect(await read(cleanBriefPath(filesDir, orgId, id))).toBeNull()
  })

  test("a deleted brief loses its public copy", async () => {
    const id = await brief(simplePdf(1))
    await handler()({ orgId, briefId: id })
    await su.query("DELETE FROM policy_briefs WHERE id = $1", [id])
    expect(await handler()({ orgId, briefId: id })).toBe("removed")
    expect(await read(cleanBriefPath(filesDir, orgId, id))).toBeNull()
  })

  qpdfTest("qpdf drops the author from Info and XMP", async () => {
    const author = "Nama Admin Asli"
    const source = pdfWithMetadata(author)
    expect(Buffer.from(source).includes(author)).toBe(true)
    const out = await stripPdfMetadata(source, { timeoutMs: 30_000 })
    if (!out) throw new Error("qpdf refused")
    const text = Buffer.from(out).toString("latin1")
    expect(text.startsWith("%PDF-")).toBe(true)
    expect(text).not.toContain(author)
    expect(text).not.toContain("Microsoft Word")
    expect(
      await stripPdfMetadata(new TextEncoder().encode("%PDF-rusak"), {
        timeoutMs: 30_000,
      }),
    ).toBeNull()
  })

  qpdfTest(
    "Given the worker's own qpdf, when a brief is scanned, then the public copy names no author",
    async () => {
      const author = "Nama Admin Asli"
      const id = await brief(pdfWithMetadata(author))
      const real = createBriefScanHandler({ filesDir, db: mediaDb, clamd })
      expect(await real({ orgId, briefId: id })).toBe("clean")
      const copy = await read(cleanBriefPath(filesDir, orgId, id))
      expect(Buffer.from(copy ?? []).toString("latin1")).toStartWith("%PDF-")
      expect(Buffer.from(copy ?? []).includes(author)).toBe(false)
      const kept = await read(briefPath(filesDir, orgId, id))
      expect(Buffer.from(kept ?? []).includes(author)).toBe(true)
    },
  )

  test("EICAR inside a PDF is marked infected", async () => {
    const id = await brief(pdfWithAttachment(eicar()))
    expect(await handler()({ orgId, briefId: id })).toBe("infected")
    expect(await statusOf(id)).toEqual({ status: "infected", scanned: true })
  })

  test("a scanned brief is skipped on redrive", async () => {
    const id = await brief(simplePdf(1))
    await handler()({ orgId, briefId: id })
    expect(await handler()({ orgId, briefId: id })).toBe("skipped")
  })

  test("a changed file throws for the DLQ", async () => {
    const id = await brief(simplePdf(1))
    await writeAtomic(briefPath(filesDir, orgId, id), simplePdf(3))
    await expect(handler()({ orgId, briefId: id })).rejects.toThrow("sha256")
    expect((await statusOf(id))?.status).toBe("pending")
  })

  test("clamd down throws, row stays pending", async () => {
    const id = await brief(simplePdf(1))
    const down = createBriefScanHandler({
      filesDir,
      db: mediaDb,
      clamd: { host: "127.0.0.1", port: 9, timeoutMs: 1000 },
    })
    await expect(down({ orgId, briefId: id })).rejects.toThrow()
    expect((await statusOf(id))?.status).toBe("pending")
  })
})
