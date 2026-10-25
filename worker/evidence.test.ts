import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import sharp from "sharp"
import { schema } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import { reports } from "../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import { derivedPath, originalPath } from "../server/files.server.ts"
import { clamdFromEnv } from "./clamav.ts"
import { createEvidenceHandler } from "./evidence.ts"
import { createVideoHandler } from "./evidence-video.ts"
import {
  eicar,
  heicFixture,
  pdfWithAttachment,
  simplePdf,
  videoFixture,
} from "./fixtures.ts"
import { runTool, withScratch } from "./tools.ts"

const su = superuserPool()
// Runs as sb_media, real grants
const mediaPool = new Pool({
  connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
  max: 2,
  options: "-c role=sb_media",
})
const mediaDb = drizzle({ client: mediaPool, schema })

let filesDir = ""
let orgA = ""
let orgB = ""
let userA = ""

/** IFD0 tag ids in EXIF. */
function ifd0Tags(exif: Buffer): number[] {
  const marker = exif.indexOf("Exif\0\0", 0, "latin1")
  const o = marker >= 0 ? marker + 6 : 0
  const le = exif.toString("latin1", o, o + 2) === "II"
  const u16 = (p: number) => (le ? exif.readUInt16LE(p) : exif.readUInt16BE(p))
  const u32 = (p: number) => (le ? exif.readUInt32LE(p) : exif.readUInt32BE(p))
  const ifd = o + u32(o + 4)
  return Array.from({ length: u16(ifd) }, (_, i) => u16(ifd + 2 + i * 12))
}

const GPS_IFD_POINTER = 0x8825

// 40x20, Orientation 6, GPS EXIF
function gpsJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 40, height: 20, channels: 3, background: "#c00" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: "TestCam" },
      IFD3: {
        GPSLatitudeRef: "S",
        GPSLatitude: "6/1 53/1 2/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "107/1 36/1 0/1",
      },
    })
    .toBuffer()
}

