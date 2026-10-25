import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type Coverage,
  coverageReport,
  FLOOR_EXCEPTIONS,
  isBackendSource,
  MAX_EXCEPTIONS,
  main,
  parseLcov,
  repoFiles,
} from "./coverage-gate.ts"

const root = join(import.meta.dir, "..")

function record(file: string, lf: number, lh: number, fnf = 2, fnh = 2) {
  return `TN:\nSF:${file}\nFNF:${fnf}\nFNH:${fnh}\nDA:1,1\nLF:${lf}\nLH:${lh}\nend_of_record\n`
}

const full = (files: string[]) =>
  new Map(
    files.map((file): [string, Coverage] => [
      file,
      { lines: 100, linesHit: 100, funcs: 4, funcsHit: 4 },
    ]),
  )

describe("backend source list", () => {
  test("server, worker, db, shared and infra modules count", () => {
    for (const file of [
      "server/index.ts",
      "worker/heic.ts",
      "db/sessions.ts",
      "shared/phone.ts",
      "infra/smoke.ts",
      "app/features/demands/follow.server.ts",
      "app/routes/api/upload.ts",
    ]) {
      expect({ file, backend: isBackendSource(file) }).toEqual({
        file,
        backend: true,
      })
    }
  })

  test("tests, helpers, migrations and UI do not", () => {
    for (const file of [
      "server/app.test.ts",
      "db/testing.ts",
      "db/migrations/meta.ts",
      "shared/env.d.ts",
      "app/routes/home.tsx",
      "app/features/report/draft-store.ts",
      "app/routes.ts",
      "e2e/api-fixtures.ts",
      "infra/load-test.js",
    ]) {
      expect({ file, backend: isBackendSource(file) }).toEqual({
        file,
        backend: false,
      })
    }
  })

  test("the repo list holds server entry and gates", () => {
    const sources = repoFiles(root).filter(isBackendSource)
    expect(sources).toContain("server/index.ts")
    expect(sources).toContain("infra/coverage-gate.ts")
    expect(sources).toContain("infra/acceptance-gate.ts")
    expect(sources.some((file) => file.endsWith(".test.ts"))).toBe(false)
  })
})

describe("lcov parsing", () => {
  test("reads lines and functions per file", () => {
    const lcov = parseLcov(
      record("server/a.ts", 10, 9, 3, 2) + record("worker/b.ts", 4, 4, 0, 0),
      root,
    )
    expect([...lcov]).toEqual([
      ["server/a.ts", { lines: 10, linesHit: 9, funcs: 3, funcsHit: 2 }],
      ["worker/b.ts", { lines: 4, linesHit: 4, funcs: 0, funcsHit: 0 }],
    ])
  })

  test("absolute paths become repo relative", () => {
    const lcov = parseLcov(record("/app/server/a.ts", 2, 2), "/app")
    expect([...lcov.keys()]).toEqual(["server/a.ts"])
  })

  test("a record without line totals is refused", () => {
    expect(() => parseLcov("SF:server/a.ts\nend_of_record\n", root)).toThrow(
      "server/a.ts",
    )
  })

  test("a record without function totals is refused", () => {
    const text =
      "SF:server/a.ts\nFN:1,f\nFNDA:0,f\nLF:10\nLH:10\nend_of_record\n"
    expect(() => parseLcov(text, root)).toThrow("server/a.ts")
  })

  test("more hits than lines or functions is refused", () => {
    expect(() => parseLcov(record("server/b.ts", 10, 50), root)).toThrow(
      "server/b.ts",
    )
    expect(() => parseLcov(record("server/c.ts", 10, 10, 4, 9), root)).toThrow(
      "server/c.ts",
    )
  })

  test("a file reported twice is refused", () => {
    const text = record("server/a.ts", 2, 2) + record("server/a.ts", 2, 1)
    expect(() => parseLcov(text, root)).toThrow("twice")
  })
})

