import { evidenceKind } from "../../../shared/report-fields.ts"
import { memory, type VideoMeta } from "./draft-store"

// Item 9: browser checks first
const TIMEOUT_MS = 8000

function readVideoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const video = document.createElement("video")
    const url = URL.createObjectURL(file)
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (meta: VideoMeta) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      video.removeAttribute("src")
      resolve(meta)
    }
    // Unreadable here, server decides
    timer = setTimeout(() => done({}), TIMEOUT_MS)
    video.preload = "metadata"
    video.muted = true
    video.onloadedmetadata = () =>
      done({
        durationSeconds: Number.isFinite(video.duration)
          ? video.duration
          : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      })
    video.onerror = () => done({})
    video.src = url
  })
}

/** Cached per File, videos only. */
export async function ensureVideoMeta(files: File[]): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      if (evidenceKind(file) !== "video" || memory.meta.has(file)) return
      memory.meta.set(file, await readVideoMeta(file))
    }),
  )
}
