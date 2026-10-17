import { describe, expect, test } from "bun:test"
import {
  BOX_SCALE,
  boxToPixels,
  detectedKind,
  evidenceQueue,
  needsHeifDecoder,
  pixelBlock,
  publicFiles,
  videoDemuxer,
  videoLimitError,
} from "./evidence.ts"
import { parseDecision } from "./evidence-decision.ts"

describe("detected types", () => {
  test("maps sniffed types to kinds", () => {
    expect(detectedKind("image/jpeg")).toBe("image")
    expect(detectedKind("image/heic")).toBe("image")
    expect(detectedKind("image/heif")).toBe("image")
    expect(detectedKind("application/pdf")).toBe("pdf")
    expect(detectedKind("video/mp4")).toBe("video")
    expect(detectedKind("video/quicktime")).toBe("video")
    expect(detectedKind("video/webm")).toBe("video")
  })

  test("refuses sequences and unknown types", () => {
    expect(detectedKind("image/heic-sequence")).toBeUndefined()
    expect(detectedKind("image/heif-sequence")).toBeUndefined()
    expect(detectedKind("image/svg+xml")).toBeUndefined()
    expect(detectedKind("image/avif")).toBeUndefined()
    expect(detectedKind("video/x-matroska")).toBeUndefined()
    expect(detectedKind("text/html")).toBeUndefined()
  })

  test("HEIC goes through heif-dec", () => {
    expect(needsHeifDecoder("image/heic")).toBe(true)
    expect(needsHeifDecoder("image/heif")).toBe(true)
    expect(needsHeifDecoder("image/jpeg")).toBe(false)
  })

  test("video gets its own queue", () => {
    expect(evidenceQueue("image")).toBe("evidence")
    expect(evidenceQueue("pdf")).toBe("evidence")
    expect(evidenceQueue("video")).toBe("evidence-video")
  })

  test("demuxer is forced from magic bytes", () => {
    expect(videoDemuxer("video/mp4")).toBe("mov")
    expect(videoDemuxer("video/quicktime")).toBe("mov")
    expect(videoDemuxer("video/webm")).toBe("matroska")
    expect(videoDemuxer("image/jpeg")).toBeUndefined()
  })
})

describe("video limits", () => {
  test("3 minutes and 1080p in either orientation", () => {
    const ok = { width: 1920, height: 1080, durationSeconds: 180 }
    expect(videoLimitError(ok)).toBeNull()
    expect(videoLimitError({ ...ok, width: 1080, height: 1920 })).toBeNull()
    expect(videoLimitError({ ...ok, durationSeconds: 180.5 })).toBe(
      "error_video_too_long",
    )
    expect(videoLimitError({ ...ok, width: 2560, height: 1080 })).toBe(
      "error_video_resolution",
    )
    expect(videoLimitError({ ...ok, width: 1440, height: 1440 })).toBe(
      "error_video_resolution",
    )
    expect(videoLimitError({ ...ok, width: 1080, height: 2400 })).toBe(
      "error_video_resolution",
    )
  })

  test("unknown browser metadata passes", () => {
    expect(videoLimitError({})).toBeNull()
  })
})

const box = (over: Partial<Record<string, unknown>> = {}) => ({
  page: 0,
  x: 1000,
  y: 1000,
  w: 2000,
  h: 1500,
  style: "fill" as const,
  ...over,
})

