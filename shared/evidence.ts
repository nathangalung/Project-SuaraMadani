// Evidence types, limits, censor decisions
import {
  type EvidenceKind,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_SHORT_SIDE,
  type ReportErrorKey,
} from "./report-fields.ts"

// Sniffed by file-type, item 18
const KIND_BY_DETECTED = new Map<string, EvidenceKind>([
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
  ["image/heic", "image"],
  ["image/heif", "image"],
  ["application/pdf", "pdf"],
  ["video/mp4", "video"],
  ["video/quicktime", "video"],
  ["video/webm", "video"],
])

const HEIF_TYPES = new Set(["image/heic", "image/heif"])

// ffmpeg demuxer names, never probed
const DEMUXER: Record<string, string> = {
  "video/mp4": "mov",
  "video/quicktime": "mov",
  "video/webm": "matroska",
}

// 1920x1080 in either orientation
const MAX_VIDEO_LONG_SIDE = 1920

// Upload window after submit, ADR-05
export const UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000
// No late files here
export const UPLOAD_CLOSED: readonly string[] = ["forwarded", "rejected"]

export function detectedKind(mime: string): EvidenceKind | undefined {
  return KIND_BY_DETECTED.get(mime)
}

export function needsHeifDecoder(mime: string): boolean {
  return HEIF_TYPES.has(mime)
}

export function evidenceQueue(
  kind: EvidenceKind,
): "evidence" | "evidence-video" {
  return kind === "video" ? "evidence-video" : "evidence"
}

export function videoDemuxer(mime: string): string | undefined {
  return DEMUXER[mime]
}

type VideoMeta = { width?: number; height?: number; durationSeconds?: number }

/** Item 9, browser and worker. */
export function videoLimitError(meta: VideoMeta): ReportErrorKey | null {
  if ((meta.durationSeconds ?? 0) > MAX_VIDEO_SECONDS) {
    return "error_video_too_long"
  }
  const sides = [meta.width ?? 0, meta.height ?? 0]
  if (
    Math.max(...sides) > MAX_VIDEO_LONG_SIDE ||
    Math.min(...sides) > MAX_VIDEO_SHORT_SIDE
  ) {
    return "error_video_resolution"
  }
  return null
}

// Box units: 1/10000 of side
export const BOX_SCALE = 10_000
export const MAX_BOXES = 100
export const MIN_BOX = 10

export const REDACTION_STYLES = ["fill", "pixelate"] as const
export type RedactionStyle = (typeof REDACTION_STYLES)[number]

export const EVIDENCE_DECISIONS = [
  "redact",
  "no_redaction",
  "withhold",
] as const
export type EvidenceDecision = (typeof EVIDENCE_DECISIONS)[number]

export type RedactionBox = {
  page: number
  x: number
  y: number
  w: number
  h: number
  style: RedactionStyle
}

type Size = { width: number; height: number }
type Rect = { x: number; y: number; w: number; h: number }

/** Rounds outward, covers fully. */
export function boxToPixels(box: Rect, size: Size) {
  const left = Math.floor((box.x * size.width) / BOX_SCALE)
  const top = Math.floor((box.y * size.height) / BOX_SCALE)
  const right = Math.min(
    size.width,
    Math.max(left + 1, Math.ceil(((box.x + box.w) * size.width) / BOX_SCALE)),
  )
  const bottom = Math.min(
    size.height,
    Math.max(top + 1, Math.ceil(((box.y + box.h) * size.height) / BOX_SCALE)),
  )
  return { left, top, width: right - left, height: bottom - top }
}

/** At most six blocks across. */
export function pixelBlock(region: Size): number {
  return Math.max(16, Math.ceil(Math.min(region.width, region.height) / 6))
}

// Permanent failures shown to admins
export const EVIDENCE_FAILURES = [
  "sha256_mismatch",
  "unsupported_type",
  "decode_failed",
  "attempts_exhausted",
  "multi_image",
  "malware",
  "video_too_long",
  "video_resolution",
  "no_video_stream",
  "timeout",
  "image_too_large",
] as const
export type EvidenceFailure = (typeof EVIDENCE_FAILURES)[number]

export type MediaStore = "local" | "r2"

// Written only by evidence-publish
export type PublicMedia =
  | {
      type: "image"
      file: string
      page: number
      width: number
      height: number
    }
  | {
      type: "video"
      file: string
      poster: string
      store: MediaStore
      width: number
      height: number
    }

export type PublicFile = { file: string; store: MediaStore }

/** Every public copy, one row. */
export function publicFiles(
  media: readonly PublicMedia[] | null,
): PublicFile[] {
  return (media ?? []).flatMap((one): PublicFile[] =>
    one.type === "image"
      ? [{ file: one.file, store: "local" }]
      : [
          { file: one.poster, store: "local" },
          { file: one.file, store: one.store },
        ],
  )
}
