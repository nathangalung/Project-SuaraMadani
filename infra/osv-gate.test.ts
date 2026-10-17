import { describe, expect, test } from "bun:test"
import { blocking, type Report } from "./osv-gate.ts"

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
