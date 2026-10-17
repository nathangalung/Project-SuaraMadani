import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { fileTypeFromBuffer } from "file-type"
import sharp from "sharp"
import type { Db } from "../db/client.server.ts"
import { type EvidenceStatus, evidence } from "../db/schema/reports.ts"
import { withTenant } from "../db/tenant.server.ts"
import { writeLog } from "../server/log.ts"
import { detectedKind, type EvidenceFailure } from "../shared/evidence.ts"
import {
  EVIDENCE_LIMITS,
  type EvidenceKind,
  MAX_FULL_DECODE_PIXELS,
} from "../shared/report-fields.ts"
import { type ClamdConfig, scanBytes } from "./clamav.ts"

// Shared by evidence media jobs

// sharp default, Question 8
const PIXEL_LIMIT = 268_402_689
const PREVIEW_MAX_PX = 2560
export const MAX_DECODES = 2
const SNIFF_BYTES = 4100
export const DECODE_TIMEOUT_S = 120

// Loaders: JPEG, PNG, WebP buffers
sharp.block({ operation: ["VipsForeignLoad"] })
sharp.unblock({
  operation: [
    "VipsForeignLoadJpegBuffer",
    "VipsForeignLoadPngBuffer",
    "VipsForeignLoadWebpBuffer",
  ],
})
sharp.concurrency(1)
sharp.cache(false)

export type EvidenceDeps = { filesDir: string; db?: Db }

export class PermanentError extends Error {
  constructor(readonly reason: EvidenceFailure) {
    super(reason)
  }
}

/** Progressive or interlaced: no shrink-on-load. */
export async function fullDecodeTooLarge(
  input: Buffer,
  maxPixels = MAX_FULL_DECODE_PIXELS,
): Promise<boolean> {
  const meta = await sharp(input, { limitInputPixels: PIXEL_LIMIT }).metadata()
  const pixels = (meta.width ?? 0) * (meta.height ?? 0)
  return meta.isProgressive === true && pixels > maxPixels
}

/** Re-encode strips all metadata. */
export function encodePreview(
  input: Buffer,
  seconds = DECODE_TIMEOUT_S,
): Promise<Buffer> {
  return sharp(input, { failOn: "warning", limitInputPixels: PIXEL_LIMIT })
    .timeout({ seconds: Math.max(1, Math.min(DECODE_TIMEOUT_S, seconds)) })
    .autoOrient()
    .resize({
      width: PREVIEW_MAX_PX,
      height: PREVIEW_MAX_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer()
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** Hash and magic bytes again. */
export async function checkOriginal(
  input: Buffer,
  claim: {
    kind: EvidenceKind
    detectedType: string | null
    sha256: string | null
  },
): Promise<string> {
  if (sha256(input) !== claim.sha256) {
    throw new PermanentError("sha256_mismatch")
  }
  const found = await fileTypeFromBuffer(input.subarray(0, SNIFF_BYTES))
  if (
    !found ||
    found.mime !== claim.detectedType ||
    detectedKind(found.mime) !== claim.kind
  ) {
    throw new PermanentError("unsupported_type")
  }
  return found.mime
}

type Settle = {
  status: EvidenceStatus
  failureReason?: EvidenceFailure
  previewPages?: number
  sourcePages?: number
  durationMs?: number
  width?: number
  height?: number
}

/** Row access for received files. */
export function evidenceRows(deps: EvidenceDeps) {
  const options = { db: deps.db }
  const received = (evidenceId: string) =>
    and(eq(evidence.id, evidenceId), eq(evidence.status, "received"))

  return {
    read: async (orgId: string, evidenceId: string) => {
      const [row] = await withTenant(
        orgId,
        (tx) =>
          tx
            .select({
              status: evidence.status,
              kind: evidence.kind,
              detectedType: evidence.detectedType,
              sha256: evidence.sha256,
            })
            .from(evidence)
            .where(eq(evidence.id, evidenceId)),
        options,
      )
      // Deleted, or wrong org
      if (!row) writeLog({ msg: "evidence row gone", queue: "evidence" })
      return row
    },

    settle: (orgId: string, evidenceId: string, patch: Settle) =>
      withTenant(
        orgId,
        (tx) =>
          tx
            .update(evidence)
            .set({ ...patch, updatedAt: sql`now()` })
            .where(received(evidenceId)),
        options,
      ),

    markScanned: (orgId: string, evidenceId: string) =>
      withTenant(
        orgId,
        (tx) =>
          tx
            .update(evidence)
            .set({ scannedAt: sql`now()`, updatedAt: sql`now()` })
            .where(received(evidenceId)),
        options,
      ),

    // Committed write before decoding
    countDecode: (orgId: string, evidenceId: string) =>
      withTenant(
        orgId,
        async (tx) => {
          const [row] = await tx
            .update(evidence)
            .set({
              attempts: sql`${evidence.attempts} + 1`,
              updatedAt: sql`now()`,
            })
            .where(received(evidenceId))
            .returning({ attempts: evidence.attempts })
          return row?.attempts
        },
        options,
      ),
  }
}

export type EvidenceRows = ReturnType<typeof evidenceRows>

// clamd StreamMaxLength is 12M
const SCAN_MAX_BYTES = EVIDENCE_LIMITS.pdf

export type ScanSource = {
  clamd: ClamdConfig
  bytes: () => Promise<Uint8Array>
  signal?: AbortSignal
  // Already scanned this run
  done?: boolean
}

/** Clean verdict saved, else quarantined. */
export async function scanOriginal(
  rows: EvidenceRows,
  orgId: string,
  evidenceId: string,
  source: ScanSource,
): Promise<"clean" | "malware" | "too_large"> {
  const bytes = await source.bytes()
  if (bytes.byteLength > SCAN_MAX_BYTES) return "too_large"
  // Outage throws, job retries
  const scan = await scanBytes(bytes, source.clamd, source.signal)
  if (scan.infected) {
    await rows.settle(orgId, evidenceId, {
      status: "rejected_malware",
      failureReason: "malware",
    })
    return "malware"
  }
  await rows.markScanned(orgId, evidenceId)
  return "clean"
}

/** Scanned, logged, closed for review. */
export async function manualReview(
  rows: EvidenceRows,
  orgId: string,
  evidenceId: string,
  reason: EvidenceFailure,
  source?: ScanSource,
): Promise<"manual_review" | "malware"> {
  // Admins may download it
  if (source && !source.done) {
    const verdict = await scanOriginal(rows, orgId, evidenceId, source)
    if (verdict === "malware") return "malware"
  }
  writeLog({ msg: "evidence manual review", evidence_id: evidenceId, reason })
  await rows.settle(orgId, evidenceId, {
    status: "needs_manual_review",
    failureReason: reason,
  })
  return "manual_review"
}
