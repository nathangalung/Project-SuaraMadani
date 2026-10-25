// PLAN §10.8 lab budgets
// Usage: bun lighthouse-budget.ts <lhr.json>...
// Or: --multiplier <lhr.json>

type Audit = {
  numericValue?: number
  details?: { items?: { resourceType?: string; transferSize?: number }[] }
}
export type Lhr = {
  finalDisplayedUrl: string
  audits: Record<string, Audit>
  environment?: { benchmarkIndex?: number }
}

// Lab targets, PLAN §10.8
const LCP_MS = 2500
const TBT_MS = 50
const CLS = 0.05
const MEDIA_KB = 150
// Script budgets live in size-limit
const HTML_KB: Record<string, number> = { "/data": 60 }
const DEFAULT_HTML_KB = 30

// Bracket centres, suggested multipliers
const ANCHORS: [index: number, multiplier: number][] = [
  [460, 1],
  [1250, 2],
  [1750, 4],
]

/** Host index to mid-tier slowdown. */
export function cpuMultiplier(benchmarkIndex: number): number {
  if (!Number.isFinite(benchmarkIndex)) {
    throw new Error("report has no benchmarkIndex")
  }
  const first = ANCHORS[0] ?? [0, 1]
  const last = ANCHORS[ANCHORS.length - 1] ?? first
  if (benchmarkIndex <= first[0]) return first[1]
  // Interpolate, no bracket cliff
  for (let i = 1; i < ANCHORS.length; i++) {
    const [x1, y1] = ANCHORS[i] ?? last
    const [x0, y0] = ANCHORS[i - 1] ?? first
    if (benchmarkIndex <= x1) {
      const y = y0 + ((benchmarkIndex - x0) / (x1 - x0)) * (y1 - y0)
      return Math.round(y * 100) / 100
    }
  }
  return last[1]
}

const METRICS = [
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
]

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Per-metric median of one page. */
export function medianReport(runs: Lhr[]): Lhr {
  const [first] = runs
  if (!first) throw new Error("no Lighthouse runs")
  const audits = { ...first.audits }
  for (const id of METRICS) {
    audits[id] = {
      numericValue: median(
        runs.map((run) => run.audits[id]?.numericValue ?? 0),
      ),
    }
  }
  return { ...first, audits }
}

/** Groups runs by page path. */
export function byPage(reports: Lhr[]): Lhr[] {
  const pages = new Map<string, Lhr[]>()
  for (const report of reports) {
    const path = new URL(report.finalDisplayedUrl).pathname
    pages.set(path, [...(pages.get(path) ?? []), report])
  }
  return [...pages.values()].map(medianReport)
}

const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10

/** Empty list means within budget. */
export function budgetProblems(report: Lhr): string[] {
  const path = new URL(report.finalDisplayedUrl).pathname
  const value = (id: string) => report.audits[id]?.numericValue ?? 0
  const items = report.audits["network-requests"]?.details?.items ?? []
  const bytes = (types: string[]) =>
    items
      .filter((item) => types.includes(item.resourceType ?? ""))
      .reduce((sum, item) => sum + (item.transferSize ?? 0), 0)
  const problems: string[] = []
  const lcp = Math.round(value("largest-contentful-paint"))
  if (lcp > LCP_MS) problems.push(`${path}: LCP ${lcp} ms > ${LCP_MS}`)
  const tbt = Math.round(value("total-blocking-time"))
  if (tbt > TBT_MS) problems.push(`${path}: TBT ${tbt} ms > ${TBT_MS}`)
  const cls = Math.round(value("cumulative-layout-shift") * 1000) / 1000
  if (cls > CLS) problems.push(`${path}: CLS ${cls} > ${CLS}`)
  const media = kb(bytes(["Image", "Font"]))
  if (media > MEDIA_KB) {
    problems.push(`${path}: images and fonts ${media} kB > ${MEDIA_KB}`)
  }
  const html = kb(bytes(["Document"]))
  const htmlLimit = HTML_KB[path] ?? DEFAULT_HTML_KB
  if (html > htmlLimit) problems.push(`${path}: HTML ${html} kB > ${htmlLimit}`)
  return problems
}

/** Exit code, problems on stderr. */
export async function main(argv: string[]): Promise<number> {
  if (argv[0] === "--multiplier") {
    const report = (await Bun.file(argv[1] ?? "").json()) as Lhr
    const index = report.environment?.benchmarkIndex ?? Number.NaN
    // Multiplier, then index
    console.log(`${cpuMultiplier(index)} ${Math.round(index)}`)
    return 0
  }
  const reports: Lhr[] = []
  for (const file of argv) reports.push((await Bun.file(file).json()) as Lhr)
  const problems = byPage(reports).flatMap(budgetProblems)
  for (const line of problems) console.error(line)
  console.log(
    JSON.stringify({ msg: "lighthouse-budget", problems: problems.length }),
  )
  return problems.length > 0 ? 1 : 0
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
