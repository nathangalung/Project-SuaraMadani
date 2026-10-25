import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { blocking, main, type Report, summaryTable, tally } from "./osv-gate.ts"

function report(severity: string, fixed?: string, unimportant = false): Report {
  return {
    results: [
      {
        packages: [
          {
            package: { name: "libx", version: "1.0", ecosystem: "Debian:13" },
            groups: [
              {
                ids: ["CVE-1"],
                max_severity: severity,
                experimental_analysis: { "CVE-1": { unimportant } },
              },
            ],
            vulnerabilities: [
              {
                id: "CVE-1",
                affected: [
                  {
                    package: { name: "libx", ecosystem: "Debian:13" },
                    ranges: [
                      {
                        events: [
                          { introduced: "0" },
                          ...(fixed ? [{ fixed }] : []),
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

describe("blocking", () => {
  test("high with a fix blocks", () => {
    expect(blocking(report("7.5", "1.1"))).toEqual([
      "libx 1.0 CVE-1 severity 7.5, fixed in 1.1",
    ])
  })

  test("high without a fix passes", () => {
    expect(blocking(report("9.8"))).toEqual([])
  })

  test("medium with a fix passes", () => {
    expect(blocking(report("5.3", "1.1"))).toEqual([])
  })

  test("unknown severity with a fix blocks", () => {
    expect(blocking(report("", "1.1"))).toHaveLength(1)
  })

  test("distro unimportant passes", () => {
    expect(blocking(report("", "1.1", true))).toEqual([])
  })

  test("a fix for another release passes", () => {
    const other = report("8.1", "1.1")
    const vuln = other.results?.[0]?.packages[0]?.vulnerabilities[0]
    const affected = vuln?.affected[0]
    if (affected) affected.package.ecosystem = "Debian:12"
    expect(blocking(other)).toEqual([])
  })
})

describe("tally", () => {
  // SC-17: non-blocking findings stay visible
  const merged = (...reports: Report[]): Report => ({
    results: reports.flatMap((r) => r.results ?? []),
  })

  test("counts every finding by severity and fix", () => {
    const counts = tally(
      merged(
        report("9.8"),
        report("7.5", "1.1"),
        report("5.3", "1.1"),
        report("2.0"),
        report(""),
        report("", "1.1", true),
      ),
    )
    expect(counts).toEqual({
      blocking: 1,
      critical: { fix: 0, noFix: 1 },
      high: { fix: 1, noFix: 0 },
      medium: { fix: 1, noFix: 0 },
      low: { fix: 0, noFix: 1 },
      unknown: { fix: 0, noFix: 1 },
      unimportant: 1,
    })
  })

  test("the summary table names each row", () => {
    const table = summaryTable("image app:ci", tally(report("5.3", "1.1")))
    expect(table).toContain("### osv-scanner: image app:ci")
    expect(table).toContain("| Medium | 1 | 0 |")
    expect(table).toContain("Blocking: 0")
  })
})

describe("bun osv-gate.ts", () => {
  let dir = ""

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "osv-gate-"))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function run(found: Report, env: Record<string, string> = {}) {
    const path = join(dir, "report.json")
    await Bun.write(path, JSON.stringify(found))
    const out = spyOn(console, "log").mockImplementation(() => {})
    const err = spyOn(console, "error").mockImplementation(() => {})
    try {
      const code = await main([path, "image app"], env)
      return { code, lines: err.mock.calls.map(([line]) => String(line)) }
    } finally {
      out.mockRestore()
      err.mockRestore()
    }
  }

  test("Given a fixable high finding in CI, then it exits 1 and writes the step summary", async () => {
    const summary = join(dir, "summary.md")
    const result = await run(report("7.5", "1.1"), {
      GITHUB_STEP_SUMMARY: summary,
    })
    expect(result.code).toBe(1)
    expect(result.lines).toEqual(blocking(report("7.5", "1.1")))
    expect(await Bun.file(summary).text()).toStartWith(
      "### osv-scanner: image app",
    )
  })

  test("Given only unfixable findings outside CI, then it exits 0", async () => {
    expect(await run(report("9.8"))).toEqual({ code: 0, lines: [] })
  })

  test("no report path is a usage error", async () => {
    await expect(main([], {})).rejects.toThrow("usage: bun osv-gate.ts")
  })
})