describe("thresholds", () => {
  const sources = ["server/a.ts", "server/b.ts"]

  test("every file at 100% passes", () => {
    const report = coverageReport(sources, full(sources), {})
    expect(report.problems).toEqual([])
    expect(report.linesPct).toBe(100)
  })

  test("a file left out of the report fails", () => {
    const report = coverageReport(sources, full(["server/a.ts"]), {})
    expect(report.missing).toEqual(["server/b.ts"])
    expect(report.problems).toContain("missing from lcov: server/b.ts")
  })

  test("99 passes and 98.99 fails, for lines and functions", () => {
    const at = (linesHit: number, funcsHit: number) =>
      coverageReport(
        ["server/a.ts"],
        new Map([
          ["server/a.ts", { lines: 10000, linesHit, funcs: 10000, funcsHit }],
        ]),
        {},
      ).problems
    expect(at(9900, 9900)).toEqual([])
    expect(at(9899, 9900)).toEqual(["lines 98.99% < 99%"])
    expect(at(9900, 9899)).toEqual(["functions 98.99% < 99%"])
    expect(at(9899, 9899)).toEqual([
      "lines 98.99% < 99%",
      "functions 98.99% < 99%",
    ])
  })

  test("98.995% fails though it prints as 99%", () => {
    const at = (linesHit: number, funcsHit: number) =>
      coverageReport(
        ["server/a.ts"],
        new Map([
          ["server/a.ts", { lines: 20000, linesHit, funcs: 20000, funcsHit }],
        ]),
        {},
      ).problems
    expect(at(19799, 19800)).toEqual(["lines 99% < 99%"])
    expect(at(19800, 19799)).toEqual(["functions 99% < 99%"])
  })

  test("90% passes the floor and 89.99% fails", () => {
    const at = (lines: number, linesHit: number) =>
      coverageReport(
        sources,
        new Map([
          ["server/a.ts", { lines: 1, linesHit: 1, funcs: 1, funcsHit: 1 }],
          ["server/b.ts", { lines, linesHit, funcs: 1, funcsHit: 1 }],
        ]),
        {},
      )
    expect(at(10000, 9000).belowFloor).toEqual([])
    expect(at(10000, 8999).belowFloor).toEqual([
      { file: "server/b.ts", pct: 89.99, uncovered: 1001 },
    ])
    expect(at(10000, 8999).problems).toContain(
      "below 90% lines: server/b.ts 89.99% (1001 uncovered)",
    )
    expect(at(20000, 17999).problems).toContain(
      "below 90% lines: server/b.ts 90% (2001 uncovered)",
    )
  })

  test("a file under 90% lines fails the floor", () => {
    const lcov = full(sources)
    lcov.set("server/b.ts", { lines: 100, linesHit: 89, funcs: 4, funcsHit: 4 })
    const report = coverageReport(sources, lcov, {})
    expect(report.belowFloor).toEqual([
      { file: "server/b.ts", pct: 89, uncovered: 11 },
    ])
    expect(report.problems).toContain(
      "below 90% lines: server/b.ts 89% (11 uncovered)",
    )
  })

  test("an excepted file skips only the floor", () => {
    const lcov = full(sources)
    lcov.set("server/b.ts", { lines: 100, linesHit: 50, funcs: 4, funcsHit: 4 })
    const report = coverageReport(sources, lcov, {
      "server/b.ts": "entrypoint, logic tested elsewhere",
    })
    expect(report.belowFloor).toEqual([])
    expect(report.problems).toEqual(["lines 75% < 99%"])
  })

  test("an exception cannot excuse a missing file", () => {
    const report = coverageReport(sources, full(["server/a.ts"]), {
      "server/b.ts": "entrypoint",
    })
    expect(report.problems).toContain("missing from lcov: server/b.ts")
  })

  test("stale, unreasoned or too many exceptions fail", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_EXCEPTIONS + 1 }, (_, i) => [
        `server/${i}.ts`,
        "reason",
      ]),
    )
    const problems = (exceptions: Record<string, string>) =>
      coverageReport(sources, full(sources), exceptions).problems
    expect(problems({ "server/gone.ts": "moved" })).toEqual([
      "exception for a non-source file: server/gone.ts",
    ])
    expect(problems({ "server/a.ts": " " })).toEqual([
      "exception without a reason: server/a.ts",
    ])
    expect(problems(many)).toContain(
      `${MAX_EXCEPTIONS + 1} exceptions, at most ${MAX_EXCEPTIONS}`,
    )
  })

  test("no backend source at all fails", () => {
    expect(coverageReport([], new Map(), {}).problems).toEqual([
      "no backend source files found",
    ])
  })

  test("non-backend lcov records do not count", () => {
    const lcov = full(sources)
    lcov.set("app/routes/home.tsx", {
      lines: 100,
      linesHit: 0,
      funcs: 4,
      funcsHit: 0,
    })
    expect(coverageReport(sources, lcov, {}).problems).toEqual([])
  })

  test("the committed exception list is short and reasoned", () => {
    const entries = Object.entries(FLOOR_EXCEPTIONS)
    expect(entries.length).toBeLessThanOrEqual(MAX_EXCEPTIONS)
    for (const [file, reason] of entries) {
      expect({ file, source: isBackendSource(file) }).toEqual({
        file,
        source: true,
      })
      expect(reason.trim().length).toBeGreaterThan(10)
    }
  })
})

describe("command line on the real repo", () => {
  let dir = ""
  const sources = repoFiles(root).filter(isBackendSource)

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sb-coverage-gate-"))
  })
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  async function lcovFile(files: string[]) {
    const path = join(dir, `${files.length}.info`)
    await Bun.write(path, files.map((f) => record(f, 10, 10)).join(""))
    return path
  }

  test("outside a git checkout the list fails", () => {
    expect(() => repoFiles(dir)).toThrow("git ls-files failed")
  })

  test("every real source at 100% exits 0", async () => {
    expect(await main([await lcovFile(sources)], root)).toBe(0)
  })

  test("server/index.ts left out exits 1", async () => {
    const without = sources.filter((file) => file !== "server/index.ts")
    expect(await main([await lcovFile(without)], root)).toBe(1)
  })

  test("a missing lcov file exits 1", async () => {
    expect(await main([join(dir, "none.info")], root)).toBe(1)
    expect(await main([], root)).toBe(1)
  })

  test("the script exits 1 on a partial report", async () => {
    const run = Bun.spawnSync(
      [
        process.execPath,
        join(root, "infra/coverage-gate.ts"),
        await lcovFile(sources.slice(1)),
      ],
      { cwd: root },
    )
    expect(run.exitCode).toBe(1)
    expect(run.stderr.toString()).toContain(`missing from lcov: ${sources[0]}`)
  })
})