async function addEvidence(
  bytes: Uint8Array,
  detectedType: string,
  attempts = 0,
  kind: "image" | "pdf" | "video" = "image",
): Promise<string> {
  // Five rows per report max
  const [report] = await drizzle({ client: su })
    .insert(reports)
    .values(reportValues(orgA, userA))
    .returning({ id: reports.id })
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
       declared_type, declared_size, status, detected_type, byte_size, sha256,
       attempts, received_at)
     VALUES ($1, $2, $3, $8, 'f', $4, $5, 'received', $4, $5, $6, $7, now())
     RETURNING id`,
    [
      orgA,
      report?.id,
      0,
      detectedType,
      bytes.byteLength,
      createHash("sha256").update(bytes).digest("hex"),
      attempts,
      kind,
    ],
  )
  const id = rows[0]?.id
  if (!id) throw new Error("no evidence row")
  const path = originalPath(filesDir, orgA, id)
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, bytes)
  return id
}

async function row(id: string) {
  const { rows } = await su.query<{ status: string; attempts: number }>(
    "SELECT status, attempts FROM evidence WHERE id = $1",
    [id],
  )
  return rows[0]
}

async function details(id: string) {
  const { rows } = await su.query<{
    status: string
    failure_reason: string | null
    preview_pages: number
    source_pages: number | null
    duration_ms: number | null
    width: number | null
    height: number | null
  }>(
    `SELECT status, failure_reason, preview_pages, source_pages, duration_ms,
       width, height FROM evidence WHERE id = $1`,
    [id],
  )
  return rows[0]
}

const clamd = clamdFromEnv()

async function scanned(id: string) {
  const { rows } = await su.query<{ scanned: boolean }>(
    "SELECT scanned_at IS NOT NULL AS scanned FROM evidence WHERE id = $1",
    [id],
  )
  return rows[0]?.scanned
}

function handler() {
  return createEvidenceHandler({ filesDir, db: mediaDb, clamd })
}

function videoHandler() {
  return createVideoHandler({ filesDir, db: mediaDb })
}

const required = process.env.REQUIRE_MEDIA_TOOLS === "true"
const heifTest = test.skipIf(!Bun.which("heif-enc") && !required)

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "wka")
  orgB = await insertOrg(su, "wkb")
  userA = await insertUser(su, "worker@sadarbersuara.test")
  filesDir = await mkdtemp(join(tmpdir(), "sb-worker-"))
})

afterAll(async () => {
  await resetData(su)
  await su.end()
  await mediaPool.end()
  await rm(filesDir, { recursive: true, force: true })
})

describe("evidence job", () => {
  test("strips EXIF and GPS, applies orientation", async () => {
    const input = await gpsJpeg()
    const before = await sharp(input).metadata()
    // Fixture really carries GPS
    expect(before.exif).toBeDefined()
    expect(ifd0Tags(before.exif as Buffer)).toContain(GPS_IFD_POINTER)
    expect(before.orientation).toBe(6)

    const id = await addEvidence(input, "image/jpeg")
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("ready")

    const out = await Bun.file(derivedPath(filesDir, orgA, id)).bytes()
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe("webp")
    expect([meta.width, meta.height]).toEqual([20, 40])
    expect(meta.exif).toBeUndefined()
    expect(meta.xmp).toBeUndefined()
    expect(meta.icc).toBeUndefined()
    expect(meta.orientation).toBeUndefined()
    expect(Buffer.from(out).includes("TestCam")).toBe(false)
    expect(await row(id)).toEqual({ status: "ready", attempts: 1 })
    // ASVS V5.4.3: every original scanned
    expect(await scanned(id)).toBe(true)
    // Original kept unmodified
    expect(
      Buffer.from(
        await Bun.file(originalPath(filesDir, orgA, id)).bytes(),
      ).equals(input),
    ).toBe(true)
  })

  test("re-running a processed job is a no-op", async () => {
    const id = await addEvidence(await gpsJpeg(), "image/jpeg")
    const run = handler()
    expect(await run({ orgId: orgA, evidenceId: id })).toBe("ready")
    const path = derivedPath(filesDir, orgA, id)
    const first = await stat(path)
    expect(await run({ orgId: orgA, evidenceId: id })).toBe("skipped")
    const second = await stat(path)
    expect(second.ino).toBe(first.ino)
    expect(second.mtimeMs).toBe(first.mtimeMs)
    expect(await row(id)).toEqual({ status: "ready", attempts: 1 })
  })

  test("corrupt file ends in manual review without throwing", async () => {
    const valid = await gpsJpeg()
    const corrupt = valid.subarray(0, Math.floor(valid.length / 2))
    const id = await addEvidence(corrupt, "image/jpeg")
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
    expect(await row(id)).toEqual({
      status: "needs_manual_review",
      attempts: 1,
    })
    expect(await Bun.file(derivedPath(filesDir, orgA, id)).exists()).toBe(false)
  })

  test("non-image bytes end in manual review", async () => {
    const id = await addEvidence(
      new TextEncoder().encode("<svg onload=alert(1)>"),
      "image/png",
    )
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
    expect(await row(id)).toEqual({
      status: "needs_manual_review",
      attempts: 0,
    })
  })

  test("file changed after upload ends in manual review", async () => {
    const id = await addEvidence(await gpsJpeg(), "image/jpeg")
    const other = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#00f" },
    })
      .jpeg()
      .toBuffer()
    await Bun.write(originalPath(filesDir, orgA, id), other)
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
  })

  test("two failed decodes stop further attempts", async () => {
    const id = await addEvidence(await gpsJpeg(), "image/jpeg", 2)
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
    expect(await row(id)).toEqual({
      status: "needs_manual_review",
      attempts: 3,
    })
    expect(await Bun.file(derivedPath(filesDir, orgA, id)).exists()).toBe(false)
  })

  test("a missing or foreign row is skipped", async () => {
    const id = await addEvidence(await gpsJpeg(), "image/jpeg")
    expect(await handler()({ orgId: orgB, evidenceId: id })).toBe("skipped")
    expect(await row(id)).toEqual({ status: "received", attempts: 0 })
  })

  test("missing original throws for retry", async () => {
    const id = await addEvidence(await gpsJpeg(), "image/jpeg")
    await rm(originalPath(filesDir, orgA, id))
    await expect(handler()({ orgId: orgA, evidenceId: id })).rejects.toThrow()
    // Retry keeps decode attempts
    expect(await row(id)).toEqual({ status: "received", attempts: 0 })
  })

  test("PDF pages become previews, never a PDF", async () => {
    const id = await addEvidence(simplePdf(3), "application/pdf", 0, "pdf")
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("ready")
    expect(await details(id)).toMatchObject({
      status: "ready",
      failure_reason: null,
      preview_pages: 3,
      source_pages: 3,
    })
    const names = await readdir(join(filesDir, "derived", orgA, id))
    expect(names.sort()).toEqual(["0.webp", "1.webp", "2.webp"])
    const page = await sharp(
      await Bun.file(derivedPath(filesDir, orgA, id, "2.webp")).bytes(),
    ).metadata()
    expect(page.format).toBe("webp")
  })

  test("EICAR PDF is quarantined before decoding", async () => {
    const id = await addEvidence(
      pdfWithAttachment(eicar()),
      "application/pdf",
      0,
      "pdf",
    )
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("malware")
    expect(await details(id)).toMatchObject({
      status: "rejected_malware",
      failure_reason: "malware",
      preview_pages: 0,
    })
    expect(await row(id)).toMatchObject({ attempts: 0 })
    expect(await Bun.file(derivedPath(filesDir, orgA, id)).exists()).toBe(false)
  })

  test("a PDF that is not a PDF needs review", async () => {
    const fake = new TextEncoder().encode("%PDF-1.4\nnothing here")
    const id = await addEvidence(fake, "application/pdf", 0, "pdf")
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
    expect(await details(id)).toMatchObject({
      status: "needs_manual_review",
      failure_reason: "decode_failed",
    })
    expect(await scanned(id)).toBe(true)
  })

  test("a PDF is scanned before its type check", async () => {
    const id = await addEvidence(simplePdf(1), "application/pdf", 0, "pdf")
    await su.query("UPDATE evidence SET sha256 = 'x' WHERE id = $1", [id])
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
    expect(await details(id)).toMatchObject({
      failure_reason: "sha256_mismatch",
    })
    expect(await scanned(id)).toBe(true)
  })

  test("a scan outage keeps the file unscanned for retry", async () => {
    const id = await addEvidence(simplePdf(1), "application/pdf", 0, "pdf")
    const down = createEvidenceHandler({
      filesDir,
      db: mediaDb,
      clamd: { host: "127.0.0.1", port: 9, timeoutMs: 1000 },
    })
    await expect(down({ orgId: orgA, evidenceId: id })).rejects.toThrow()
    expect(await row(id)).toEqual({ status: "received", attempts: 0 })
    expect(await scanned(id)).toBe(false)
  })

  test("a row kind must match the bytes", async () => {
    const id = await addEvidence(simplePdf(1), "application/pdf", 0, "image")
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
    expect(await details(id)).toMatchObject({
      failure_reason: "unsupported_type",
    })
    // Disguised PDF, scanned anyway
    expect(await scanned(id)).toBe(true)
  })

  test("an infected image is quarantined before decoding", async () => {
    const id = await addEvidence(eicar(), "image/jpeg")
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("malware")
    expect(await details(id)).toMatchObject({
      status: "rejected_malware",
      failure_reason: "malware",
    })
    expect(await row(id)).toMatchObject({ attempts: 0 })
  })

  test("an image scan outage retries, unscanned", async () => {
    const id = await addEvidence(await gpsJpeg(), "image/jpeg")
    const down = createEvidenceHandler({
      filesDir,
      db: mediaDb,
      clamd: { host: "127.0.0.1", port: 9, timeoutMs: 1000 },
    })
    await expect(down({ orgId: orgA, evidenceId: id })).rejects.toThrow()
    expect(await row(id)).toEqual({ status: "received", attempts: 0 })
  })

  test("a disguised infected file is quarantined", async () => {
    const id = await addEvidence(
      pdfWithAttachment(eicar()),
      "application/pdf",
      0,
      "image",
    )
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("malware")
    expect(await details(id)).toMatchObject({ status: "rejected_malware" })
  })

  heifTest("HEIC decodes through heif-dec", async () => {
    const id = await addEvidence(await heicFixture(), "image/heic")
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("ready")
    const meta = await sharp(
      await Bun.file(derivedPath(filesDir, orgA, id)).bytes(),
    ).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 320, 200])
    expect(await details(id)).toMatchObject({ preview_pages: 1 })
  })

  heifTest("HEIC above the pixel cap needs review", async () => {
    const id = await addEvidence(await heicFixture(), "image/heic")
    const capped = createEvidenceHandler({
      filesDir,
      db: mediaDb,
      clamd,
      heifMaxPixels: 1000,
    })
    expect(await capped({ orgId: orgA, evidenceId: id })).toBe("manual_review")
    expect(await details(id)).toMatchObject({
      failure_reason: "image_too_large",
    })
  })

  test("progressive or interlaced above the cap needs review", async () => {
    const pixels = { width: 120, height: 100, channels: 3 as const }
    const background = { r: 200, g: 40, b: 40 }
    const capped = createEvidenceHandler({
      filesDir,
      db: mediaDb,
      clamd,
      progressiveMaxPixels: 10_000,
    })
    const cases: [Uint8Array, string, string][] = [
      [
        await sharp({ create: { ...pixels, background } })
          .jpeg({ progressive: true })
          .toBuffer(),
        "image/jpeg",
        "manual_review",
      ],
      [
        await sharp({ create: { ...pixels, background } })
          .png({ progressive: true })
          .toBuffer(),
        "image/png",
        "manual_review",
      ],
      // Baseline shrinks on load
      [
        await sharp({ create: { ...pixels, background } })
          .jpeg()
          .toBuffer(),
        "image/jpeg",
        "ready",
      ],
    ]
    for (const [bytes, type, outcome] of cases) {
      const id = await addEvidence(bytes, type)
      expect([type, await capped({ orgId: orgA, evidenceId: id })]).toEqual([
        type,
        outcome,
      ])
      if (outcome === "manual_review") {
        expect(await details(id)).toMatchObject({
          failure_reason: "image_too_large",
        })
      }
    }
  })

  heifTest("HEIC with several images needs review", async () => {
    const id = await addEvidence(await heicFixture(2), "image/heic")
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
    expect(await details(id)).toMatchObject({ failure_reason: "multi_image" })
  })

  test("video rows are left to their queue", async () => {
    const video = await videoFixture({ width: 64, height: 64, seconds: 1 })
    const id = await addEvidence(video, "video/mp4", 0, "video")
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("skipped")
    expect(await row(id)).toEqual({ status: "received", attempts: 0 })
  })
})

describe("evidence-video job", () => {
  test("transcodes to 720p with a poster", async () => {
    const video = await videoFixture({ width: 1920, height: 1080, seconds: 2 })
    const id = await addEvidence(video, "video/mp4", 0, "video")
    expect(await videoHandler()({ orgId: orgA, evidenceId: id })).toBe("ready")
    expect(await details(id)).toMatchObject({
      status: "ready",
      preview_pages: 1,
      duration_ms: 2000,
      width: 1920,
      height: 1080,
    })
    const names = await readdir(join(filesDir, "derived", orgA, id))
    expect(names.sort()).toEqual(["0.webp", "video.mp4"])
    const poster = await sharp(
      await Bun.file(derivedPath(filesDir, orgA, id)).bytes(),
    ).metadata()
    expect([poster.width, poster.height]).toEqual([1280, 720])
    expect(await scanned(id)).toBe(true)
  })

  test("an infected video is quarantined before probing", async () => {
    const id = await addEvidence(eicar(), "video/mp4", 0, "video")
    expect(await videoHandler()({ orgId: orgA, evidenceId: id })).toBe(
      "malware",
    )
    expect(await details(id)).toMatchObject({ status: "rejected_malware" })
    expect(await row(id)).toMatchObject({ attempts: 0 })
  })

  test("over 3 minutes is rejected, never transcoded", async () => {
    const video = await videoFixture({ width: 64, height: 64, seconds: 181 })
    const id = await addEvidence(video, "video/mp4", 0, "video")
    expect(await videoHandler()({ orgId: orgA, evidenceId: id })).toBe(
      "rejected",
    )
    expect(await details(id)).toMatchObject({
      status: "rejected_limits",
      failure_reason: "video_too_long",
    })
    expect(
      await Bun.file(derivedPath(filesDir, orgA, id, "video.mp4")).exists(),
    ).toBe(false)
    // 181 s fixture takes seconds
  }, 30_000)

  test("above 1080p is rejected", async () => {
    const video = await videoFixture({ width: 2560, height: 1080, seconds: 1 })
    const id = await addEvidence(video, "video/mp4", 0, "video")
    expect(await videoHandler()({ orgId: orgA, evidenceId: id })).toBe(
      "rejected",
    )
    expect(await details(id)).toMatchObject({
      status: "rejected_limits",
      failure_reason: "video_resolution",
    })
  })

  test("a playlist named MP4 needs review", async () => {
    const playlist = new TextEncoder().encode(
      "#EXTM3U\n#EXTINF:10.0,\nhttp://127.0.0.1:9/x.ts\n#EXT-X-ENDLIST\n",
    )
    const id = await addEvidence(playlist, "video/mp4", 0, "video")
    expect(await videoHandler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
  })

  test("Given a voice recording saved as MP4, when it is processed, then it needs review as no video", async () => {
    const audio = await withScratch(async (dir) => {
      const out = join(dir, "suara.mp4")
      const run = await runTool(
        [
          "ffmpeg",
          ...["-v", "error", "-nostdin", "-y", "-f", "lavfi"],
          ...["-i", "sine=duration=1", "-c:a", "aac", "-f", "mp4", out],
        ],
        { timeoutMs: 30_000 },
      )
      if (run.exitCode !== 0) throw new Error(run.stderr)
      return Bun.file(out).bytes()
    })
    const id = await addEvidence(audio, "video/mp4", 0, "video")
    expect(await videoHandler()({ orgId: orgA, evidenceId: id })).toBe(
      "manual_review",
    )
    expect(await details(id)).toMatchObject({
      status: "needs_manual_review",
      failure_reason: "no_video_stream",
    })
  })

  test("a missing or foreign row is skipped", async () => {
    const video = await videoFixture({ width: 64, height: 64, seconds: 1 })
    const id = await addEvidence(video, "video/mp4", 0, "video")
    expect(await videoHandler()({ orgId: orgB, evidenceId: id })).toBe(
      "skipped",
    )
  })
})

describe("no leftovers", () => {
  test("leaves no temp files", async () => {
    const names = await readdir(join(filesDir, "derived", orgA), {
      recursive: true,
    })
    expect(names.filter((name) => name.includes(".tmp-"))).toEqual([])
  })
})
