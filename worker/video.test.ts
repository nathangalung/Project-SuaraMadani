import { describe, expect, test } from "bun:test"
import { encodeArgs } from "./video.ts"

describe("encodeArgs", () => {
  test("libx264 runs two threads", () => {
    // PERF-19: cgroup has 1.5 CPUs
    const args = encodeArgs("mp4", "/in/a", "/out/video.mp4")
    const at = args.indexOf("-threads")
    expect(at).toBeGreaterThan(args.indexOf("libx264"))
    expect(args[at + 1]).toBe("2")
    expect(args.at(-1)).toBe("/out/video.mp4")
  })

  test("input stays local, metadata dropped", () => {
    const args = encodeArgs("mp4", "/in/a", "/out/video.mp4")
    expect(args.slice(5, 11)).toEqual([
      "-protocol_whitelist",
      "file",
      "-f",
      "mp4",
      "-i",
      "/in/a",
    ])
    expect(args).toContain("-map_metadata")
  })
})
