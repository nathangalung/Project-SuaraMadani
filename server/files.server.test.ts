import { describe, expect, test } from "bun:test"
import {
  briefPath,
  cleanBriefPath,
  derivedPath,
  publicMediaPath,
} from "./files.server.ts"

const ORG = "0b6c1f2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e"
const BRIEF = "1c7d2e3f-4a5b-4c6d-9e0f-1a2b3c4d5e6f"

// Paths built from ids only
describe("file paths", () => {
  test("brief paths stay under the files directory", () => {
    expect(briefPath("/srv/files", ORG, BRIEF)).toBe(
      `/srv/files/evidence/briefs/${ORG}/${BRIEF}.pdf`,
    )
    expect(cleanBriefPath("/srv/files", ORG, BRIEF)).toBe(
      `/srv/files/derived/briefs/${ORG}/${BRIEF}.pdf`,
    )
  })

  test("Given an id that is not a UUID, when a brief path is built, then it refuses", () => {
    for (const build of [briefPath, cleanBriefPath]) {
      expect(() => build("/srv/files", ORG, "../../etc/passwd")).toThrow(
        "bad brief id",
      )
      expect(() => build("/srv/files", "..", BRIEF)).toThrow("bad brief id")
    }
  })

  test("Given a traversal host or name, when a public media path is built, then it refuses", () => {
    const name = `${"a".repeat(64)}.webp`
    expect(publicMediaPath("/srv/files", "itb.localhost", name)).toBe(
      `/srv/files/public/itb.localhost/media/${name}`,
    )
    expect(() => publicMediaPath("/srv/files", "a..b", name)).toThrow(
      "bad tenant host",
    )
    expect(() => publicMediaPath("/srv/files", "../x", name)).toThrow(
      "bad tenant host",
    )
    expect(() =>
      publicMediaPath("/srv/files", "itb.localhost", "../x.webp"),
    ).toThrow("bad media name")
    expect(() => derivedPath("/srv/files", ORG, BRIEF, "../0.webp")).toThrow(
      "bad derived name",
    )
  })
})
