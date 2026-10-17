import { describe, expect, test } from "bun:test"
import { fileResponse } from "./file-response.server.ts"

const BLOB = new Blob([
  new Uint8Array(Array.from({ length: 100 }, (_, i) => i)),
])
const get = (range?: string) =>
  new Request("http://x.localhost/f", {
    headers: range ? { Range: range } : {},
  })

describe("fileResponse", () => {
  test("whole file advertises ranges", async () => {
    const res = fileResponse(get(), BLOB, { "Content-Type": "video/mp4" })
    expect(res.status).toBe(200)
    expect(res.headers.get("accept-ranges")).toBe("bytes")
    expect(res.headers.get("content-type")).toBe("video/mp4")
    expect((await res.arrayBuffer()).byteLength).toBe(100)
  })

  test("one range is a 206", async () => {
    const res = fileResponse(get("bytes=10-19"), BLOB, {})
    expect(res.status).toBe(206)
    expect(res.headers.get("content-range")).toBe("bytes 10-19/100")
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ])
  })

  test("open and suffix ranges", async () => {
    expect(
      fileResponse(get("bytes=90-"), BLOB, {}).headers.get("content-range"),
    ).toBe("bytes 90-99/100")
    expect(
      fileResponse(get("bytes=-5"), BLOB, {}).headers.get("content-range"),
    ).toBe("bytes 95-99/100")
  })

  test("unsatisfiable ranges are 416", () => {
    const res = fileResponse(get("bytes=200-300"), BLOB, {})
    expect(res.status).toBe(416)
    expect(res.headers.get("content-range")).toBe("bytes */100")
  })

  test("multiple or malformed ranges send the whole file", () => {
    expect(fileResponse(get("bytes=0-1,5-6"), BLOB, {}).status).toBe(200)
    expect(fileResponse(get("items=0-1"), BLOB, {}).status).toBe(200)
  })
})
