import { describe, expect, test } from "bun:test"
import { mediaView } from "./media-url.server.ts"

const IMAGE = {
  type: "image" as const,
  file: `${"a".repeat(64)}.webp`,
  page: 0,
  width: 4,
  height: 3,
}
const VIDEO = {
  type: "video" as const,
  file: `${"b".repeat(64)}.mp4`,
  poster: `${"c".repeat(64)}.webp`,
  width: 1280,
  height: 720,
}

describe("mediaView", () => {
  test("images come from the tenant host", () => {
    expect(mediaView(IMAGE, "itb.localhost", undefined)?.src).toBe(
      `/media/${IMAGE.file}`,
    )
  })

  test("R2 video needs the media origin", () => {
    const r2 = { ...VIDEO, store: "r2" as const }
    expect(mediaView(r2, "itb.sadarbersuara.id", undefined)).toBeNull()
    expect(
      mediaView(r2, "itb.sadarbersuara.id", "https://media.sadarbersuara.id"),
    ).toEqual({
      type: "video",
      src: `https://media.sadarbersuara.id/itb.sadarbersuara.id/${VIDEO.file}`,
      poster: `/media/${VIDEO.poster}`,
      width: 1280,
      height: 720,
    })
    expect(mediaView(r2, "itb.sadarbersuara.id", "javascript:x")).toBeNull()
  })

  test("dev video stays local", () => {
    const local = { ...VIDEO, store: "local" as const }
    expect(mediaView(local, "itb.localhost", undefined)?.src).toBe(
      `/media/${VIDEO.file}`,
    )
  })
})
