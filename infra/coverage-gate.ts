// Backend coverage gate, ADR-24
// Usage: bun coverage-gate.ts <lcov.info>

import { existsSync } from "node:fs"
import { join } from "node:path"

export type Coverage = {
  lines: number
  linesHit: number
  funcs: number
  funcsHit: number
}

type Below = { file: string; pct: number; uncovered: number }

export type Report = {
  files: number
  linesPct: number
  funcsPct: number
  missing: string[]
  belowFloor: Below[]
  problems: string[]
}

// Basis points, compared exactly
const AGGREGATE_BP = 9900
const FLOOR_BP = 9000
export const MAX_EXCEPTIONS = 5

// Floor only, never presence
export const FLOOR_EXCEPTIONS: Record<string, string> = {}

// Test-only, imported by tests
const TEST_HELPERS = new Set(["db/testing.ts"])

/** Backend source per ADR-24. */
export function isBackendSource(file: string): boolean {
  if (!file.endsWith(".ts") || file.endsWith(".d.ts")) return false
  if (file.endsWith(".test.ts") || TEST_HELPERS.has(file)) return false
  if (file.startsWith("db/migrations/")) return false
  if (/^(server|worker|db|shared|infra)\//.test(file)) return true
  return file.endsWith(".server.ts") || file.startsWith("app/routes/")
}

/** Tracked and untracked, not ignored. */
export function repoFiles(root: string): string[] {
  const listed = Bun.spawnSync(
    [
      "git",
      "-c",
      `safe.directory=${root}`,
      "ls-files",
      "-co",
      "--exclude-standard",
      "-z",
    ],
    { cwd: root },
  )
  if (listed.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${listed.stderr.toString()}`)
  }
  // Unmerged paths repeat per stage
  const files = new Set(listed.stdout.toString().split("\0"))
  // Tracked but deleted
  return [...files].filter((file) => file && existsSync(join(root, file)))
}

/** Per-file totals from lcov text. */
export function parseLcov(text: string, root: string): Map<string, Coverage> {
  const files = new Map<string, Coverage>()
  for (const block of text.split("end_of_record")) {
    const fields = new Map<string, string>()
    for (const line of block.split("\n")) {
      const at = line.indexOf(":")
      if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1))
    }
    const source = fields.get("SF")
    if (!source) continue
    const file = source.startsWith(`${root}/`)
      ? source.slice(root.length + 1)
      : source
    const num = (key: string) => Number(fields.get(key) ?? Number.NaN)
    const coverage = {
      lines: num("LF"),
      linesHit: num("LH"),
      funcs: num("FNF"),
      funcsHit: num("FNH"),
    }
    if (!Object.values(coverage).every(Number.isInteger)) {
      throw new Error(`lcov record without totals: ${file}`)
    }
    if (
      coverage.linesHit > coverage.lines ||
      coverage.funcsHit > coverage.funcs
    ) {
      throw new Error(`lcov record hits exceed totals: ${file}`)
    }
    if (files.has(file)) throw new Error(`lcov lists ${file} twice`)
    files.set(file, coverage)
  }
  return files
}

const pct = (hit: number, total: number) =>
  total === 0 ? 100 : Math.round((hit / total) * 10000) / 100
const meets = (hit: number, total: number, bp: number) =>
  hit * 10000 >= total * bp

/** No problems means passing. */
export function coverageReport(
  sources: string[],
  lcov: Map<string, Coverage>,
  exceptions: Record<string, string>,
): Report {
  const problems: string[] = []
  const missing: string[] = []
  const belowFloor: Below[] = []
  const sum = { lines: 0, linesHit: 0, funcs: 0, funcsHit: 0 }
  for (const file of sources) {
    const coverage = lcov.get(file)
    if (!coverage) {
      missing.push(file)
      continue
    }
    sum.lines += coverage.lines
    sum.linesHit += coverage.linesHit
    sum.funcs += coverage.funcs
    sum.funcsHit += coverage.funcsHit
    const { lines, linesHit } = coverage
    if (!meets(linesHit, lines, FLOOR_BP) && !(file in exceptions)) {
      const below = {
        file,
        pct: pct(linesHit, lines),
        uncovered: lines - linesHit,
      }
      belowFloor.push(below)
    }
  }
  if (sources.length === 0) problems.push("no backend source files found")
  for (const file of missing) problems.push(`missing from lcov: ${file}`)
  for (const { file, pct, uncovered } of belowFloor) {
    problems.push(
      `below ${FLOOR_BP / 100}% lines: ${file} ${pct}% (${uncovered} uncovered)`,
    )
  }
  const linesPct = pct(sum.linesHit, sum.lines)
  const funcsPct = pct(sum.funcsHit, sum.funcs)
  if (!meets(sum.linesHit, sum.lines, AGGREGATE_BP)) {
    problems.push(`lines ${linesPct}% < ${AGGREGATE_BP / 100}%`)
  }
  if (!meets(sum.funcsHit, sum.funcs, AGGREGATE_BP)) {
    problems.push(`functions ${funcsPct}% < ${AGGREGATE_BP / 100}%`)
  }
  const listed = Object.entries(exceptions)
  if (listed.length > MAX_EXCEPTIONS) {
    problems.push(`${listed.length} exceptions, at most ${MAX_EXCEPTIONS}`)
  }
  for (const [file, reason] of listed) {
    if (!sources.includes(file)) {
      problems.push(`exception for a non-source file: ${file}`)
    } else if (!reason.trim()) {
      problems.push(`exception without a reason: ${file}`)
    }
  }
  return {
    files: sources.length,
    linesPct,
    funcsPct,
    missing,
    belowFloor,
    problems,
  }
}

/** Exit code, problems on stderr. */
export async function main(
  argv: string[],
  root = join(import.meta.dir, ".."),
): Promise<number> {
  const path = argv[0]
  const lcovFile = path ? Bun.file(path) : undefined
  if (!lcovFile || !(await lcovFile.exists())) {
    console.error(`no lcov report at ${path ?? "(none given)"}`)
    return 1
  }
  const sources = repoFiles(root).filter(isBackendSource).sort()
  const lcov = parseLcov(await lcovFile.text(), root)
  const report = coverageReport(sources, lcov, FLOOR_EXCEPTIONS)
  for (const line of report.problems) console.error(line)
  console.log(
    JSON.stringify({
      msg: "coverage-gate",
      files: report.files,
      lines: report.linesPct,
      functions: report.funcsPct,
      missing: report.missing.length,
      belowFloor: report.belowFloor.length,
      problems: report.problems.length,
    }),
  )
  return report.problems.length > 0 ? 1 : 0
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
