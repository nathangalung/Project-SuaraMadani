import { appendFile } from "node:fs/promises"

// Fail on fixable high findings
// Usage: bun osv-gate.ts <osv-scanner.json> [target]

type Event = { introduced?: string; fixed?: string }
type Affected = {
  package: { name: string; ecosystem: string }
  ranges?: { events: Event[] }[]
}
type Vuln = { id: string; affected: Affected[] }
type Group = {
  ids: string[]
  max_severity?: string
  experimental_analysis?: Record<string, { unimportant?: boolean }>
}
type Pkg = {
  package: { name: string; version: string; ecosystem: string }
  groups: Group[]
  vulnerabilities: Vuln[]
}
export type Report = { results?: { packages: Pkg[] }[] }

// Decisions: HIGH or CRITICAL
const HIGH = 7

function fixedIn(pkg: Pkg["package"], vuln: Vuln | undefined): string | null {
  for (const affected of vuln?.affected ?? []) {
    const same =
      affected.package.name === pkg.name &&
      affected.package.ecosystem === pkg.ecosystem
    if (!same) continue
    for (const range of affected.ranges ?? []) {
      const fixed = range.events.find((event) => event.fixed)?.fixed
      if (fixed) return fixed
    }
  }
  return null
}

/** Unknown severity counts as high. */
export function blocking(report: Report): string[] {
  const found: string[] = []
  for (const result of report.results ?? []) {
    for (const pkg of result.packages) {
      for (const group of pkg.groups) {
        const severity = Number.parseFloat(group.max_severity ?? "")
        if (!Number.isNaN(severity) && severity < HIGH) continue
        for (const id of group.ids) {
          if (group.experimental_analysis?.[id]?.unimportant) continue
          const vuln = pkg.vulnerabilities.find((v) => v.id === id)
          const fixed = fixedIn(pkg.package, vuln)
          if (!fixed) continue
          const shown = Number.isNaN(severity) ? "unknown" : String(severity)
          found.push(
            `${pkg.package.name} ${pkg.package.version} ${id} severity ${shown}, fixed in ${fixed}`,
          )
        }
      }
    }
  }
  return found
}

type Bucket = "critical" | "high" | "medium" | "low" | "unknown"
type Split = { fix: number; noFix: number }
export type Tally = Record<Bucket, Split> & {
  blocking: number
  unimportant: number
}

// CVSS qualitative bands
function bucketOf(severity: number): Bucket {
  if (Number.isNaN(severity)) return "unknown"
  if (severity >= 9) return "critical"
  if (severity >= HIGH) return "high"
  if (severity >= 4) return "medium"
  return "low"
}

/** Every finding, blocking or not. */
export function tally(report: Report): Tally {
  const counts: Tally = {
    blocking: blocking(report).length,
    critical: { fix: 0, noFix: 0 },
    high: { fix: 0, noFix: 0 },
    medium: { fix: 0, noFix: 0 },
    low: { fix: 0, noFix: 0 },
    unknown: { fix: 0, noFix: 0 },
    unimportant: 0,
  }
  for (const result of report.results ?? []) {
    for (const pkg of result.packages) {
      for (const group of pkg.groups) {
        const bucket = bucketOf(Number.parseFloat(group.max_severity ?? ""))
        for (const id of group.ids) {
          if (group.experimental_analysis?.[id]?.unimportant) {
            counts.unimportant++
            continue
          }
          const vuln = pkg.vulnerabilities.find((v) => v.id === id)
          if (fixedIn(pkg.package, vuln)) counts[bucket].fix++
          else counts[bucket].noFix++
        }
      }
    }
  }
  return counts
}

const ROWS: [Bucket, string][] = [
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["unknown", "Unknown"],
]

/** Markdown for GITHUB_STEP_SUMMARY. */
export function summaryTable(target: string, counts: Tally): string {
  return [
    `### osv-scanner: ${target}`,
    "",
    "| Severity | With Fix | No Fix |",
    "|---|---|---|",
    ...ROWS.map(
      ([bucket, label]) =>
        `| ${label} | ${counts[bucket].fix} | ${counts[bucket].noFix} |`,
    ),
    "",
    `Blocking: ${counts.blocking}. Distro unimportant: ${counts.unimportant}.`,
    "",
  ].join("\n")
}

/** Exit code, findings on stderr. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const [path, target = ""] = argv
  if (!path) throw new Error("usage: bun osv-gate.ts <report.json> [target]")
  const report = (await Bun.file(path).json()) as Report
  const found = blocking(report)
  for (const line of found) console.error(line)
  const counts = tally(report)
  console.log(JSON.stringify({ msg: "osv-gate", target, ...counts }))
  const summary = env.GITHUB_STEP_SUMMARY
  if (summary) await appendFile(summary, summaryTable(target, counts))
  return found.length === 0 ? 0 : 1
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
