import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const STATUSES = ["pass", "gap", "na", "frontend", "decision"] as const
type Status = (typeof STATUSES)[number]
type Row = {
  area: string
  chapter: string
  id: string
  level: string
  status: Status
}
type Counts = [number, number, number, number, number, number]

const AREAS: Record<string, string> = {
  "ASVS 5.0 Matrix": "ASVS 5.0 (all chapters)",
  "OWASP Top 10 2025": "OWASP Top 10 2025 (categories and CWE groups)",
  "OWASP API Security Top 10 2023": "OWASP API Security Top 10 2023",
  Compliance: "Compliance",
  Performance: "Performance",
  "Reliability and Operations": "Reliability and Operations",
  "Supply Chain": "Supply Chain",
  "Privacy and Data Minimisation": "Privacy and Data Minimisation",
}

const text = await Bun.file(
  join(import.meta.dir, "../docs/nfr-audit.md"),
).text()
const lines = text.split("\n")

const cells = (line: string) =>
  line
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())

// Status rows under audited sections
const auditRows = () => {
  const rows: Row[] = []
  let area = ""
  let chapter = ""
  let statusAt = -1
  for (const line of lines) {
    if (line.startsWith("## ")) area = AREAS[line.slice(3)] ?? ""
    if (line.startsWith("### ")) chapter = line.slice(4)
    if (!area || !line.startsWith("|")) continue
    const row = cells(line)
    const id = row[0] ?? ""
    if (id === "ID") statusAt = row.indexOf("Status")
    if (id === "ID" || id.startsWith("---") || statusAt < 0) continue
    const status = row[statusAt] as Status
    expect({ id, known: STATUSES.includes(status) }).toEqual({
      id,
      known: true,
    })
    const level = statusAt === 2 ? (row[1] ?? "") : ""
    rows.push({ area, chapter, id, level, status })
  }
  return rows
}

const count = (rows: Row[]): Counts =>
  [
    rows.length,
    ...STATUSES.map((s) => rows.filter((row) => row.status === s).length),
  ] as Counts

// Summary table after a caption
const recorded = (caption: string) => {
  const start = lines.indexOf(caption)
  expect(start).toBeGreaterThan(-1)
  const table: Record<string, Counts> = {}
  for (const line of lines.slice(start + 4)) {
    if (!line.startsWith("|")) break
    const [name = "", ...numbers] = cells(line)
    table[name.replace(/^\[(.+)\]\(.+\)$/, "$1")] = numbers.map(
      Number,
    ) as Counts
  }
  return table
}

const group = (rows: Row[], key: (row: Row) => string) => {
  const table: Record<string, Counts> = {}
  for (const name of new Set(rows.map(key))) {
    table[name] = count(rows.filter((row) => key(row) === name))
  }
  return table
}

const rows = auditRows()
const asvs = rows.filter((row) => row.area === AREAS["ASVS 5.0 Matrix"])

describe("nfr-audit summary", () => {
  test("ASVS matrix holds each requirement once", () => {
    expect(asvs.length).toBe(345)
    expect(new Set(asvs.map((row) => row.id)).size).toBe(345)
  })

  test("area counts match the tables", () => {
    expect(recorded("## Summary")).toEqual(group(rows, (row) => row.area))
  })

  test("ASVS level counts match the matrix", () => {
    expect(recorded("ASVS by level:")).toEqual(group(asvs, (row) => row.level))
  })

  test("ASVS chapter counts match the matrix", () => {
    expect(recorded("ASVS by chapter:")).toEqual(
      group(asvs, (row) => row.chapter),
    )
  })

  test("open L1 and L2 list matches the matrix", () => {
    const open = asvs
      .filter((row) => row.level !== "L3")
      .filter((row) => row.status === "gap" || row.status === "decision")
      .map((row) => `${row.id} (${row.status})`)
    const sentence = lines.find((line) =>
      line.startsWith("Open within the L2 target"),
    )
    const listed = sentence?.match(/\): (.+?)\. /)?.[1]?.split(", ")
    expect(listed).toEqual(open)
  })

  test("every decision row is in Open Decisions", () => {
    const start = lines.indexOf("## Open Decisions")
    const named = lines
      .slice(start)
      .filter((line) => line.startsWith("| "))
      .flatMap((line) => (cells(line).at(-1) ?? "").split(/[\s,]+/))
    const missing = rows
      .filter((row) => row.status === "decision")
      .map((row) => row.id.replace(/ .*/, ""))
      .filter((id) => !named.includes(id))
    expect(missing).toEqual([])
  })
})