describe("admin decision", () => {
  test("photo redaction needs boxes", () => {
    expect(
      parseDecision({ kind: "image", pages: 1 }, { decision: "redact" }),
    ).toEqual({ ok: false, error: "boxes_required" })
    const parsed = parseDecision(
      { kind: "image", pages: 1 },
      { decision: "redact", boxes: [box()] },
    )
    expect(parsed).toEqual({
      ok: true,
      value: { decision: "redact", boxes: [box()], pages: [0] },
    })
  })

  test("no redaction carries no boxes", () => {
    expect(
      parseDecision(
        { kind: "image", pages: 1 },
        { decision: "no_redaction", boxes: [box()] },
      ),
    ).toEqual({ ok: false, error: "boxes_not_allowed" })
    expect(
      parseDecision({ kind: "image", pages: 1 }, { decision: "no_redaction" }),
    ).toEqual({
      ok: true,
      value: { decision: "no_redaction", boxes: [], pages: [0] },
    })
  })

  test("video has no box editor", () => {
    expect(
      parseDecision(
        { kind: "video", pages: 0 },
        { decision: "redact", boxes: [box()] },
      ),
    ).toEqual({ ok: false, error: "video_no_boxes" })
    expect(
      parseDecision({ kind: "video", pages: 0 }, { decision: "no_redaction" }),
    ).toEqual({
      ok: true,
      value: { decision: "no_redaction", boxes: [], pages: [] },
    })
    expect(
      parseDecision({ kind: "video", pages: 0 }, { decision: "withhold" }),
    ).toEqual({
      ok: true,
      value: { decision: "withhold", boxes: [], pages: [] },
    })
  })

  test("PDF picks pages, all by default", () => {
    expect(
      parseDecision({ kind: "pdf", pages: 3 }, { decision: "no_redaction" }),
    ).toEqual({
      ok: true,
      value: { decision: "no_redaction", boxes: [], pages: [0, 1, 2] },
    })
    expect(
      parseDecision(
        { kind: "pdf", pages: 3 },
        { decision: "redact", pages: [2, 0, 2], boxes: [box({ page: 2 })] },
      ),
    ).toEqual({
      ok: true,
      value: {
        decision: "redact",
        boxes: [box({ page: 2 })],
        pages: [0, 2],
      },
    })
    expect(
      parseDecision(
        { kind: "pdf", pages: 3 },
        { decision: "no_redaction", pages: [] },
      ),
    ).toEqual({ ok: false, error: "pages_required" })
    expect(
      parseDecision(
        { kind: "pdf", pages: 3 },
        { decision: "no_redaction", pages: [3] },
      ),
    ).toEqual({ ok: false, error: "invalid" })
  })

  test("a box on an unpublished page is refused", () => {
    expect(
      parseDecision(
        { kind: "pdf", pages: 3 },
        { decision: "redact", pages: [0], boxes: [box({ page: 1 })] },
      ),
    ).toEqual({ ok: false, error: "invalid" })
  })

  test("boxes stay inside the image", () => {
    const bad = [
      box({ x: -1 }),
      box({ x: 9000, w: 1001 }),
      box({ y: 9500, h: 600 }),
      box({ w: 0 }),
      box({ style: "blur" }),
      box({ x: 1.5 }),
    ]
    for (const b of bad) {
      expect(
        parseDecision(
          { kind: "image", pages: 1 },
          { decision: "redact", boxes: [b] },
        ).ok,
      ).toBe(false)
    }
  })

  test("caps boxes per decision", () => {
    const boxes = Array.from({ length: 101 }, () => box())
    expect(
      parseDecision({ kind: "image", pages: 1 }, { decision: "redact", boxes })
        .ok,
    ).toBe(false)
  })

  test("unknown decision is refused", () => {
    expect(
      parseDecision({ kind: "image", pages: 1 }, { decision: "publish" }).ok,
    ).toBe(false)
  })
})

describe("box pixels", () => {
  test("rounds outward, never under-covers", () => {
    expect(
      boxToPixels({ x: 1, y: 1, w: 1, h: 1 }, { width: 333, height: 333 }),
    ).toEqual({ left: 0, top: 0, width: 1, height: 1 })
    expect(
      boxToPixels(
        { x: 2500, y: 5000, w: 5000, h: 2500 },
        { width: 1001, height: 400 },
      ),
    ).toEqual({ left: 250, top: 200, width: 501, height: 100 })
  })

  test("full box covers the image", () => {
    expect(
      boxToPixels(
        { x: 0, y: 0, w: BOX_SCALE, h: BOX_SCALE },
        { width: 640, height: 480 },
      ),
    ).toEqual({ left: 0, top: 0, width: 640, height: 480 })
  })

  test("mosaic blocks are coarse", () => {
    expect(pixelBlock({ width: 40, height: 40 })).toBe(16)
    expect(pixelBlock({ width: 600, height: 300 })).toBe(50)
  })
})

describe("public files", () => {
  test("lists every copy with its store", () => {
    expect(publicFiles(null)).toEqual([])
    expect(
      publicFiles([
        { type: "image", file: "a.webp", page: 0, width: 1, height: 1 },
        {
          type: "video",
          file: "b.mp4",
          poster: "c.webp",
          store: "r2",
          width: 1,
          height: 1,
        },
      ]),
    ).toEqual([
      { file: "a.webp", store: "local" },
      { file: "c.webp", store: "local" },
      { file: "b.mp4", store: "r2" },
    ])
  })
})
