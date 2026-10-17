// Fail on fixable high findings
// Usage: bun osv-gate.ts <osv-scanner.json>

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

async function main(path: string | undefined): Promise<void> {
  if (!path) throw new Error("usage: bun osv-gate.ts <report.json>")
  const found = blocking((await Bun.file(path).json()) as Report)
  for (const line of found) console.error(line)
  console.log(JSON.stringify({ msg: "osv-gate", blocking: found.length }))
  process.exit(found.length === 0 ? 0 : 1)
}

if (import.meta.main) await main(process.argv[2])
