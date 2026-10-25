import { join } from "node:path"
import { runTool } from "./tools.ts"

// ffprobe and ffmpeg, forced demuxer

export type VideoProbe = {
  durationSeconds: number
  width: number
  height: number
}

// Item 10: short side 720
const SCALE =
  "scale=w='if(lte(iw,ih),min(iw,720),-2)':h='if(lte(iw,ih),-2,min(ih,720))'"

// No network, no playlists
const INPUT = (demuxer: string, path: string) => [
  "-protocol_whitelist",
  "file",
  "-f",
  demuxer,
  "-i",
  path,
]

type Probed = {
  streams?: { codec_type?: string; width?: number; height?: number }[]
  format?: { duration?: string }
}

/** Null when no readable video. */
export async function probeVideo(
  path: string,
  demuxer: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<VideoProbe | null> {
  const run = await runTool(
    [
      "ffprobe",
      "-v",
      "error",
      ...INPUT(demuxer, path),
      "-print_format",
      "json",
      "-show_entries",
      "format=duration:stream=codec_type,width,height",
    ],
    options,
  )
  if (run.exitCode !== 0) return null
  let parsed: Probed
  try {
    parsed = JSON.parse(run.stdout) as Probed
  } catch {
    return null
  }
  const stream = parsed.streams?.find((s) => s.codec_type === "video")
  const durationSeconds = Number(parsed.format?.duration)
  if (!stream?.width || !stream.height || !Number.isFinite(durationSeconds)) {
    return null
  }
  return { durationSeconds, width: stream.width, height: stream.height }
}

/** ffmpeg encode argument list. */
export function encodeArgs(
  demuxer: string,
  path: string,
  output: string,
): string[] {
  return [
    "ffmpeg",
    "-nostdin",
    "-v",
    "error",
    "-y",
    ...INPUT(demuxer, path),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-sn",
    "-dn",
    "-vf",
    SCALE,
    "-fpsmax",
    "30",
    "-c:v",
    "libx264",
    // PERF-19: not host CPUs
    "-threads",
    "2",
    "-preset",
    "faster",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ac",
    "2",
    "-t",
    "180",
    "-movflags",
    "+faststart",
    output,
  ]
}

/** 720p H.264 plus poster. */
export async function transcodeVideo(
  path: string,
  demuxer: string,
  outDir: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<{ video: string; poster: string }> {
  const video = join(outDir, "video.mp4")
  const poster = join(outDir, "poster.png")
  const encode = await runTool(encodeArgs(demuxer, path, video), options)
  if (encode.exitCode !== 0) {
    throw new Error(`ffmpeg failed: ${encode.stderr.slice(0, 200)}`)
  }
  // Poster from our own output
  const frame = await runTool(
    [
      "ffmpeg",
      "-nostdin",
      "-v",
      "error",
      "-y",
      ...INPUT("mov", video),
      "-frames:v",
      "1",
      "-f",
      "image2",
      "-c:v",
      "png",
      poster,
    ],
    { timeoutMs: 60_000, signal: options.signal },
  )
  if (frame.exitCode !== 0) {
    throw new Error(`poster failed: ${frame.stderr.slice(0, 200)}`)
  }
  return { video, poster }
}
