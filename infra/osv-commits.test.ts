import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitFindings, gitDeps, main, pinErrors } from "./osv-commits.ts"

const FULL = "bcea72df9ec34d9d9140ab30619cf479c7c144c7"
const lock = `{
  "packages": {
    "libsignal": ["libsignal@github:whiskeysockets/libsignal-node#bcea72d", {}, "x", "sha512-a"],
    "zod": ["zod@4.6.5", "", {}, "sha512-b"],
  }
}`

describe("git dependencies OSV skips", () => {
  test("finds each git dependency and its short commit", () => {
    expect(gitDeps(lock)).toEqual([{ name: "libsignal", commit: "bcea72d" }])
  })

  test("a missing, wrong or stale pin is an error", () => {
    const deps = gitDeps(lock)
    expect(pinErrors(deps, { libsignal: FULL })).toEqual([])
    expect(pinErrors(deps, {})).toEqual([
      "libsignal bcea72d has no full commit pin",
    ])
    expect(pinErrors(deps, { libsignal: "a".repeat(40) })).toEqual([
      `libsignal pin ${"a".repeat(40)} does not start with bcea72d`,
    ])
    expect(pinErrors(deps, { libsignal: FULL, gone: FULL })).toEqual([
      "gone is pinned but not in the lockfile",
    ])
  })

  test("any advisory on the commit blocks", async () => {
    const asked: string[] = []
    const fetcher = async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error")
      asked.push(String(init.body))
      return Response.json({ vulns: [{ id: "GHSA-x" }] })
    }
    expect(await commitFindings({ libsignal: FULL }, fetcher)).toEqual([
      `libsignal ${FULL} GHSA-x`,
    ])
    expect(asked).toEqual([JSON.stringify({ commit: FULL })])
  })

  test("an empty answer passes, an error throws", async () => {
    const empty = async () => Response.json({})
    expect(await commitFindings({ libsignal: FULL }, empty)).toEqual([])
    const down = async () => new Response("no", { status: 503 })
    expect(commitFindings({ libsignal: FULL }, down)).rejects.toThrow("503")
  })
})

describe("bun osv-commits.ts", () => {
  let dir = ""

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "osv-commits-"))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function run(lockText: string, fetcher: Fetcher) {
    const path = join(dir, "bun.lock")
    await Bun.write(path, lockText)
    const pins = join(dir, "pins.json")
    await Bun.write(pins, JSON.stringify({ libsignal: FULL }))
    const out = spyOn(console, "log").mockImplementation(() => {})
    const err = spyOn(console, "error").mockImplementation(() => {})
    try {
      const code = await main([path], fetcher, pins)
      return {
        code,
        summary: JSON.parse(String(out.mock.calls[0]?.[0])),
        lines: err.mock.calls.map(([line]) => String(line)),
      }
    } finally {
      out.mockRestore()
      err.mockRestore()
    }
  }

  type Fetcher = (url: string, init: RequestInit) => Promise<Response>

  test("Given matching pins and a clean commit, then it exits 0", async () => {
    let asked = 0
    const clean = async () => {
      asked++
      return Response.json({})
    }
    expect(await run(lock, clean)).toEqual({
      code: 0,
      summary: { msg: "osv-commits", errors: 0, found: 0 },
      lines: [],
    })
    expect(asked).toBe(1)
  })

  test("Given an advisory on the pinned commit, then it names it and exits 1", async () => {
    const vulnerable = async () => Response.json({ vulns: [{ id: "GHSA-y" }] })
    const result = await run(lock, vulnerable)
    expect(result.code).toBe(1)
    expect(result.lines).toEqual([`libsignal ${FULL} GHSA-y`])
  })

  test("Given a lockfile the pins no longer match, then it fails without asking OSV", async () => {
    let asked = 0
    const counting = async () => {
      asked++
      return Response.json({})
    }
    const result = await run('{ "packages": {} }', counting)
    expect(result.code).toBe(1)
    expect(result.lines).toEqual([
      "libsignal is pinned but not in the lockfile",
    ])
    expect(asked).toBe(0)
  })

  test("no lockfile path is a usage error", async () => {
    await expect(main([])).rejects.toThrow("usage: bun osv-commits.ts")
  })
})
