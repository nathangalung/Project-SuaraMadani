import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { JobPayloads } from "../db/jobs.server.ts"
import { writeAtomic } from "../server/atomic-file.server.ts"
import { derivedPath, originalPath } from "../server/files.server.ts"
import {
  type EvidenceFailure,
  videoDemuxer,
  videoLimitError,
} from "../shared/evidence.ts"
import { type ClamdConfig, clamdFromEnv } from "./clamav.ts"
import {
  checkOriginal,
  type EvidenceDeps,
  encodePreview,
  evidenceRows,
  MAX_DECODES,
  manualReview,
  PermanentError,
} from "./evidence-common.ts"
import { ToolTimeout, withScratch } from "./tools.ts"
import { probeVideo, transcodeVideo } from "./video.ts"

// Starting Values: ffmpeg 600 s
export const TRANSCODE_TIMEOUT_S = 600
const PROBE_TIMEOUT_MS = 30_000

export type VideoOutcome =
  | "ready"
  | "rejected"
  | "manual_review"
  | "malware"
  | "skipped"

/** ffprobe limits, then 720p. */
export function createVideoHandler(
  deps: EvidenceDeps & { clamd?: ClamdConfig },
) {
  const rows = evidenceRows(deps)
  const clamd = deps.clamd ?? clamdFromEnv()

  return async function processVideo(
    { orgId, evidenceId }: JobPayloads["evidence-video"],
    signal?: AbortSignal,
  ): Promise<VideoOutcome> {
    const row = await rows.read(orgId, evidenceId)
    if (row?.status !== "received" || row.kind !== "video") return "skipped"
    const source = originalPath(deps.filesDir, orgId, evidenceId)
    // Small files only, see scanOriginal
    const review = (reason: EvidenceFailure) =>
      manualReview(rows, orgId, evidenceId, reason, {
        clamd,
        bytes: () => readFile(source),
        signal,
      })
    let demuxer: string | undefined
    try {
      const mime = await checkOriginal(await readFile(source), row)
      demuxer = videoDemuxer(mime)
    } catch (error) {
      if (error instanceof PermanentError) return review(error.reason)
      throw error
    }
    if (!demuxer) return review("unsupported_type")

    const attempts = await rows.countDecode(orgId, evidenceId)
    if (attempts === undefined) return "skipped"
    if (attempts > MAX_DECODES) return review("attempts_exhausted")

    const probe = await probeVideo(source, demuxer, {
      timeoutMs: PROBE_TIMEOUT_MS,
      signal,
    })
    if (!probe) return review("no_video_stream")
    const meta = {
      durationMs: Math.round(probe.durationSeconds * 1000),
      width: probe.width,
      height: probe.height,
    }
    // Item 9: never transcoded
    const limit = videoLimitError(probe)
    if (limit) {
      await rows.settle(orgId, evidenceId, {
        status: "rejected_limits",
        failureReason:
          limit === "error_video_too_long"
            ? "video_too_long"
            : "video_resolution",
        ...meta,
      })
      return "rejected"
    }

    const outcome = await withScratch(async (dir) => {
      try {
        const out = await transcodeVideo(source, demuxer, dir, {
          timeoutMs: TRANSCODE_TIMEOUT_S * 1000,
          signal,
        })
        const poster = await encodePreview(
          Buffer.from(await Bun.file(out.poster).arrayBuffer()),
        )
        signal?.throwIfAborted()
        await writeAtomic(
          derivedPath(deps.filesDir, orgId, evidenceId, "video.mp4"),
          await Bun.file(join(dir, "video.mp4")).bytes(),
        )
        await writeAtomic(derivedPath(deps.filesDir, orgId, evidenceId), poster)
        return "ready" as const
      } catch (error) {
        if (signal?.aborted) throw error
        // Timeout is permanent, original kept
        return error instanceof ToolTimeout ? "timeout" : "decode_failed"
      }
    })
    if (outcome !== "ready") return review(outcome)
    await rows.settle(orgId, evidenceId, {
      status: "ready",
      previewPages: 1,
      ...meta,
    })
    return "ready"
  }
}
