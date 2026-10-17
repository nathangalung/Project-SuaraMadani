import { describe, expect, test } from "bun:test"
import { largestImage } from "./heic.ts"

const INFO = `MIME type: image/heic
main brand: heic

image: 640x480 (id=1), primary
  colorspace: YCbCr, 4:2:0
image: 16000x16000 (id=2)
  bit depth: 8
`

describe("largestImage", () => {
  test("reads every top-level image size", () => {
    expect(largestImage(INFO)).toBe(256_000_000)
  })

  test("no image line reads as unknown", () => {
    expect(largestImage("MIME type: image/heic\n")).toBeNull()
  })
})
