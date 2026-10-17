import { describe, expect, test } from "bun:test"
import { newestUpload } from "./b2-newest.ts"

describe("newestUpload", () => {
  test("latest upload wins, folders ignored", () => {
    expect(
      newestUpload(
        [
          { action: "upload", uploadTimestamp: 1_000 },
          { action: "folder", uploadTimestamp: 0 },
          { action: "hide", uploadTimestamp: 9_000 },
          { action: "upload", uploadTimestamp: 5_000 },
        ],
        2_000,
      ),
    ).toBe(5_000)
  })

  test("keeps the earlier maximum", () => {
    expect(newestUpload([{ action: "upload", uploadTimestamp: 1 }], 7)).toBe(7)
  })
})
