import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import sharp from "sharp"
import { BOX_SCALE, type RedactionBox } from "../shared/evidence.ts"
import { censorImage } from "./censor.ts"
import { heicFixture, pngFixture, simplePdf, videoFixture } from "./fixtures.ts"
import { decodeHeif, MultiImage } from "./heic.ts"
import { PdfUnreadable, rasterizePdf } from "./pdf.ts"
import { withScratch } from "./tools.ts"
import { probeVideo, transcodeVideo } from "./video.ts"

// Container runs set REQUIRE_MEDIA_TOOLS
const required = process.env.REQUIRE_MEDIA_TOOLS === "true"
const hasHeif = Boolean(Bun.which("heif-dec") && Bun.which("heif-enc"))
const heifTest = test.skipIf(!hasHeif && !required)

describe("HEIC decode", () => {
  heifTest("sharp prebuilt cannot read HEVC", async () => {
    const heic = await heicFixture()
    await expect(sharp(heic).toBuffer()).rejects.toThrow()
  })

  heifTest("heif-dec gives a PNG sharp reads", async () => {
    const png = await decodeHeif(await heicFixture(), { timeoutMs: 60_000 })
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe("png")
    expect([meta.width, meta.height]).toEqual([320, 200])
  })

  heifTest("several top-level images are refused", async () => {
    await expect(
      decodeHeif(await heicFixture(2), { timeoutMs: 60_000 }),
    ).rejects.toBeInstanceOf(MultiImage)
  })

  heifTest("garbage is a decode failure", async () => {
    await expect(
      decodeHeif(new TextEncoder().encode("not heic"), { timeoutMs: 10_000 }),
    ).rejects.toThrow()
  })
})

describe("PDF rasterize", () => {
  test("one image per page at 150 DPI", async () => {
    const out = await rasterizePdf(simplePdf(3), { timeoutMs: 60_000 })
    expect(out.sourcePages).toBe(3)
    expect(out.pages).toHaveLength(3)
    const meta = await sharp(out.pages[0]).metadata()
    // 612x792 pt at 150 DPI
    expect([meta.width, meta.height]).toEqual([1275, 1650])
  })

  test("first 10 pages only", async () => {
    const out = await rasterizePdf(simplePdf(12), { timeoutMs: 60_000 })
    expect(out.sourcePages).toBe(12)
    expect(out.pages).toHaveLength(10)
  })

  test("huge pages are capped at 2560 px", async () => {
    const out = await rasterizePdf(simplePdf(1, [14_400, 7_200]), {
      timeoutMs: 60_000,
    })
    const meta = await sharp(out.pages[0]).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(
      2560,
    )
  })

  test("broken PDF is unreadable", async () => {
    await expect(
      rasterizePdf(new TextEncoder().encode("%PDF-1.4 broken"), {
        timeoutMs: 10_000,
      }),
    ).rejects.toBeInstanceOf(PdfUnreadable)
  })
})

