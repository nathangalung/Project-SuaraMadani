import { readFile } from "node:fs/promises"
import type { JobPayloads } from "../db/jobs.server.ts"
import { writeAtomic } from "../server/atomic-file.server.ts"
import { derivedPath, originalPath } from "../server/files.server.ts"
import { type EvidenceFailure, needsHeifDecoder } from "../shared/evidence.ts"
import { type ClamdConfig, clamdFromEnv } from "./clamav.ts"
import {
  checkOriginal,
  DECODE_TIMEOUT_S,
  type EvidenceDeps,
  encodePreview,
  evidenceRows,
  fullDecodeTooLarge,
  MAX_DECODES,
  manualReview,
  PermanentError,
  type ScanSource,
  scanOriginal,
} from "./evidence-common.ts"
import { decodeHeif, ImageTooLarge, MultiImage } from "./heic.ts"
import { rasterizePdf } from "./pdf.ts"
import { ToolTimeout } from "./tools.ts"

// Within the 285 s handler
const ENCODE_BUDGET_S = 90

export type EvidenceOutcome = "ready" | "manual_review" | "malware" | "skipped"

/** Photos, HEIC, PDF pages. */
export function createEvidenceHandler(
  deps: EvidenceDeps & {
    clamd?: ClamdConfig
    heifMaxPixels?: number
    progressiveMaxPixels?: number
  },
) {
  const rows = evidenceRows(deps)
  const clamd = deps.clamd ?? clamdFromEnv()
  const decoder = { timeoutMs: DECODE_TIMEOUT_S * 1000 }

  return async function processEvidence(
    { orgId, evidenceId }: JobPayloads["evidence"],
    signal?: AbortSignal,
  ): Promise<EvidenceOutcome> {
    const row = await rows.read(orgId, evidenceId)
    // Video has its own queue
    if (row?.status !== "received" || row.kind === "video") return "skipped"

    // Missing file is retried
    const input = await readFile(originalPath(deps.filesDir, orgId, evidenceId))
    const source: ScanSource = { clamd, bytes: async () => input, signal }
    // PDF first, outage retries
    if (row.kind === "pdf") {
      const verdict = await scanOriginal(rows, orgId, evidenceId, source)
      if (verdict === "malware") return "malware"
      source.done = true
    }
    const review = (reason: EvidenceFailure) =>
      manualReview(rows, orgId, evidenceId, reason, source)
    let mime: string
    try {
      mime = await checkOriginal(input, row)
    } catch (error) {
      if (error instanceof PermanentError) return review(error.reason)
      throw error
    }

    const attempts = await rows.countDecode(orgId, evidenceId)
    if (attempts === undefined) return "skipped"
    // Stops poison-file crash loops
    if (attempts > MAX_DECODES) return review("attempts_exhausted")
    signal?.throwIfAborted()

    let previews: Buffer[]
    let sourcePages: number | undefined
    try {
      if (row.kind === "pdf") {
        const pdf = await rasterizePdf(input, { ...decoder, signal })
        sourcePages = pdf.sourcePages
        previews = []
        // One budget for all pages
        const deadline = Date.now() + ENCODE_BUDGET_S * 1000
        for (const page of pdf.pages) {
          signal?.throwIfAborted()
          const left = Math.floor((deadline - Date.now()) / 1000)
          if (left < 1) throw new ToolTimeout("page encode budget spent")
          previews.push(await encodePreview(page, left))
        }
      } else {
        const decoded = needsHeifDecoder(mime)
          ? await decodeHeif(input, {
              ...decoder,
              signal,
              maxPixels: deps.heifMaxPixels,
            })
          : input
        // Two buffered decodes OOM
        if (await fullDecodeTooLarge(decoded, deps.progressiveMaxPixels)) {
          throw new ImageTooLarge("progressive above cap")
        }
        previews = [await encodePreview(decoded)]
      }
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof MultiImage) return review("multi_image")
      if (error instanceof ImageTooLarge) return review("image_too_large")
      return review(error instanceof ToolTimeout ? "timeout" : "decode_failed")
    }
    signal?.throwIfAborted()
    for (const [index, preview] of previews.entries()) {
      await writeAtomic(
        derivedPath(deps.filesDir, orgId, evidenceId, `${index}.webp`),
        preview,
      )
    }
    await rows.settle(orgId, evidenceId, {
      status: "ready",
      previewPages: previews.length,
      sourcePages,
    })
    return "ready"
  }
}
