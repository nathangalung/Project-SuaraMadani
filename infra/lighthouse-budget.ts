// PLAN §10.8 lab budgets
// Usage: bun lighthouse-budget.ts <lhr.json>...

type Audit = {
  numericValue?: number
  details?: { items?: { resourceType?: string; transferSize?: number }[] }
}
export type Lhr = { finalDisplayedUrl: string; audits: Record<string, Audit> }

// Lab targets, PLAN §10.8
const LCP_MS = 2500
const TBT_MS = 50
const CLS = 0.05
const MEDIA_KB = 150
// Script budgets live in size-limit
const HTML_KB: Record<string, number> = { "/data": 60 }
const DEFAULT_HTML_KB = 30

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

if (import.meta.main) {
  const problems: string[] = []
  for (const file of process.argv.slice(2)) {
    problems.push(...budgetProblems((await Bun.file(file).json()) as Lhr))
  }
  for (const line of problems) console.error(line)
  console.log(
    JSON.stringify({ msg: "lighthouse-budget", problems: problems.length }),
  )
  process.exitCode = problems.length > 0 ? 1 : 0
}