describe("video", () => {
  test("probe reads duration and size", async () => {
    await withScratch(async (dir) => {
      const path = join(dir, "v")
      await Bun.write(
        path,
        await videoFixture({ width: 640, height: 360, seconds: 2 }),
      )
      const probe = await probeVideo(path, "mov", { timeoutMs: 30_000 })
      expect(probe).toEqual({ durationSeconds: 2, width: 640, height: 360 })
    })
  })

  test("transcode caps short side at 720 and strips tags", async () => {
    await withScratch(async (dir) => {
      const path = join(dir, "v")
      await Bun.write(
        path,
        await videoFixture({ width: 1920, height: 1080, seconds: 1 }),
      )
      const out = await transcodeVideo(path, "mov", dir, { timeoutMs: 120_000 })
      const probe = await probeVideo(out.video, "mov", { timeoutMs: 30_000 })
      expect(probe?.height).toBe(720)
      expect(probe?.width).toBe(1280)
      const bytes = Buffer.from(await Bun.file(out.video).arrayBuffer())
      expect(bytes.includes("RAHASIA-PELAPOR")).toBe(false)
      expect(bytes.includes("107.6107")).toBe(false)
      // Buffer, file loaders blocked
      const poster = await sharp(await Bun.file(out.poster).bytes()).metadata()
      expect([poster.width, poster.height]).toEqual([1280, 720])
    })
  })

  test("rotated portrait keeps its orientation", async () => {
    await withScratch(async (dir) => {
      const path = join(dir, "v")
      await Bun.write(
        path,
        await videoFixture({
          width: 1280,
          height: 720,
          seconds: 1,
          rotate: 90,
        }),
      )
      const out = await transcodeVideo(path, "mov", dir, { timeoutMs: 120_000 })
      const probe = await probeVideo(out.video, "mov", { timeoutMs: 30_000 })
      expect([probe?.width, probe?.height]).toEqual([720, 1280])
    })
  })

  test("webm uses the matroska demuxer", async () => {
    await withScratch(async (dir) => {
      const path = join(dir, "v")
      await Bun.write(
        path,
        await videoFixture({
          width: 320,
          height: 240,
          seconds: 1,
          container: "webm",
        }),
      )
      expect(await probeVideo(path, "mov", { timeoutMs: 30_000 })).toBeNull()
      const probe = await probeVideo(path, "matroska", { timeoutMs: 30_000 })
      expect(probe?.width).toBe(320)
    })
  })

  test("a playlist pretending to be MP4 reads no network", async () => {
    await withScratch(async (dir) => {
      const path = join(dir, "v")
      await Bun.write(
        path,
        "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10.0,\nhttp://127.0.0.1:9/x.ts\n#EXT-X-ENDLIST\n",
      )
      expect(await probeVideo(path, "mov", { timeoutMs: 10_000 })).toBeNull()
    })
  })
})

const box = (over: Partial<RedactionBox>): RedactionBox => ({
  page: 0,
  x: 0,
  y: 0,
  w: BOX_SCALE / 2,
  h: BOX_SCALE / 2,
  style: "fill",
  ...over,
})

async function pixels(image: Buffer) {
  const { data, info } = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
  }
  return { at, width: info.width, height: info.height }
}

// Red block covers top-left quarter
const isRed = ([r, g, b]: number[]) =>
  (r ?? 0) > 150 && (g ?? 0) < 90 && (b ?? 0) < 90

describe("censor boxes", () => {
  test("fill hides every pixel in the box", async () => {
    const input = await sharp(await pngFixture(200, 120))
      .webp()
      .toBuffer()
    const out = await censorImage(input, [box({})])
    const img = await pixels(out.buffer)
    expect([img.width, img.height]).toEqual([200, 120])
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 100; x++) {
        // Lossy edges blend outside only
        expect(isRed(img.at(x, y))).toBe(false)
        if (x > 2 && x < 97 && y > 2 && y < 57) {
          const [r = 0, g = 0, b = 0] = img.at(x, y)
          expect(Math.max(r, g, b)).toBeLessThanOrEqual(6)
        }
      }
    }
    // Outside the box untouched
    expect(isRed(img.at(10, 70))).toBe(false)
    const [, , blue = 0] = img.at(150, 100)
    expect(blue).toBeGreaterThan(150)
  })

  test("mosaic leaves no fine detail", async () => {
    // Noise has detail to destroy
    const noise = await sharp({
      create: {
        width: 192,
        height: 192,
        channels: 3,
        background: "#000",
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer()
    const out = await censorImage(noise, [
      box({ w: BOX_SCALE, h: BOX_SCALE, style: "pixelate" }),
    ])
    const coarse = (bytes: Buffer) => {
      const seen = new Set<string>()
      for (let i = 0; i + 2 < bytes.length; i += 3) {
        const [r = 0, g = 0, b = 0] = bytes.subarray(i, i + 3)
        seen.add(`${r >> 3},${g >> 3},${b >> 3}`)
      }
      return seen
    }
    const distinct = coarse(await sharp(out.buffer).raw().toBuffer())
    // Six blocks, lossy slack
    expect(distinct.size).toBeLessThan(400)
    const before = coarse(await sharp(noise).raw().toBuffer())
    expect(before.size).toBeGreaterThan(5000)
  })

  test("output carries no metadata", async () => {
    const input = await sharp(await pngFixture(40, 40))
      .withExifMerge({ IFD0: { Make: "TestCam" } })
      .webp()
      .toBuffer()
    const out = await censorImage(input, [])
    const meta = await sharp(out.buffer).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.format).toBe("webp")
  })
})
