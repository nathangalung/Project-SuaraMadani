import type { PublicMedia } from "../shared/evidence.ts"

// Public media addresses for pages

export type MediaView =
  | { type: "image"; src: string; page: number; width: number; height: number }
  | {
      type: "video"
      src: string
      poster: string
      width: number
      height: number
    }

const ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/

/** Null when nothing serves it. */
export function mediaView(
  media: PublicMedia,
  host: string,
  mediaOrigin = process.env.MEDIA_PUBLIC_ORIGIN,
): MediaView | null {
  if (media.type === "image") {
    return { ...media, src: `/media/${media.file}` }
  }
  const poster = `/media/${media.poster}`
  const size = { width: media.width, height: media.height }
  if (media.store === "local") {
    return { type: "video", src: `/media/${media.file}`, poster, ...size }
  }
  if (!mediaOrigin || !ORIGIN.test(mediaOrigin)) return null
  return {
    type: "video",
    src: `${mediaOrigin}/${host}/${media.file}`,
    poster,
    ...size,
  }
}
